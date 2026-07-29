---
'@backstage-community/plugin-rbac-backend': minor
'@backstage-community/plugin-rbac-common': minor
'@backstage-community/plugin-rbac-node': minor
'@backstage-community/plugin-rbac': minor
---

Eliminated HTTP permission metadata dependency from conditional policy reconciliation, fixing the startup race condition (#9429) where conditional policies were not applied when target plugins hadn't mounted their routes yet.

**Fixed:**

- Startup race condition (#9429): removed HTTP calls to `/.well-known/backstage/permissions/metadata` during conditional policy reconciliation. Conditions are now stored directly without server-side name resolution.
- `.find()` bug: `processConditionMapping` picked an arbitrary permission name when multiple permissions shared the same `(resourceType, action)` pair. The function has been removed entirely.
- `checkConflictedConditions`: now allows separate conditional policies for different permission names with the same action (e.g., `playlist.list.update` and `playlist.followers.update`).
- Frontend: now sends `{name, action}` when creating conditional policies instead of discarding the permission name.

**Added:**

- `permissionMapping` accepts both formats: action-only `['read']` for broad matching (all permissions with this action) and `{name, action}` for specific permission targeting. This is the data-driven equivalent of Backstage's `isPermission()` code pattern.
- `PermissionMapping` union type, `isPermissionInfo()` type guard, and `permissionMappingAction()` utility exported from `@backstage-community/plugin-rbac-common`.
- REST API POST/PUT now requires `{name, action}` format for `permissionMapping` entries.

**Changed:**

- YAML conditional policies with action-only `permissionMapping` (e.g., `['read']`) now match ALL permissions with that action for the given `resourceType`. Previously, the backend resolved the action to a single arbitrary permission name via HTTP. This affects only plugins where multiple permissions share the same `(resourceType, action)` pair (scaffolder, playlist). To target a specific permission, use the `{name, action}` format.

**No DB migration required.** Existing data with `{name, action}` entries is already valid and continues to work unchanged. No breaking changes. Fully reversible.
