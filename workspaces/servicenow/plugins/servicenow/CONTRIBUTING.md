# Contributing — ServiceNow frontend

Contributor guide for `@backstage-community/plugin-servicenow`. For install and operator-facing setup, see the [package README](./README.md) and workspace [docs](../../docs/index.md).

## Prerequisites

- Node.js matching the workspace `engines` field in `workspaces/servicenow/package.json`
- Yarn (Berry) as used by this repository
- From `workspaces/servicenow`: `yarn install`

## Dev harness

Start the frontend plugin in isolation (mock backend):

```bash
# From workspaces/servicenow
yarn workspace @backstage-community/plugin-servicenow start:mock
```

This is the default frontend-only workflow. Playwright UI tests also use `start:mock` (no live backend).

### Frontend + backend (live API)

From the workspace root, start both plugin harnesses (no full Backstage app required):

```bash
# From workspaces/servicenow — export ServiceNow env vars first if you need a live instance
yarn start
```

See the [workspace CONTRIBUTING.md](../../CONTRIBUTING.md) and [backend CONTRIBUTING.md](../servicenow-backend/CONTRIBUTING.md) for credentials.

`yarn workspace @backstage-community/plugin-servicenow start` uses the live `dev/index.tsx` harness (real `ServiceNowBackendClient`). The backend must be running on port 7007.

Live pages:

- http://localhost:3000/servicenow — Component entity-id filter
- http://localhost:3000/servicenow-user — guest User “my tickets” (`guest@example.com`)

Guest email setup is in [Development.md](../../docs/Development.md).

## Scoped validation

```bash
# From workspaces/servicenow
yarn workspace @backstage-community/plugin-servicenow test
yarn workspace @backstage-community/plugin-servicenow lint
yarn tsc
```

Shared helpers:

```bash
yarn workspace @backstage-community/plugin-servicenow-common test
```

## Playwright note

Workspace Playwright under `plugins/servicenow/tests/` is **UI mock smoke** against `start:mock`. It is **not** proof of backend integration or live ServiceNow connectivity, and it is not the merge gate for Backstage version-bump trust.

## Smoke checklist (bump / PR review)

1. Frontend package tests pass (includes `ServiceNowBackendClient` discovery/auth coverage).
2. Optional: `yarn start` from the workspace (both harnesses) and exercise the UI.
3. Backend mount and Table API client contracts are covered by `@backstage-community/plugin-servicenow-backend` tests — run those for bump trust.

## When you need something beyond the harnesses

This workspace is **plugin-only**. Do not add `packages/app` or `packages/backend` here.

| Need                                              | Where                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| Day-to-day frontend / combined smoke              | `yarn start` (both harnesses) or `start:mock` + scoped tests         |
| Production-like catalog entity page in a full app | A separate consumer Backstage deployment                             |
| Live ServiceNow credential-backed e2e suites      | Outside this workspace (consumer deployment or separate e2e harness) |
