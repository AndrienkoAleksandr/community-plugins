# Contributing — ServiceNow backend

Contributor guide for `@backstage-community/plugin-servicenow-backend`. For install and operator configuration, see the [package README](./README.md) and [Configuration.md](../../docs/Configuration.md).

## Prerequisites

- Node.js matching the workspace `engines` field in `workspaces/servicenow/package.json`
- Yarn (Berry) as used by this repository
- From `workspaces/servicenow`: `yarn install`

## Dev harness

| Goal                       | Command (from `workspaces/servicenow`)                                |
| -------------------------- | --------------------------------------------------------------------- |
| Frontend + backend (guest) | `yarn start`                                                          |
| Backend-only REST work     | `yarn workspace @backstage-community/plugin-servicenow-backend start` |
| UI work (mocked APIs)      | `yarn workspace @backstage-community/plugin-servicenow start:mock`    |

[`app-config.yaml`](./app-config.yaml) in this package is the harness config (listen port, CORS, guest auth, and ServiceNow keys). Optional overrides can go in an untracked `app-config.local.yaml` next to that file. Only one backend `dev/` harness should listen on port **7007** at a time.

### Preferred: start frontend and backend together

[Set env variables](#environment-setup). From the workspace root, start both plugin harnesses (no full Backstage app required):

```bash
# From workspaces/servicenow — export ServiceNow env vars first if you need a live instance
yarn start
```

See the [workspace CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

### Backend-only

```bash
# From workspaces/servicenow
yarn workspace @backstage-community/plugin-servicenow-backend start
```

### Environment setup

If Table API Basic auth returns `User is not authenticated` / `Required to provide Auth information` with username and password set, the instance is not accepting Basic auth. This harness uses **OAuth password grant** instead of `basicAuth`.

In ServiceNow: **All → Application registry → New → Create an OAuth API endpoint for external clients**. Set a name, a Client Secret, **Client Type: Integration as a User**, submit, copy the **Client ID**.

Export these variables (local-only — do not commit secrets):

| Variable                     | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `BACKSTAGE_DEV_STATIC_TOKEN` | Static bearer token for authenticated `curl` calls               |
| `SERVICENOW_BASE_URL`        | ServiceNow instance URL (e.g. `https://example.service-now.com`) |
| `SERVICENOW_USERNAME`        | Username for the OAuth password grant                            |
| `SERVICENOW_PASSWORD`        | Password for the OAuth password grant                            |
| `SERVICENOW_CLIENT_ID`       | OAuth client ID from Application registry                        |
| `SERVICENOW_CLIENT_SECRET`   | OAuth client secret from Application registry                    |

Example:

```bash
export BACKSTAGE_DEV_STATIC_TOKEN=abcdefgi
export SERVICENOW_BASE_URL=https://example.service-now.com
export SERVICENOW_USERNAME=test-user
export SERVICENOW_PASSWORD=test-password
export SERVICENOW_CLIENT_ID=client-id
export SERVICENOW_CLIENT_SECRET=client-secret
```

Confirm the token endpoint before `yarn start`:

```bash
curl -sS -u "${SERVICENOW_CLIENT_ID}:${SERVICENOW_CLIENT_SECRET}" \
  -d "grant_type=password&username=${SERVICENOW_USERNAME}&password=${SERVICENOW_PASSWORD}" \
  "${SERVICENOW_BASE_URL}/oauth_token.do"
```

A successful response includes `access_token`. Then restart `yarn start` from this same shell.

See [Configuration.md](../../docs/Configuration.md) for operator OAuth details. Do not set `servicenow.basicAuth` at the same time as `servicenow.oauth`.

### Curl smoke (manual)

`/incidents` requires **user** credentials (`httpAuth` with `allow: ['user']`). A static `backend.auth.externalAccess` token is a **service** principal and will not satisfy that check — do not widen the allow list without maintainer agreement.

Get a guest user token (after the backend harness is up):

```bash
TOKEN=$(curl -s http://localhost:7007/api/auth/guest/refresh -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).backstageIdentity.token))")
```

Health:

```bash
curl -H "Authorization: Bearer ${BACKSTAGE_DEV_STATIC_TOKEN}" \
  -sS http://localhost:7007/api/servicenow/health
```

List incidents (needs ServiceNow env vars and a **user** token):

```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  -sS "http://localhost:7007/api/servicenow/incidents"
```

For UI / incident smoke, prefer `yarn start` so both harnesses run together (see workspace guide). You do not need to scaffold `packages/app` / `packages/backend` in this workspace.

## Scoped validation

```bash
# From workspaces/servicenow
yarn workspace @backstage-community/plugin-servicenow-backend test
yarn workspace @backstage-community/plugin-servicenow-backend lint
yarn tsc
```

Shared library contracts live in `@backstage-community/plugin-servicenow-common`:

```bash
yarn workspace @backstage-community/plugin-servicenow-common test
```

## Smoke checklist (bump / PR review)

1. Backend package tests pass (includes `plugin.integration.test.ts` mount + health).
2. Optional: `yarn start` from the workspace (both harnesses) and exercise the UI / hit `/api/servicenow/health`.
3. Do **not** rely on workspace Playwright for backend trust — that suite is frontend UI mock smoke only (`start:mock`).

## When you need something beyond the harnesses

This workspace is **plugin-only**. Do not add `packages/app` or `packages/backend` here.

| Need                                              | Where                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| Day-to-day backend / combined smoke               | `yarn start` (both harnesses) or this package `dev/` + scoped tests  |
| Production-like catalog entity page in a full app | A separate consumer Backstage deployment                             |
| Live ServiceNow credential-backed e2e suites      | Outside this workspace (consumer deployment or separate e2e harness) |
