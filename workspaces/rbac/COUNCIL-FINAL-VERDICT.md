# LLM Council Final Verdict: Conditional Policies Redesign

**Date:** 2026-07-14
**Council:** Claude Opus 4.6, Gemini 3 Pro, GPT-5.3 Codex
**Rating:** 9/10 — merge-grade quality
**Session:** 10th council session across this research

---

## Unanimous Agreement

1. **Merge-grade quality** (8.8–9/10). Net-negative lines (-355) while adding capability and fixing four bugs. No model raises doubts about the core design.

2. **End-to-end proof is sufficient.** Playlist and scaffolder exercise real `(resourceType, action)` collisions. Before/after contrast (ConflictError on main vs correct behavior) is the strongest possible evidence.

3. **PR #9770 must not be merged alongside this.** Retry code becomes dead code when HTTP calls are eliminated.

4. **Backward compatibility is the primary remaining risk.** Legacy action-only YAML must keep working.

5. **Zero DB migration is critical and was maintained.**

---

## End-to-End Proof Results

### Playlist plugin — `(playlist-list, update)` collision

| Action | team-a (owner) | team-b (not owner) |
|--------|---------------|-------------------|
| Edit own playlist | Works | N/A |
| Edit other's playlist | N/A | **403 Forbidden** (IS_OWNER) |
| Follow public playlist | Works | **Success** (IS_PUBLIC) |

Two conditions with same `(role, pluginId, playlist-list, update)` stored separately. On main branch: `ConflictError`.

### Scaffolder plugin — `(scaffolder-template, read)` collision

| | team-a | team-b |
|---|---|---|
| Wizard: Basic Info | Visible | Visible |
| Wizard: Secret Config | Visible | **HIDDEN** (parameter.read not HAS_TAG secret) |
| Wizard: DevOps Settings | Visible | Visible |
| Step: Log basic | Executed | Executed |
| Step: Log secret | Executed | Executed |
| Step: Deploy to cloud | Executed | **NOT EXECUTED** (step.read not HAS_TAG devops) |

`parameter.read` and `step.read` work **independently** through separate `{name, action}` conditional policies.

---

## Bugs Fixed (4)

1. **Startup race condition (#9429)** — eliminated architecturally (zero HTTP calls)
2. **`.find()` bug** — picked arbitrary name for `(resourceType, action)` collisions
3. **`checkConflictedConditions` bug** — blocked two conditions with same action even if different names
4. **Frontend dishonesty** — UI showed names but sent only actions

---

## Pre-merge Actions (from council, ordered by priority)

### 1. Backward-compatibility E2E test

Add a test showing legacy action-only YAML mappings (`permissionMapping: ['read']`) produce identical behavior to main branch. Most important gap identified by council.

### 2. Typo warning for `{name, action}` entries

**Council suggestion:** Validate `{name, action}` entries against registered permission names to catch typos like `scaffolder.template.paramater.read` (misspelled) that would silently never match.

**Our assessment:** This contradicts our architecture — we eliminated HTTP metadata fetch at startup, so there's no list of valid permission names available during YAML reconciliation. The metadata collector is only used for lazy frontend display routes.

**Options:**
- Defer — document that users are responsible for correct permission names (same as any YAML config)
- Log a warning if a `{name, action}` condition never matches after first runtime evaluation
- Validate lazily when the frontend metadata is fetched (non-blocking, informational only)

### 3. Document broad + specific precedence

If a role has both `'update'` (broad) and `{name: 'playlist.list.update', action: 'update'}` (specific), what happens?

**Current behavior:** `checkConflictedConditions` → `mappingEntriesConflict` returns `true` (broad conflicts with everything that has the same action). So this configuration is **rejected with ConflictError** — you cannot have both broad and specific for the same action.

**This is correct and needs documentation only, not a code change.**

### 4. Server-side validation for `{name, action}` payload

**Already implemented.** REST API POST/PUT validates that all `permissionMapping` entries include permission name. Plain action strings are rejected with clear error message: `"REST API requires permissionMapping entries to include permission name"`.

YAML file and providers still accept both formats.

### 5. Mixed-mapping regression test

Add test with one role having both legacy string actions and new `{name, action}` objects in the same policy file. Verifies coexistence in YAML scenarios.

---

## PR Strategy

### Title
```
fix(rbac): resolve 4 conditional policy bugs and enable per-permission conditions
```

### Description structure
- Lead with bug fixes (the 4 bugs)
- Include playlist/scaffolder before-after tables verbatim
- Prominent: "Migration: None required. Existing YAML is fully compatible."
- Reference #9429 for auto-close
- Changelog: **Fixed** (4 bugs). **Added** `{name, action}` specific matching. **No migration, no config changes, no breaking changes.**

### PR #9770 handling
- Supersede and close with respectful comment
- Acknowledge contributor's work in identifying race condition severity
- Explain that this implementation eliminates the root cause
- Offer credit in changelog as problem discoverer
- Do not merge both — retry code would be dead code

---

## Comparison with PR #9770

| Aspect | PR #9770 (Retry) | Our implementation |
|--------|------------------|--------------------|
| Lines of code | +533 | **-355 net** |
| Root cause | Mitigated (retry) | **Eliminated** (no HTTP) |
| DB migration | None | **None** |
| Breaking changes | None | **None** |
| Bugs fixed | 0 | **4** |
| New capability | None | **{name, action}** |
| Performance | Same | **Improved** |
| Reversibility | Easy | **Easy** |
| End-to-end proof | None | **2 plugins** |
| New config | 3 params | **None** |

---

## Council Clash Notes

**GPT rated strongest** (unanimously by all reviewers) for concrete actionable gaps.

**Gemini rated weakest on insight** — "congratulatory summary rather than review."

**Key reviewer catch all models missed:** Mixed-version rollout risk (old UI + new backend, or new UI + old backend during upgrades). Worth documenting but not blocking.

---

*10 LLM Council sessions total across this research project*
*Council composition: Claude Opus 4.6, Gemini 3 Pro, GPT-5.3 Codex*
