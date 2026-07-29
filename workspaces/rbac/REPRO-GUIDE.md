# Reproducing Issue #9429 — Step by Step

## What this reproduces

RBAC conditional policies from YAML file are NOT applied on startup because catalog permission metadata is unavailable (startup race condition). The reconcile aborts safely (post-PR #9731), but conditions remain unapplied until a manual file reload or restart.

## Prerequisites

- PostgreSQL running on localhost:5432 (user: postgres, password: postgres)
- Node.js 22+
- Branch: `main`

## Steps

### 1. Reset the permission database

```bash
PGPASSWORD=postgres psql -h localhost -p 5432 -U postgres \
  -c "DROP DATABASE IF EXISTS backstage_plugin_permission;" \
  -c "CREATE DATABASE backstage_plugin_permission;"
```

### 2. Enable the monkeypatch

In `plugins/rbac-backend/src/service/plugin-endpoints.ts`, find the `getMetadataByPluginId` method (~line 139) and add this BEFORE the `if (pluginId === 'permission')` check:

```typescript
    // TEMPORARY: simulate catalog metadata unavailability
    if (pluginId === 'catalog') {
      this.logger.warn(
        `[REPRO] Simulating catalog metadata unavailability for plugin ${pluginId}`,
      );
      return undefined;
    }
```

### 3. Start the backend

```bash
yarn workspace backend start
```

### 4. Look for these logs

```
[REPRO] Simulating catalog metadata unavailability for plugin catalog
Conditional policy reconcile aborted; stored conditions preserved.
  event="conditional_reconcile_aborted"
  pendingAdds=1
  pluginIds=["catalog"]
  error="Unable to get permission list for plugin catalog"
```

This confirms:
- The conditional policy from `examples/conditional-policies.yaml` was parsed
- The metadata fetch for catalog failed (simulated)
- The reconcile aborted — condition was NOT applied
- No existing conditions were destroyed (pendingRemoves=0)

### 5. Verify conditions are NOT applied

While the backend is running:

```bash
curl -s http://localhost:7007/api/permission/plugins/conditions \
  -H "Authorization: Bearer $(curl -s http://localhost:7007/api/auth/guest/refresh | jq -r .backstageIdentity.token)" \
  | jq .
```

The catalog conditional policy should be absent.

### 6. Remove the monkeypatch and trigger a file reload

Remove the temporary `if (pluginId === 'catalog')` block from `plugin-endpoints.ts`. Then touch the conditional policies file to trigger a reload:

```bash
touch examples/conditional-policies.yaml
```

Check the logs — you should see the conditional policy being applied successfully now (because the catalog metadata endpoint is available after startup).

### 7. Test with the retry fix

```bash
# Stop the backend (Ctrl+C)
git stash  # save any local changes
git checkout fix/rbac-conditional-metadata-retry

# Re-add the monkeypatch from step 2 (to simulate the race)
# BUT: with the retry fix, you'll see retry attempts in the logs instead of immediate abort

yarn workspace backend start
```

Expected retry logs:
```
Unable to get permission list for plugin catalog, retrying in 2000ms (attempt 1 of 12)
Unable to get permission list for plugin catalog, retrying in 4000ms (attempt 2 of 12)
```

Since the monkeypatch always returns `undefined`, all 12 attempts will fail and the reconcile will still abort — but with a ~4 minute delay. To test the "retry succeeds" scenario, modify the monkeypatch to fail only N times:

```typescript
    // TEMPORARY: fail first 3 attempts, then succeed
    let catalogFailCount = 0;
    // ... in getMetadataByPluginId:
    if (pluginId === 'catalog' && catalogFailCount < 3) {
      catalogFailCount++;
      this.logger.warn(`[REPRO] Simulating failure ${catalogFailCount}/3`);
      return undefined;
    }
```

## Files involved

| File | Purpose |
|------|---------|
| `examples/rbac-policy.csv` | CSV policy file (MANDATORY — without it conditions are silently skipped) |
| `examples/conditional-policies.yaml` | Conditional policy referencing catalog plugin |
| `app-config.yaml` | Config pointing to both files + `policyFileReload: true` |
| `packages/backend/src/index.ts` | RBAC backend wired in (replaces allow-all-policy) |
| `plugins/rbac-backend/src/service/plugin-endpoints.ts` | Monkeypatch location |

## Why the CSV file is mandatory

The function `filterParsedToCsvFileSourcedRoles` filters out any conditional policy whose `roleEntityRef` is not backed by a role with source `csv-file`. Without the CSV file defining `role:default/test`, all conditional policies are silently skipped — the metadata fetch never happens and you get a false negative.

## What happens without the monkeypatch (real race condition)

On a normal local startup, the race is unlikely because catalog initializes fast with SQLite/local PostgreSQL. In production the race occurs when:
- PostgreSQL has high latency (remote DB, SSL, connection pool exhaustion)
- Catalog has many DB migrations to run (fresh deploy or version upgrade)
- Backstage lifecycle middleware queues requests for 5s then returns 503
- Multiple heavy plugins compete for init time in `Promise.all`
