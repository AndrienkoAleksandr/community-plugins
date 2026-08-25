# Contributing — ServiceNow workspace

Plugin-only workspace for `@backstage-community/plugin-servicenow*`. There is **no** in-repo `packages/app` / `packages/backend`; use the plugin `dev/` harnesses and scoped package tests.

## Start both harnesses

From this directory, `backstage-cli repo start` launches the frontend and backend plugin harnesses together (live API, guest auth):

```bash
# From workspaces/servicenow
yarn start
```

That is the preferred local smoke path — you do **not** need a full Backstage application in this workspace. For ServiceNow instance credentials when exercising the backend, see [plugins/servicenow-backend/CONTRIBUTING.md](./plugins/servicenow-backend/CONTRIBUTING.md). Guest email vs integration account is in [docs/Development.md](./docs/Development.md).

You can still start a single package when needed:

```bash
yarn workspace @backstage-community/plugin-servicenow start:mock
yarn workspace @backstage-community/plugin-servicenow start
yarn workspace @backstage-community/plugin-servicenow-backend start
```

| Command                                                               | What                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `yarn start`                                                          | Frontend live + backend (guest auth)                            |
| `yarn workspace @backstage-community/plugin-servicenow start:mock`    | Frontend UI with mocked ServiceNow APIs                         |
| `yarn workspace @backstage-community/plugin-servicenow start`         | Frontend live (`dev/index.tsx`); needs the backend on port 7007 |
| `yarn workspace @backstage-community/plugin-servicenow-backend start` | Backend-only REST harness                                       |

## Package test commands

| Package  | Command                                                              |
| -------- | -------------------------------------------------------------------- |
| Backend  | `yarn workspace @backstage-community/plugin-servicenow-backend test` |
| Frontend | `yarn workspace @backstage-community/plugin-servicenow test`         |
| Common   | `yarn workspace @backstage-community/plugin-servicenow-common test`  |

Typecheck from this directory: `yarn tsc`.

## Contributor guides

- [Backend CONTRIBUTING.md](./plugins/servicenow-backend/CONTRIBUTING.md)
- [Frontend CONTRIBUTING.md](./plugins/servicenow/CONTRIBUTING.md)
