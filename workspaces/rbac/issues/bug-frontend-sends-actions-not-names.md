# 🚀 RBAC: Update frontend to send `{name, action}` format for conditional policies

### Workspace

rbac

### 🔖 Feature description

In the frame of the `.find()` bug fix (#XXX) and the broad matching enhancement (#ZZZ), the backend `permissionMapping` format has been updated. REST API POST/PUT now requires `{name, action}` format and rejects plain action strings.

The frontend needs to be updated to send `{name, action}` instead of plain action strings. Currently the frontend has the permission name available (it displays it in the UI) but discards it when building the POST/PUT request body.

### 🎤 Context

The backend changes:
- `processConditionMapping()` deleted — no more server-side HTTP name resolution
- REST API POST/PUT requires `{name, action}` format (rejects `['read']` with `InputError`)
- YAML and provider extension point accept both `['read']` (broad) and `{name, action}` (specific)
- Frontend and backend must be upgraded together

Without this frontend update, the RBAC UI cannot create or edit conditional policies — POST/PUT requests with `['read']` will be rejected by the backend.

### ✌️ Possible Implementation

In `plugins/rbac/src/utils/create-role-utils.ts`, function `getConditionalPermissionPoliciesData`:

```typescript
// Before: discards permission name
const action = policy.policy.toLocaleLowerCase(locale) as PermissionAction;
return [...pAcc, action];

// After: includes permission name when available
const action = policy.policy.toLocaleLowerCase(locale) as PermissionAction;
return permission
  ? [...pAcc, { name: permission, action }]
  : [...pAcc, action];
```

In `plugins/rbac/src/utils/rbac-utils.ts`, function `getConditionalPermissionsData` — handle both formats when displaying conditions:

```typescript
return cp.permissionMapping.some(entry => {
  // {name, action} → match by specific permission name
  if (isPermissionInfo(entry)) {
    return po.name === entry.name;
  }
  // plain action string → broad match, all permissions with this action
  return po.policy.toLocaleLowerCase(locale) === entry.toLocaleLowerCase(locale);
});
```

Display behavior:
- **Specific conditions** (`{name, action}`, source: rest) — editable in UI
- **Broad conditions** (`['read']`, source: csv-file or provider extension point) — read-only in UI, shows all matching permissions for the resourceType and action

### 👀 Have you spent some time to check if this feature request has been raised before?

- [x] I checked and didn't find similar issue

### 🏢 Have you read the Code of Conduct?

- [x] I have read the [Code of Conduct](https://github.com/backstage/community-plugins/blob/main/CODE_OF_CONDUCT.md)

### Are you willing to submit PR?

Yes I am willing to submit a PR!
