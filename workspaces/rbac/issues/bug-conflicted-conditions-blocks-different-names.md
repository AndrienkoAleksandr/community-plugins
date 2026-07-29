# Bug: `checkConflictedConditions` blocks separate conditional policies for different permission names with the same action

## PR Title

`fix(rbac): allow separate conditional policies for different permission names sharing the same resourceType and action`

## Workspace

rbac

## Description

`checkConflictedConditions()` in `conditional-storage.ts` throws `ConflictError` when creating a second conditional policy with the same `(roleEntityRef, pluginId, resourceType, action)` — even when the two policies target different permission names.

This prevents RBAC admins from defining fine-grained conditional policies for plugins that register multiple permissions with the same `(resourceType, action)` pair but different semantics.

## Affected Plugins

| Plugin | Use Case | Blocked By This Bug |
|--------|----------|-------------------|
| Scaffolder | Different conditions for template parameter visibility vs step execution | Yes — both `parameter.read` and `step.read` have `(scaffolder-template, read)` |
| Playlist | Different conditions for playlist editing vs following | Yes — both `list.update` and `followers.update` have `(playlist-list, update)` |

## Reproduction Steps

1. Create a conditional policy for `playlist.list.update`:
   ```json
   {
     "result": "CONDITIONAL",
     "roleEntityRef": "role:default/test",
     "pluginId": "playlist",
     "resourceType": "playlist-list",
     "permissionMapping": [{"name": "playlist.list.update", "action": "update"}],
     "conditions": {"rule": "IS_OWNER", "resourceType": "playlist-list", "params": {"owners": ["$ownerRefs"]}}
   }
   ```
2. Create a second conditional policy for `playlist.followers.update` (same role, same resourceType, same action, **different name**):
   ```json
   {
     "result": "CONDITIONAL",
     "roleEntityRef": "role:default/test",
     "pluginId": "playlist",
     "resourceType": "playlist-list",
     "permissionMapping": [{"name": "playlist.followers.update", "action": "update"}],
     "conditions": {"rule": "IS_PUBLIC", "resourceType": "playlist-list", "params": {}}
   }
   ```
3. Second request fails with `ConflictError`:
   ```
   Found condition with conflicted permission action '["update"]'. Role could have multiple conditions for the same resource type 'playlist-list', but with different permission action sets.
   ```

## Expected Behavior

Two conditional policies with different permission names but the same action should be allowed. The conflict check should compare `(roleEntityRef, pluginId, resourceType, action, name)` — not just `(roleEntityRef, pluginId, resourceType, action)`.

## Actual Behavior

`checkConflictedConditions` compares only by action, ignoring the permission name. Any two conditions with the same action for the same role/plugin/resourceType are treated as conflicts.

## Impact

- Cannot have separate conditions for `playlist.list.update` (IS_OWNER) and `playlist.followers.update` (IS_PUBLIC) on the same role
- Cannot have separate conditions for `scaffolder.template.parameter.read` and `scaffolder.template.step.read` on the same role
- Admins cannot express fine-grained conditional access for plugins with `(resourceType, action)` collisions

## Real-world example

An admin wants:
- Only playlist owners can edit playlist content (`playlist.list.update` → IS_OWNER)
- Anyone can follow/unfollow public playlists (`playlist.followers.update` → IS_PUBLIC)

This is a natural RBAC configuration but is currently impossible for a single role.
