# Conditional Policies Redesign: Eliminate HTTP Metadata Dependency

**Date:** 2026-07-14
**Branch:** `fix/rbac-remove-permission-names`
**Status:** Implementation complete, 961 tests pass, awaiting team discussion
**Related:** Issue #9429, PR #9770 (community retry fix), PR #9731 (non-destructive reconcile)

---

## Problem

The RBAC plugin fetches permission metadata via HTTP from other plugins (e.g., catalog) during startup to resolve `action → permission name` (e.g., `'read'` → `'catalog.entity.read'`). This creates a startup race condition because the target plugin may not have mounted its HTTP routes yet.

The `processConditionMapping()` function makes this HTTP call from 3 sites:

1. YAML file watcher during reconciliation (**startup path — causes #9429**)
2. REST API POST `/roles/conditions`
3. REST API PUT `/roles/conditions/:id`

## Root Cause Analysis

### Why permission names were stored

The original RBAC implementation stored `[{name: "catalog.entity.read", action: "read"}]` in the DB to match conditions at runtime. The name was resolved via HTTP call to `/.well-known/backstage/permissions/metadata`.

### Why HTTP resolution was unnecessary

1. **Backstage's own `ConditionalPolicyDecision` type has no `permissionName` field** — only `pluginId`, `resourceType`, and `conditions`. Storing names was an RBAC-specific addition, not a framework requirement.

2. **Runtime matching receives `permissionName` from the incoming request** — `request.permission.name` is provided by the Backstage framework. The stored name is not the only source.

3. **The HTTP resolution had a `.find()` bug** — when a plugin registers multiple permissions with the same `(resourceType, action)` (e.g., scaffolder's `template.parameter.read` and `template.step.read`), `.find()` picks the first match arbitrarily. The stored name could be wrong.

4. **`isPermission()` checks only `name`** — `return permission.name === comparedPermission.name`. Users who know the permission name can provide it directly without HTTP resolution.

## Solution

Eliminate the HTTP metadata dependency. Make `permissionMapping` accept both formats — actions (broad match) and `{name, action}` objects (specific match). No DB migration needed — existing data with names is already valid.

### Action-only (broad match)

```yaml
permissionMapping:
  - read
```

Matches ALL permissions with action `read` for the given `resourceType`. Equivalent to Backstage's `isResourcePermission()` + `isReadPermission()` code pattern.

### With name (specific match)

```yaml
permissionMapping:
  - name: scaffolder.template.parameter.read
    action: read
```

Matches ONLY the named permission. Equivalent to Backstage's `isPermission(request.permission, templateParameterReadPermission)` code pattern.

### Mixed (both in one policy)

```yaml
permissionMapping:
  - read
  - name: scaffolder.template.step.read
    action: read
```

Both formats can coexist in the same `permissionMapping` array.

### REST API

Both formats accepted in POST/PUT request bodies:

```json
{ "permissionMapping": ["read", "update"] }
```

```json
{
  "permissionMapping": [
    { "name": "scaffolder.template.parameter.read", "action": "read" }
  ]
}
```

## No DB Migration Required

Existing DB data `[{"name":"catalog.entity.read","action":"read"}]` is already valid `PermissionInfo[]`, which is part of the `PermissionMapping` union type. Old data works unchanged — conditions with names continue to match by name. New entries can use either format.

## No Breaking Changes

| Area                  | Breaking?        | Details                                                                                     |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| YAML files            | **No**           | `permissionMapping: ['read']` works as before                                               |
| REST API request      | **No**           | Accepts both `['read']` and `[{name, action}]`                                              |
| REST API response     | **No**           | Already returned actions only (names were stripped)                                         |
| Provider interface    | **No**           | `RoleConditionalPolicyDecision` accepts `PermissionMapping[]` — both formats                |
| Frontend              | **No**           | Already works with actions only                                                             |
| DB                    | **No migration** | Existing `{name, action}` data is valid `PermissionInfo`, part of `PermissionMapping` union |
| `PermissionInfo` type | **Kept**         | Still exported, part of `PermissionMapping` union                                           |
| Reversibility         | **Full**         | No data transformation — code revert restores original behavior                             |

## Benefits

### 1. Startup race condition eliminated architecturally

Not a retry/workaround — the HTTP call that caused the race doesn't exist anymore. Zero HTTP calls during startup for conditional policy reconciliation.

### 2. Pre-existing `.find()` bug fixed

`processConditionMapping()` used `.find()` which picks the first match for `(resourceType, action)`. For scaffolder with two permissions sharing `(scaffolder-template, read)`, it stored an arbitrary name. Now users choose: action-only for broad match, or `{name, action}` for the exact permission they want.

### 3. Full coverage of Backstage code-based policy patterns

| Backstage code pattern                                                  | RBAC data-driven equivalent                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `isResourcePermission(req, 'catalog-entity')` + `isReadPermission(req)` | `permissionMapping: ['read']`                                                       |
| `isPermission(req, templateParameterReadPermission)`                    | `permissionMapping: [{name: 'scaffolder.template.parameter.read', action: 'read'}]` |

Previously RBAC could only approximate the first pattern (and did it incorrectly via `.find()`). Now both patterns are fully supported.

### 4. Performance improvement

Removed HTTP round-trips (network I/O, auth token, JSON parse) for every condition creation/update and startup reconciliation. Replaced with direct in-memory storage.

### 5. Implicit coupling removed

RBAC plugin no longer depends on other plugins' HTTP routes being mounted during startup. No cross-plugin timing dependency.

### 6. Code simplification

Net **-348 lines** of code (including tests). Deleted:

- `processConditionMapping()` (~50 lines) — the HTTP fetch function
- `permissionMappingToActions()` — adapter function
- All `.map(pm => pm.action)` strips throughout REST API, file watcher, connect-providers
- `PluginPermissionMetadataCollector` removed from file watcher and permission-policy constructor

Added:

- `permissionMappingAction()` — one-line utility to extract action from either format
- `isPermissionInfo()` — one-line type guard
- `PermissionMapping` — union type `PermissionAction | PermissionInfo`

## (resourceType, action) Collision Analysis

We scanned the entire Backstage ecosystem for plugins with multiple permissions sharing the same `(resourceType, action)`:

| Plugin         | Collision                        | Uses `authorizeConditional`? | Impact                                                                                     |
| -------------- | -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| **Scaffolder** | `(scaffolder-template, read)` x2 | **Yes**                      | Users can use `{name, action}` to target specific permission, or action-only to match both |
| Azure DevOps   | `(catalog-entity, read)` x4      | No (basic ALLOW/DENY)        | None — no conditional policies used                                                        |
| BlackDuck      | `(catalog-entity, read)` x2      | No                           | None                                                                                       |
| Playlist       | `(playlist-list, update)` x2     | No                           | None                                                                                       |

**Only scaffolder has a real collision with conditional permissions.** The `{name, action}` format gives users explicit control over which permission to target. Action-only format matches all permissions with that action — which is often the desired behavior (same condition for both parameter.read and step.read).

## Runtime Matching Logic

`filterConditions` handles both formats:

```typescript
condition.permissionMapping.some(
  entry =>
    permissionMappingAction(entry) === action &&
    (!permissionName ||
      !isPermissionInfo(entry) ||
      entry.name === permissionName),
);
```

- **Stored `'read'` (action-only):** matches any request with action `read` regardless of permission name
- **Stored `{name: 'catalog.entity.read', action: 'read'}`:** matches only when request's `permission.name` equals `catalog.entity.read`
- **No `permissionName` in query (e.g., internal lookups):** matches by action only

## Files Modified

### Source (15 files)

| File                                                                 | Change                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rbac-common/src/types.ts`                                           | `PermissionMapping` union type, `isPermissionInfo`, `permissionMappingAction`  |
| `rbac-node/src/types/types.ts`                                       | Provider interface uses `RoleConditionalPolicyDecision` (accepts both formats) |
| `rbac-backend/src/helper.ts`                                         | Deleted `processConditionMapping`, `permissionMappingToActions`                |
| `rbac-backend/src/database/conditional-storage.ts`                   | Name-aware matching in `filterConditions`                                      |
| `rbac-backend/src/policies/permission-policy.ts`                     | Pass `permissionName` to `filterConditions`                                    |
| `rbac-backend/src/service/policies-rest-api.ts`                      | Removed processConditionMapping calls                                          |
| `rbac-backend/src/file-permissions/yaml-conditional-file-watcher.ts` | Removed auth, metadata collector, staging loop                                 |
| `rbac-backend/src/providers/connect-providers.ts`                    | Works with both formats                                                        |
| `rbac-backend/src/service/policy-builder.ts`                         | Removed metadata collector param                                               |
| `rbac-backend/src/validation/condition-validation.ts`                | Handle mixed `PermissionMapping[]` via `permissionMappingAction()`             |
| `rbac/dev/mocks.ts`                                                  | Updated types                                                                  |
| `rbac/src/api/RBACBackendClient.ts`                                  | Updated types                                                                  |
| `rbac/src/types.ts`                                                  | Updated types                                                                  |
| `rbac/src/utils/rbac-utils.ts`                                       | Use `permissionMappingAction()`                                                |

### Tests (13 files updated)

961 tests pass (2 pre-existing failures on main unrelated to this change).

## Comparison with PR #9770 (Retry Fix)

| Aspect           | PR #9770 (Retry)                          | This branch                                                   |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Approach         | Retry HTTP calls with exponential backoff | Eliminate HTTP calls, accept both formats                     |
| Root cause       | Mitigated (retry)                         | Eliminated (no HTTP)                                          |
| Code change      | +533 lines                                | -348 lines net                                                |
| New config       | `conditionalMetadataRetry` (3 options)    | None                                                          |
| DB migration     | None                                      | **None**                                                      |
| Breaking changes | None                                      | **None**                                                      |
| Reversibility    | Easy                                      | **Easy** (no data transformation)                             |
| `.find()` bug    | Still present                             | Fixed                                                         |
| New capabilities | None                                      | `{name, action}` for fine-grained matching                    |
| Performance      | Same (still HTTP)                         | Improved (no HTTP)                                            |
| Risk             | Low                                       | **Low** (no migration, no breaking changes, fully reversible) |
