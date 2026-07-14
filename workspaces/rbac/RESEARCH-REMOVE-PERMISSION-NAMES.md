# Research: Removing Permission Names from RBAC Conditional Policies

**Date:** 2026-07-13 — 2026-07-14
**Authors:** Oleksandr Andriienko + Claude Code (LLM Council sessions)
**Status:** Research complete, implementation on branch `fix/rbac-remove-permission-names`, NOT ready to merge
**Related:** Issue #9429, PR #9770 (retry fix), PR #9731 (non-destructive reconcile)

---

## TL;DR

We investigated removing HTTP permission metadata dependency from the RBAC plugin by stopping storage of permission names in the DB. The approach mostly works but has a real edge case with scaffolder permissions. The retry fix (PR #9770) should be merged as the immediate solution.

---

## The Problem

RBAC plugin fetches permission metadata via HTTP from other plugins during startup to resolve `action → permission name` (e.g., `read` → `catalog.entity.read`). If the target plugin isn't ready yet → race condition → conditional policies not applied.

The `processConditionMapping()` function in `helper.ts` is the single function making this HTTP call, called from 3 sites:

1. REST API POST `/roles/conditions`
2. REST API PUT `/roles/conditions/:id`
3. YAML file watcher during reconciliation (the startup path)

## Key Discovery: Permission Names Are Mostly Redundant

### Data flow analysis (74 locations audited)

```
Frontend (sends only actions: ['read'])
  → REST API POST (accepts actions)
    → processConditionMapping() ← HTTP fetch, resolves action → name
      → DB stores JSON: [{"name":"catalog.entity.read","action":"read"}]
        → Runtime handleConditions(): matches by name + action + resourceType
      → REST API GET (strips names back to actions)
  → Frontend (receives only actions)
```

Permission names exist ONLY on the backend side. They enter via HTTP resolution, are stored as JSON in DB, used for runtime matching, then stripped again for API responses.

### Runtime matching doesn't need stored names (mostly)

In `handleConditions()` (permission-policy.ts:364-369):

```typescript
const conditionalDecisions = await this.conditionStorage.filterConditions(
  role,
  undefined,
  resourceType,
  [action],
  [permissionName],
);
```

The `permissionName` comes from the **incoming Backstage request** (`request.permission.name`), NOT from stored data. The framework already knows the permission name.

### `checkConflictedConditions` enforces uniqueness

`checkConflictedConditions` (conditional-storage.ts:156-204) throws `ConflictError` if you try to store overlapping actions for the same `(roleEntityRef, pluginId, resourceType)`. So `(role, pluginId, resourceType, action)` is enforced-unique by code.

## Key Discovery: `.find()` Bug in Current Code

`processConditionMapping()` uses `.find()` to resolve `action → name`:

```typescript
const perm = rule.permissions.find(permission => {
  if (permission.type === 'resource') {
    return (
      permission.resourceType === resourceType &&
      action === permission.attributes.action
    );
  }
  return false;
});
```

`.find()` returns the **first match**. If a plugin has two permissions with the same `(resourceType, action)`, it picks one arbitrarily. This is a **pre-existing bug** — the stored name could be wrong for plugins with collisions.

## Key Discovery: (resourceType, action) Collisions Exist

### Full ecosystem scan results

**Backstage core (backstage/backstage):**

| Plugin         | Collision                     | Permissions                                                           |
| -------------- | ----------------------------- | --------------------------------------------------------------------- |
| **Scaffolder** | `(scaffolder-template, read)` | `scaffolder.template.parameter.read`, `scaffolder.template.step.read` |

**Community plugins (backstage/community-plugins):**

| Plugin           | Collision                    | Permissions                                                       |
| ---------------- | ---------------------------- | ----------------------------------------------------------------- |
| **Azure DevOps** | `(catalog-entity, read)` x4  | `pullrequest.read`, `pipeline.read`, `gittag.read`, `readme.read` |
| **BlackDuck**    | `(catalog-entity, read)` x2  | `riskprofile.read`, `vulnerabilities.read`                        |
| **Playlist**     | `(playlist-list, update)` x2 | `list.update`, `followers.update`                                 |

**Roadie plugins:** No permissions defined at all.

### But only ONE collision actually matters

| Plugin         | Uses `authorizeConditional`?  | Collision matters?                                     |
| -------------- | ----------------------------- | ------------------------------------------------------ |
| **Scaffolder** | **Yes**                       | **Yes** — different conditions for parameters vs steps |
| Azure DevOps   | No — basic `authorize()` only | No                                                     |
| BlackDuck      | No                            | No                                                     |
| Playlist       | No                            | No                                                     |

Only scaffolder actively uses conditional permissions with the colliding `(scaffolder-template, read)` pair. The other 3 plugins use simple ALLOW/DENY, so conditional policies are irrelevant for them.

Even for scaffolder, the Backstage docs show both permissions receiving the same condition (same `hasTag` rule). Separate conditions for parameter.read vs step.read is a theoretical use case.

## Implementation Branch: `fix/rbac-remove-permission-names`

### What was implemented

Working implementation with 674 backend tests passing, 0 TS errors:

1. **DB migration** — converts `permissions` column from `[{name,action}]` to `["read"]` format
2. **Type changes** — `PermissionMapping = PermissionAction | PermissionInfo` (accepts both)
3. **Deleted `processConditionMapping()`** — the entire HTTP metadata fetch chain (~130 lines)
4. **Deleted `permissionMappingToActions()`** — no longer needed
5. **`filterConditions`** — matches by action; if stored entry has `name`, also matches by name
6. **Runtime `handleConditions`** — passes `permissionName` from request for name-aware matching
7. **Provider interface** — backward-compatible, accepts both formats
8. **REST API** — accepts both `["read"]` and `[{name, action}]` in POST/PUT

### YAML file format (both work)

```yaml
# Broad match — all read permissions for the resourceType
permissionMapping:
  - read

# Specific match — only this exact permission
permissionMapping:
  - name: scaffolder.template.parameter.read
    action: read
```

### What's NOT done

- Frontend still sends actions only — would need UI change to let users pick specific permissions
- No new tests for `PermissionInfo` in YAML (only action-based tests exist)
- DB migration is irreversible (names can't be reconstructed)
- Changeset not created

## Why We're NOT Merging This Now

1. **Scaffolder collision is a real edge case** — removing names changes behavior for users who have different conditions for parameter.read vs step.read
2. **DB migration is irreversible** — can't rollback without backup
3. **Frontend doesn't support name input** — users can't specify names through UI
4. **Retry fix (PR #9770) solves the immediate production problem** without any of these risks

## Upstream Backstage Findings

### PermissionsRegistryService

- Plugin-scoped (each plugin gets own instance)
- No enumeration API (`getPermissions()` doesn't exist)
- Factory internally still uses deprecated `createPermissionIntegrationRouter()`
- HTTP metadata endpoint `/.well-known/backstage/permissions/metadata` still works
- TODO at `plugin-endpoints.ts:148` acknowledges the intent to migrate

### Relevant upstream PRs

- **PR #34079** (CLOSED): `/by-name` endpoint attempt — "numerous breaking changes needed"
- **PR #34608** (MERGED): `#action` suffix workaround — frontend-only, doesn't help RBAC backend
- **PR #33743 + #33745** (MERGED): Catalog removed deprecated `createPermissionIntegrationRouter`

### Upstream contribution options (council analysis)

Best chance of acceptance:

1. `pluginReadiness.waitFor('catalog')` service — narrow, hard to abuse (40-50% chance)
2. `rootLifecycle` access for plugin modules (30-40%)
3. Root-scoped permission registry reader (20-30%)

Most likely response: "use retry in your plugin" (30-40%).

## Recommendation

### Now

Merge PR #9770 (retry with exponential backoff). Apply our code review fixes:

- Token freshness: move token acquisition inside retry loop
- Name the jitter floor constant (`MIN_JITTER_MS = 250`)

### Later (with colleague)

Discuss the "remove names" approach. Key questions:

1. Is the scaffolder parameter.read vs step.read distinction worth preserving?
2. Should the frontend be updated to send `{name, action}` for specific permissions?
3. Is it worth proposing an upstream Backstage change?

### Files to reference

| File                                                 | Contents                                           |
| ---------------------------------------------------- | -------------------------------------------------- |
| Branch `fix/rbac-remove-permission-names`            | Working implementation (674 tests pass)            |
| `council-verdict-pr9770.md` (in stash)               | Council review of retry PR                         |
| `council-verdict-permissions-registry.md` (in stash) | Council analysis of PermissionsRegistryService gap |
| `research-permissions-registry-gap.md` (in stash)    | Upstream Backstage PRs and issues research         |
| `reproduction-plan-issue-9429.md` (in stash)         | Step-by-step reproduction guide                    |
| `REPRO-GUIDE.md` (in stash)                          | Hands-on reproduction instructions                 |

### Memory files (persisted across sessions)

| Memory                                 | Key info                                          |
| -------------------------------------- | ------------------------------------------------- |
| `permissions-registry-enumeration-gap` | PermissionsRegistryService has no enumeration API |
| `pr9770-retry-review`                  | Council verdict on retry PR                       |
| `conditional-policy-reconcile-review`  | Original #9429 fix review                         |

---

## LLM Council Sessions (5 total)

1. **PR #9770 review** — merge with token freshness fix
2. **PermissionsRegistryService investigation** — why write-only, upstream PR status
3. **Brainstorming: 3 approaches** — remove names won, extension point rejected
4. **Upstream contribution options** — rootLifecycle or pluginReadiness best chance
5. **Detailed implementation plan** — file-by-file plan, risk analysis, migration strategy
