# Research: Eliminate HTTP Metadata Dependency from RBAC Conditional Policies

**Date:** 2026-07-13 — 2026-07-14
**Authors:** Oleksandr Andriienko + Claude Code (9 LLM Council sessions)
**Branch:** `fix/rbac-remove-permission-names`
**Status:** Implementation complete (961 tests pass), awaiting colleague review
**Related:** Issue #9429, PR #9770 (community retry fix), PR #9731 (non-destructive reconcile)

---

## TL;DR

Eliminated HTTP permission metadata dependency from the RBAC plugin by making `permissionMapping` accept both action strings (broad match) and `{name, action}` objects (specific match). No DB migration, no breaking changes, fully reversible. Fixes startup race condition (#9429), pre-existing `.find()` bug, and adds new capability for fine-grained permission targeting.

---

## The Problem

RBAC plugin fetches permission metadata via HTTP from other plugins during startup to resolve `action → permission name` (e.g., `'read'` → `'catalog.entity.read'`). If the target plugin isn't ready yet → race condition → conditional policies not applied.

## Three Pre-existing Bugs Discovered

### Bug 1: `.find()` picks arbitrary permission name — FIXED

`processConditionMapping()` uses `.find()` to resolve `action → name`. For plugins with multiple permissions sharing `(resourceType, action)`, it picks the first match arbitrarily. The stored name could be wrong.

**Fixed by:** Deleting `processConditionMapping()` entirely. Users now choose: action-only (broad match) or `{name, action}` (specific match).

### Bug 2: `checkConflictedConditions` prevents separate conditions per name — DEFERRED

`checkConflictedConditions` throws `ConflictError` when you try to store two conditions with the same `(roleEntityRef, pluginId, resourceType, action)` — even if they target different permission names.

On main branch this was invisible because `.find()` always picked the same name. With `{name, action}` format users can now express different names — but `checkConflictedConditions` still blocks them.

**Deferred to:** Separate PR with colleague — needs conflict detection logic change, potential DB constraint update, frontend update, documentation.

### Bug 3: Frontend shows names but stores only actions

Frontend shows specific permission names (e.g., `catalog.entity.read`) when creating conditional policies, but POST sends only the action (`['read']`). The name is displayed but not stored. User thinks they're targeting a specific permission but they're not.

**Deferred to:** Frontend update in future PR.

---

## Key Discoveries

### Backstage's `ConditionalPolicyDecision` has NO `permissionName` field

```typescript
// @backstage/plugin-permission-common
type ConditionalPolicyDecision = {
  result: AuthorizeResult.CONDITIONAL;
  pluginId: string;
  resourceType: string;
  conditions: PermissionCriteria<PermissionCondition>;
  // NO permissionName!
};
```

Storing names was an RBAC-specific addition, not a framework requirement.

### `isPermission()` checks only name

```typescript
function isPermission(permission, comparedPermission) {
  return permission.name === comparedPermission.name;
}
```

Our `{name, action}` format provides the data-driven equivalent of this code-based check.

### (resourceType, action) Collisions Exist Across Ecosystem

| Plugin | Collision | Uses conditional? | Separate conditions per name useful? |
|--------|-----------|-------------------|--------------------------------------|
| **Scaffolder** | `(scaffolder-template, read)` x2: `parameter.read`, `step.read` | **Yes** | **No** — both always receive identical conditions (`hasTag` rule). Hiding parameters but showing steps makes no sense. |
| **Azure DevOps** | `(catalog-entity, read)` x4: `pullrequest.read`, `pipeline.read`, `gittag.read`, `readme.read` | No (basic ALLOW/DENY) | **Yes** — different sensitivity: "juniors see readme/tags but not pipelines/PRs for sensitive entities" |
| **BlackDuck** | `(catalog-entity, read)` x2: `riskprofile.read`, `vulnerabilities.read` | No | **Yes** — vulnerability data more sensitive than general risk profiles |
| **Playlist** | `(playlist-list, update)` x2: `list.update`, `followers.update` | No | **Yes** — following is less privileged than editing playlist content |

Three of four collision cases would benefit from separate conditions per name — but none of them currently use conditional permissions. This validates the `{name, action}` format as forward-looking design.

---

## Solution: `PermissionMapping` Union Type

### `permissionMapping` accepts both formats

```typescript
export type PermissionMapping = PermissionAction | PermissionInfo;

// Action-only: broad match
permissionMapping: ['read']

// With name: specific match
permissionMapping: [{ name: 'scaffolder.template.parameter.read', action: 'read' }]

// Mixed
permissionMapping: ['read', { name: 'scaffolder.template.step.read', action: 'read' }]
```

### No DB migration required

Existing DB data `[{"name":"catalog.entity.read","action":"read"}]` is already valid `PermissionInfo[]`, part of the `PermissionMapping` union. Old data works unchanged — conditions with names continue to match by name.

### No breaking changes

| Area | Breaking? |
|------|-----------|
| YAML files | No — `['read']` works as before |
| REST API | No — accepts both formats |
| Provider interface | No — accepts both formats |
| Frontend | No — works with actions only |
| DB | No migration needed |
| Reversibility | Full — code revert restores original behavior |

### Code impact

- **-348 lines** net (including tests)
- Deleted: `processConditionMapping()`, `permissionMappingToActions()`, all `.map(pm => pm.action)` strips
- Added: `permissionMappingAction()` (one-line), `isPermissionInfo()` (one-line), `PermissionMapping` type

---

## Council Verdicts Summary

### Council 7 (final): Retry vs architectural fix

**Unanimous: Option B (eliminate HTTP) is correct architecture.** All models agree.

**2/3: Wait for colleague (6 days acceptable).** PR #9731 already prevents data corruption. No urgency.

**Unanimous: PR #9770 retry should NOT be merged as permanent solution.** +533 lines of retry infrastructure around a function that should be deleted is technical debt on arrival.

### Council 8: Fix `checkConflictedConditions` now or defer?

**Unanimous: Bug is real, must be fixed eventually.**

**2/3 (Gemini + GPT): Fix now** — shipping `{name, action}` without conflict detection update is "false capability."

**1/3 (Claude, rated strongest by reviewers): Defer** — PR already delivers meaningful change, layering second behavioral change makes it harder to review/revert/bisect. No user blocked today.

**Decision: Defer.** `{name, action}` has standalone value (fixes `.find()` bug, records intent, forward-compatible). Conflict detection fix = separate PR.

---

## When `checkConflictedConditions` Fix Becomes Useful

### Azure DevOps — different data sensitivity per feature

```yaml
# Condition A: PR data restricted to entity owners
---
result: CONDITIONAL
roleEntityRef: 'role:default/juniors'
pluginId: azure-devops
resourceType: catalog-entity
permissionMapping:
  - name: azure.devops.pullrequest.read
    action: read
conditions:
  rule: IS_ENTITY_OWNER
  resourceType: catalog-entity
  params:
    claims:
      - $ownerRefs
---
# Condition B: readme data available to all
result: CONDITIONAL
roleEntityRef: 'role:default/juniors'
pluginId: azure-devops
resourceType: catalog-entity
permissionMapping:
  - name: azure.devops.readme.read
    action: read
conditions:
  rule: IS_ENTITY_KIND
  resourceType: catalog-entity
  params:
    kinds: [component, system, api]
```

Currently blocked by `checkConflictedConditions` — both have `(role:default/juniors, azure-devops, catalog-entity, read)`.

### BlackDuck — vulnerability data more sensitive than risk profiles

```yaml
# Risk profile visible to all team members
---
result: CONDITIONAL
roleEntityRef: 'role:default/developers'
pluginId: blackduck
resourceType: catalog-entity
permissionMapping:
  - name: blackduck.riskprofile.read
    action: read
conditions:
  rule: IS_ENTITY_KIND
  resourceType: catalog-entity
  params:
    kinds: [component]
---
# Vulnerabilities restricted to security team
result: CONDITIONAL
roleEntityRef: 'role:default/developers'
pluginId: blackduck
resourceType: catalog-entity
permissionMapping:
  - name: blackduck.vulnerabilities.read
    action: read
conditions:
  rule: IS_ENTITY_OWNER
  resourceType: catalog-entity
  params:
    claims:
      - group:default/security-team
```

### Playlist — following less privileged than editing

```yaml
# Anyone can follow/unfollow playlists
---
result: CONDITIONAL
roleEntityRef: 'role:default/everyone'
pluginId: playlist
resourceType: playlist-list
permissionMapping:
  - name: playlist.followers.update
    action: update
conditions:
  rule: IS_PLAYLIST_PUBLIC
  resourceType: playlist-list
  params: {}
---
# Only owners can edit playlist content
result: CONDITIONAL
roleEntityRef: 'role:default/everyone'
pluginId: playlist
resourceType: playlist-list
permissionMapping:
  - name: playlist.list.update
    action: update
conditions:
  rule: IS_PLAYLIST_OWNER
  resourceType: playlist-list
  params:
    claims:
      - $ownerRefs
```

### What the fix requires

1. **`checkConflictedConditions`** — conflict only when same `(role, pluginId, resourceType, action)` AND same name (or both nameless). Different names = not a conflict. Named + nameless (broad) = conflict (broad already covers named).
2. **`handleConditions`** — may return multiple conditions for same action if they have different names. Needs matching by `request.permission.name` against stored name.
3. **Frontend** — send `{name, action}` when user selects a specific permission.
4. **Tests** — new test cases for multi-name scenarios.
5. **Documentation** — explain broad vs specific matching.

---

## Files to Reference

| File | Contents |
|------|----------|
| Branch `fix/rbac-remove-permission-names` | Working implementation (961 tests pass, 0 TS errors) |
| `CONDITIONAL-POLICIES-REDESIGN.md` | Benefits, no-migration rationale, comparison with retry |

## LLM Council Sessions (9 total)

1. **PR #9770 review** — merge with token freshness fix
2. **PermissionsRegistryService investigation** — why write-only, upstream PR status
3. **Brainstorming: 3 approaches** — remove names, require names, extension point
4. **Upstream contribution options** — rootLifecycle or pluginReadiness best chance
5. **Detailed implementation plan** — file-by-file, risk analysis
6. **Retry vs architectural fix (outdated)** — based on old "remove names" description
7. **Retry vs architectural fix (updated)** — based on correct "optional names, no migration" description
8. **Reproduction plan** — step-by-step guide for issue #9429
9. **checkConflictedConditions fix** — defer to separate PR
