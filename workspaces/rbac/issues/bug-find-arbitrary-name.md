# 🐛 RBAC: `processConditionMapping` picks arbitrary permission name and creates HTTP startup dependency

### Workspace

rbac

### 📜 Description

When creating or updating conditional policies, the backend resolves `permissionMapping` action strings (e.g., `['read']`) to specific permission names via HTTP call to the plugin metadata endpoint using `processConditionMapping()`. This causes three problems:

1. **`.find()` picks an arbitrary name** when a plugin registers multiple permissions with the same `(resourceType, action)` pair but different names (named variants). For example, scaffolder has `scaffolder.template.parameter.read` and `scaffolder.template.step.read` — both `(scaffolder-template, read)`. `.find()` always picks the first match, making the stored name non-deterministic.

2. **HTTP dependency on startup** causes race condition (#9429). The YAML file watcher calls `processConditionMapping()` during plugin init. If the target plugin (e.g., catalog) hasn't mounted its HTTP routes yet → metadata fetch fails → conditional policies not applied.

3. **API inconsistency.** REST API and YAML accept `permissionMapping: ['read']` with `resourceType` — implying scoping by resourceType and action. But the backend silently converts to `[{name, action}]` — the API surface does not match actual behavior.

### 👍 Expected behavior

The backend should accept both formats in `permissionMapping` without HTTP resolution:
- **Action-only** `['read']` — broad match by resourceType and action
- **Named** `[{name: 'scaffolder.template.parameter.read', action: 'read'}]` — specific match by permission name

No HTTP calls needed for either format. Users control the scoping directly.

### 👎 Actual Behavior with Screenshots

1. User writes YAML with `permissionMapping: ['read']` for `scaffolder-template`
2. Backend calls HTTP endpoint, `.find()` picks `scaffolder.template.parameter.read` arbitrarily
3. DB stores `[{"name":"scaffolder.template.parameter.read","action":"read"}]`
4. `scaffolder.template.step.read` can never have an independent conditional policy
5. On startup, if the target plugin isn't ready → HTTP call fails → conditional policies not applied until restart

Affected plugins with named variants:

| Plugin | resourceType | action | Permission Names |
|---|---|---|---|
| Scaffolder | `scaffolder-template` | `read` | `parameter.read`, `step.read` |
| Playlist | `playlist-list` | `update` | `list.update`, `followers.update` |

### 👟 Reproduction steps

1. Configure RBAC with `pluginsWithPermission: [scaffolder]` and a conditional policies YAML file:
   ```yaml
   result: CONDITIONAL
   roleEntityRef: 'role:default/test'
   pluginId: scaffolder
   resourceType: scaffolder-template
   permissionMapping:
     - read
   conditions:
     rule: HAS_TAG
     resourceType: scaffolder-template
     params:
       tag: 'secret'
   ```
2. Start the backend
3. Check the database:
   ```sql
   SELECT permissions FROM "role-condition-policies"
   WHERE "roleEntityRef" = 'role:default/test' AND "pluginId" = 'scaffolder';
   ```
4. Observe: `permissions` column always contains `[{"name":"scaffolder.template.parameter.read","action":"read"}]` — the same arbitrary name regardless of user intent
5. Try creating a second conditional policy for `scaffolder.template.step.read` with the same action `read` → `ConflictError`

### 📃 Provide the context for the Bug.

This bug was reported as #9429 (startup race condition). Investigation revealed that the root cause is deeper — `processConditionMapping()` creates both the HTTP dependency and the `.find()` arbitrary name selection. The HTTP race condition is a symptom; the architectural issue is that the backend resolves names via HTTP instead of accepting user-provided formats directly.

The fix eliminates `processConditionMapping()` entirely, introduces `PermissionMapping = PermissionAction | PermissionInfo` union type, and makes all entry points (YAML, REST API, providers) accept both formats without HTTP calls.

### 👀 Have you spent some time to check if this bug has been raised before?

- [x] I checked and didn't find similar issue (related: #9429 reports the startup race condition symptom)

### 🏢 Have you read the Code of Conduct?

- [x] I have read the [Code of Conduct](https://github.com/backstage/community-plugins/blob/main/CODE_OF_CONDUCT.md)

### Are you willing to submit PR?

Yes I am willing to submit a PR!
