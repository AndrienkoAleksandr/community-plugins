---
'@backstage-community/plugin-servicenow': patch
'@backstage-community/plugin-servicenow-backend': patch
---

The workspace `yarn start` harness now runs the frontend against the live backend (guest auth). Isolated UI work and Playwright use `yarn workspace @backstage-community/plugin-servicenow start:mock`. Incident listing no longer fails when the ServiceNow user cannot read `sys_dictionary`; schema validation is skipped in that case.
