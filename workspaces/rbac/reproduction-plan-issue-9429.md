# Reproduction Plan: Issue #9429 — Conditional Policies Removed on Startup

**Date:** 2026-07-10
**Council:** Claude Opus 4.6, Gemini 3 Pro, GPT-5.3 Codex
**Goal:** Reproduce the startup race condition where conditional policies are not applied because catalog permission metadata is temporarily unavailable

---

## The Bug

During RBAC conditional policy reconciliation on startup, the RBAC plugin fetches permission metadata from target plugins (e.g., `catalog`) via HTTP calls to `GET /.well-known/backstage/permissions/metadata`. If the target plugin hasn't finished mounting yet (startup race), the metadata fetch fails.

- **Pre-fix (before PR #9731):** Previously valid conditional policies are destructively removed from DB
- **Post-fix (after PR #9731, before PR #9770):** Reconcile aborts safely, DB preserved, but conditions NOT applied until a later file reload or restart

---

## Prerequisites

You MUST be on the `main` branch to reproduce the "no retry" behavior. The `fix/rbac-conditional-metadata-retry` branch already contains the retry fix.

```bash
cd /Users/oandriie/projects/community-plugins
git checkout main
```

---

## Step 1: Add RBAC backend dependency

In `packages/backend/package.json`, add to `dependencies`:

```json
"@backstage-community/plugin-rbac-backend": "workspace:^"
```

Then install:

```bash
yarn install
```

---

## Step 2: Update backend index.ts

In `packages/backend/src/index.ts`, replace:

```typescript
backend.add(
  import('@backstage/plugin-permission-backend-module-allow-all-policy'),
);
```

with:

```typescript
backend.add(import('@backstage-community/plugin-rbac-backend'));
```

---

## Step 3: Create CSV policies file (MANDATORY)

Create `examples/rbac-policy.csv`:

```csv
p, role:default/test, catalog-entity, read, allow
g, user:development/guest, role:default/test
```

**CRITICAL:** Without a CSV file, conditional policies are **silently skipped**. The function `filterParsedToCsvFileSourcedRoles` in `yaml-conditional-file-rules.ts` filters out any role that does not have source `csv-file`. Without a CSV file defining `role:default/test`, all conditional policies are silently skipped — you never reach the metadata fetch at all.

---

## Step 4: Create conditional policies YAML file

Create `examples/conditional-policies.yaml`:

```yaml
---
result: CONDITIONAL
roleEntityRef: 'role:default/test'
pluginId: catalog
resourceType: catalog-entity
permissionMapping:
  - read
conditions:
  rule: IS_ENTITY_OWNER
  resourceType: catalog-entity
  params:
    claims:
      - 'group:default/team-a'
```

**Format notes:**
- Multi-document YAML (separated by `---`)
- `permissionMapping` must be a **flat array of strings** like `['read']` — NOT a nested map like `[{ read: ['read'] }]`
- Valid actions: `read`, `create`, `update`, `delete`, `use`
- The file must reference the `catalog` plugin specifically, since catalog metadata fetch failure is the trigger

---

## Step 5: Update app-config

Add to `app-config.yaml` (or `app-config.local.yaml`) under `permission.rbac`:

```yaml
permission:
  enabled: true
  rbac:
    pluginsWithPermission:
      - catalog
      - permission
      - scaffolder
    admin:
      users:
        - name: user:development/guest
    policies-csv-file: /Users/oandriie/projects/community-plugins/workspaces/rbac/examples/rbac-policy.csv
    conditionalPoliciesFile: /Users/oandriie/projects/community-plugins/workspaces/rbac/examples/conditional-policies.yaml
    policyFileReload: true
```

**Database options:**

For simple single-startup reproduction (conditions never applied but cannot test cross-restart):
```yaml
backend:
  database:
    client: better-sqlite3
    connection: ':memory:'
```

For testing cross-restart preservation (conditions preserved in DB after abort):
```yaml
backend:
  database:
    client: better-sqlite3
    connection:
      directory: ./rbac-test-db
```

---

## Step 6: Simulate catalog metadata unavailability

### Option A: Inline delay module (non-invasive)

Add to `packages/backend/src/index.ts` BEFORE `backend.start()`:

```typescript
import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';

backend.add(createBackendModule({
  pluginId: 'catalog',
  moduleId: 'delay-metadata',
  register(env) {
    env.registerInit({
      deps: { http: coreServices.httpRouter },
      async init({ http }) {
        http.use((req, res, next) => {
          if (req.path.includes('.well-known/backstage/permissions/metadata')) {
            console.log('[DELAY] Blocking catalog metadata for 60s');
            setTimeout(next, 60000);
          } else {
            next();
          }
        });
      },
    });
  },
}));
```

**Caveat:** Express middleware ordering within the catalog plugin sub-app is non-deterministic. If the delay does not trigger (catalog registers its route first), use Option B.

### Option B: Source monkeypatch (more reliable)

Temporarily add a forced failure in `plugins/rbac-backend/src/service/plugin-endpoints.ts`, at the top of `getMetadataByPluginId`:

```typescript
async getMetadataByPluginId(pluginId: string, token: string | undefined) {
  // TEMPORARY: simulate catalog metadata unavailability
  if (pluginId === 'catalog') {
    throw new Error('simulated catalog metadata failure');
  }
  // ... rest of existing code
}
```

### Option C: Discovery service override (most Backstage-native)

Override `PluginEndpointDiscovery` via `createServiceFactory` to delay resolving the catalog plugin's base URL. This avoids Express middleware ordering issues entirely but requires more boilerplate.

---

## Step 7: Run and observe

```bash
yarn workspace backend start
```

### Log strings to grep for (confirming reproduction)

| Log message | Meaning |
|---|---|
| `Unable to get permission list for plugin catalog` | Metadata fetch failed in `processConditionMapping` |
| `Conditional policy reconcile aborted; stored conditions preserved` | Reconcile aborted (post-#9731 behavior) |
| `event: 'conditional_reconcile_aborted'` | Structured audit log event |

### Verify conditions NOT applied

```bash
curl http://localhost:7007/api/permission/plugins/condition-rules
# or
curl http://localhost:7007/api/rbac/conditional-policies
```

The catalog conditions should be absent.

### Trigger manual reload to confirm they DO apply once catalog is ready

If using Option A (delay module), wait 60 seconds, then:

```bash
touch examples/conditional-policies.yaml
```

Re-check the API — conditions should now appear (because `policyFileReload: true` triggers a re-read, and by now the catalog metadata endpoint is available).

---

## Step 8: Verify the retry fix

```bash
git checkout fix/rbac-conditional-metadata-retry
yarn workspace backend start
```

With the retry fix, look for logs showing retry attempts:

```
Unable to get permission list for plugin catalog, retrying in 2000ms (attempt 1 of 12)
Unable to get permission list for plugin catalog, retrying in 4000ms (attempt 2 of 12)
```

After the catalog finishes starting, the retry should succeed and conditions should appear in the API **without** any manual `touch`.

---

## Critical Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Missing CSV file | Conditions silently skipped, no metadata error logged | Create `rbac-policy.csv` with role definition |
| Wrong `permissionMapping` format | `InputError` at parse time, never reaches metadata fetch | Use flat string array `['read']`, not nested map |
| Wrong branch | Retry logic already present, bug not reproducible | Checkout `main` branch |
| In-memory SQLite | Cannot test cross-restart preservation | Use file-based SQLite path |
| Middleware ordering | Delay module doesn't intercept if catalog registers route first | Use monkeypatch (Option B) instead |
| Wrong `roleEntityRef` | Role not found in CSV, conditions silently skipped | Ensure `roleEntityRef` in YAML matches a role defined in CSV |

---

## Council Details

| Model | Phase | Tokens | Duration |
|-------|-------|--------|----------|
| Claude Opus 4.6 | First Opinion | 57,050 | 131s |
| Gemini 3 Pro | First Opinion | 34,621 | 53s |
| GPT-5.3 Codex | First Opinion | 38,177 | 218s |
| Claude (Review) | Anonymous Review | 64,257 | 91s |
| Gemini (Review) | Anonymous Review | 40,342 | 110s |
| GPT-5.3 (Review) | Anonymous Review | 47,609 | 253s |
| Claude (Chairman) | Synthesis | 36,887 | 74s |
| **Total** | | **350,141** | **553s** |

**Strongest response:** Claude Opus — identified the critical CSV file requirement, correct `permissionMapping` format, and reliable monkeypatch approach. All three reviewers rated Claude highest (8-9/10).

**Gemini's critical errors:**
1. Omitted CSV file entirely → would cause silent no-op (false negative)
2. Used wrong `permissionMapping` format (`[{ read: ['read'] }]`) → would cause `InputError` at parse time

**Key reviewer insight:** No model proposed a deterministic verification workflow (seed DB → fail start → inspect API → compare). This should be added for CI integration.

---

*Council composition: Claude Opus 4.6, Gemini 3 Pro (gemini-3-pro-preview), GPT-5.3 Codex*
*Anonymization mapping: Claude=C, Gemini=A, Cursor/GPT=B*
