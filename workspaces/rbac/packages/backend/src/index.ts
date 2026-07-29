/*
 * Performance-test backend harness.
 * OIDC auth + catalog + permission + rbac only (no app/search/scaffolder/techdocs).
 *
 * Based on plugins/rbac-backend/dev/index.ts with guest auth swapped for OIDC.
 */

import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'));

backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage-community/plugin-rbac-backend'));

backend.start();
