# Implementation Plan: Remove Permission Names from RBAC DB

**Date:** 2026-07-13
**Council:** Claude Opus 4.6, Gemini 3 Pro, GPT-5.3 Codex
**Goal:** Eliminate HTTP permission metadata dependency by stopping storage of permission names

---

## Council Consensus

All 3 models agree:

1. **`processConditionMapping()` and HTTP fetch chain can be deleted** — permission name was stored as a resolution artifact never needed at runtime
2. **`(role, pluginId, resourceType, action)` is the correct matching key** — `checkConflictedConditions` enforces uniqueness
3. **Provider interface change is a hard breaking change** — requires major version bump
4. **`use` action edge case is safe** — action value correctly derived from requests
5. **Multiple actions per condition are safe** — single-element `[action]` query makes `.every()` equivalent to `.includes()`
6. **Migration is inherently irreversible** — names cannot be reconstructed without HTTP

## Council Clash: Migration Strategy

- **Claude:** One-shot transactional Knex migration (simple, correct for Backstage)
- **GPT:** Multi-release phased approach (dual-write, dual-read, validate, drop)

**Verdict:** One-shot is correct. Backstage runs migrations synchronously on startup before serving traffic. Table is small (hundreds of rows). Phased approach adds hundreds of lines of temporary code for zero operational benefit.

---

## Phase 0: Pre-Migration Validation

Add to migration `up()` — verify invariant before transforming data:

```typescript
const rows = await knex('role-condition-policies')
  .select('id', 'roleEntityRef', 'pluginId', 'resourceType', 'permissions');

const seen = new Map<string, { id: number; actions: string[] }>();
const duplicates: Array<{ key: string; ids: number[] }> = [];

for (const row of rows) {
  let parsed: Array<{ name?: string; action: string } | string>;
  try {
    parsed = JSON.parse(row.permissions);
  } catch {
    throw new Error(`Malformed JSON in row ${row.id}. Fix manually before migrating.`);
  }
  const actions = parsed.map(entry => typeof entry === 'string' ? entry : entry.action);
  const key = `${row.roleEntityRef}::${row.pluginId}::${row.resourceType}`;
  const existing = seen.get(key);
  if (existing && actions.some(a => existing.actions.includes(a))) {
    duplicates.push({ key, ids: [existing.id, row.id] });
  } else {
    seen.set(key, { id: row.id, actions });
  }
}

if (duplicates.length > 0) {
  throw new Error(
    `Found ${duplicates.length} duplicate condition rows. Resolve manually: ${JSON.stringify(duplicates)}`
  );
}
```

## Phase 1: DB Migration

**New file:** `plugins/rbac-backend/migrations/YYYYMMDD_remove_permission_names.ts`

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Phase 0 validation here (see above)

  const rows = await knex('role-condition-policies').select('id', 'permissions');
  const totalBefore = rows.length;

  await knex.transaction(async trx => {
    for (const row of rows) {
      const parsed: Array<{ name?: string; action: string } | string> = JSON.parse(row.permissions);
      const actions = parsed.map(entry =>
        typeof entry === 'string' ? entry : entry.action,
      );
      await trx('role-condition-policies')
        .where('id', row.id)
        .update({ permissions: JSON.stringify(actions) });
    }
  });

  console.log(`Migration complete: ${totalBefore} rows processed`);
}

export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    'This migration is irreversible. Restore from backup to rollback.',
  );
}
```

## Phase 2: Type Changes

**File: `plugins/rbac-common/src/types.ts`**

```typescript
// BEFORE:
export type PermissionInfo = {
  name: string;
  action: PermissionAction;
};

export type RoleConditionalPolicyDecision<T extends PermissionAction | PermissionInfo> = {
  // ...
  permissionMapping: T[];
};

// AFTER:
export type RoleConditionalPolicyDecision = {
  // ...
  permissionMapping: PermissionAction[];
};

// Keep deprecated for one release:
/** @deprecated Use PermissionAction directly. Will be removed in next major. */
export type PermissionInfo = {
  name: string;
  action: PermissionAction;
};
```

Delete `permissionMappingToActions()` from `helper.ts`.

## Phase 3: `filterConditions` Change

**File: `plugins/rbac-backend/src/database/conditional-storage.ts`**

```typescript
// BEFORE:
filterConditions(
  roleEntityRef?, pluginId?, resourceType?, actions?, permissionNames?, trx?
): Promise<RoleConditionalPolicyDecision<PermissionInfo>[]>

// AFTER:
filterConditions(
  roleEntityRef?, pluginId?, resourceType?, actions?, trx?
): Promise<RoleConditionalPolicyDecision[]>
```

- Delete `permissionNames.every(...)` filter block (lines 107-115)
- `actions.every(...)` operates directly on `string[]` from JSON
- `daoToConditionalDecision` parses `permissions` as `PermissionAction[]`

## Phase 4: `handleConditions` Change

**File: `plugins/rbac-backend/src/policies/permission-policy.ts`**

```typescript
// BEFORE:
const conditionalDecisions = await this.conditionStorage.filterConditions(
  role, undefined, resourceType, [action], [permissionName],
);

// AFTER:
const conditionalDecisions = await this.conditionStorage.filterConditions(
  role, undefined, resourceType, [action],
);
```

## Phase 5: REST API Changes

**File: `plugins/rbac-backend/src/service/policies-rest-api.ts`**

| Endpoint | Change |
|----------|--------|
| POST `/roles/conditions` | Delete `processConditionMapping()` call. Store actions directly. |
| PUT `/roles/conditions/:id` | Delete `processConditionMapping()` call. |
| GET `/roles/conditions` | Response `permissionMapping` becomes `string[]` instead of `{name,action}[]`. **REST API breaking change.** |
| GET `/roles/conditions/:id` | Same response change. |
| DELETE `/roles/conditions/:id` | Remove `.map(pm => pm.action)` strips. |

## Phase 6: File Watcher Changes

**File: `plugins/rbac-backend/src/file-permissions/yaml-conditional-file-watcher.ts`**

- Delete `processConditionMapping` call in staging loop (line 246)
- YAML `permissionMapping` actions flow directly into `planConditionalReconcile` and storage
- `yamlConditionEquals` simplifies — direct array comparison, no `permissionMappingToActions`

## Phase 7: Provider Interface Migration (BREAKING)

**File: `plugins/rbac-node/src/types/types.ts`**

```typescript
// BEFORE:
applyConditionalPermissions(
  conditionalPermissions: RoleConditionalPolicyDecision<PermissionInfo>[]
): Promise<void>;

// AFTER:
applyConditionalPermissions(
  conditionalPermissions: RoleConditionalPolicyDecision[]
): Promise<void>;
```

**Migration strategy:**
1. Bump **major version** of `@backstage-community/plugin-rbac-node`
2. For one release: accept `PermissionInfo[] | PermissionAction[]`, strip names with deprecation warning
3. Next release: remove `PermissionInfo` support entirely
4. Publish migration guide for third-party provider authors

## Phase 8: connect-providers Changes

**File: `plugins/rbac-backend/src/service/connect-providers.ts`**

- `isEqual(stored.permissionMapping, desired.permissionMapping)` works on `PermissionAction[]`
- All `permissionMappingToActions()` calls become identity operations — remove
- `planConditionalReconcile` callbacks simplify to direct array access

---

## What Gets Deleted (~130+ lines)

From `helper.ts`:
- `processConditionMapping()` (~50 lines)
- `getPluginPermissionMetadataWithRetry()` and retry infrastructure
- `ConditionalMetadataRetryOptions` type
- `computeConditionalMetadataBackoffDelayMs()`
- `resolveConditionalMetadataRetryOptions()`
- `readConditionalMetadataRetryOptionsFromConfig()`
- `permissionMappingToActions()`
- All config readers for retry options

From `config.d.ts`:
- `conditionalMetadataRetry` schema

From `yaml-conditional-file-watcher.ts`:
- `metadataRetryOptions` field and constructor parameter

---

## Consolidated Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong ALLOW/DENY at runtime | **None** | `permissionName` filter was redundant; uniqueness enforced by code |
| Data loss during migration | **Low** | Names unused for runtime. Take DB backup. Document irreversibility. |
| Break third-party RBAC providers | **High** | Major version bump + deprecation window + migration guide |
| REST API response contract break | **Medium** | Document in changelog. Part of major version bump. |
| Silent behavior changes | **None** | Tuple enforced-unique. Pre-migration validation proves it. |
| In-flight writes during migration | **None** | Backstage runs migrations before accepting traffic. |
| Malformed JSON in existing rows | **Low** | Migration try/catch aborts with clear error. |
| Orphaned actions after permission renames | **Cosmetic** | Frontend resolves display names from live metadata. |

---

## Execution Order

1. Pre-migration validation query (Phase 0)
2. DB migration (Phase 1)
3. Update types — compile errors guide remaining changes (Phase 2)
4. Fix `filterConditions` and `handleConditions` (Phases 3-4)
5. Fix REST API, file watcher, connect-providers (Phases 5-6-8)
6. Update provider interface with deprecation layer (Phase 7)
7. Delete all HTTP metadata fetch code and retry infrastructure
8. Update all tests
9. Bump major version of `plugin-rbac-node`
10. Write changelog documenting breaking changes

## Files Modified

| File | Change |
|------|--------|
| `migrations/YYYYMMDD_remove_permission_names.ts` | **New** |
| `rbac-common/src/types.ts` | Remove `PermissionInfo`, remove generic |
| `rbac-backend/src/database/conditional-storage.ts` | Remove `permissionNames` param, simplify DAO |
| `rbac-backend/src/policies/permission-policy.ts` | Drop `permissionName` from filter call |
| `rbac-backend/src/service/policies-rest-api.ts` | Delete `processConditionMapping`, simplify responses |
| `rbac-backend/src/helper.ts` | Delete ~130 lines (processConditionMapping, retry, helpers) |
| `rbac-backend/src/file-permissions/yaml-conditional-file-watcher.ts` | Delete metadata fetch |
| `rbac-node/src/types/types.ts` | Update provider interface |
| `rbac-backend/src/service/connect-providers.ts` | Remove name stripping |
| `rbac-backend/config.d.ts` | Remove `conditionalMetadataRetry` schema |
| All test files | Update fixtures and assertions |

---

*Council: Claude Opus 4.6 (strongest, rated 9-10/10), Gemini 3 Pro, GPT-5.3 Codex*
