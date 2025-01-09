/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { LoggerService } from '@backstage/backend-plugin-api';
import { mockServices } from '@backstage/backend-test-utils';
import { Config } from '@backstage/config';

import { AuditLogger } from '@janus-idp/backstage-plugin-audit-log-node';
import {
  Adapter,
  Enforcer,
  // Filter,
  FilteredAdapter,
  Model,
  newEnforcer,
  // newModelFromString,
  RoleManager,
} from 'casbin';
import * as Knex from 'knex';
import { MockClient } from 'knex-mock-client';

import { CasbinDBAdapterFactory } from '../src/database/casbin-adapter-factory';
import { RoleMetadataStorage } from '../src/database/role-metadata';
import { RBACPermissionPolicy } from '../src/policies/permission-policy';
import { BackstageRoleManager } from '../src/role-manager/role-manager';
import { EnforcerDelegate } from '../src/service/enforcer-delegate';
// import { MODEL } from '../src/service/permission-model';
import { PluginPermissionMetadataCollector } from '../src/service/plugin-endpoints';
import {
  catalogApiMock,
  conditionalStorageMock,
  csvPermFile,
  mockAuthService,
  mockClientKnex,
  pluginMetadataCollectorMock,
  roleMetadataStorageMock,
} from './mock-utils';

export function auditLogger(): AuditLogger {
  return {
    getActorId: jest.fn().mockImplementation(),
    createAuditLogDetails: jest.fn().mockImplementation(),
    auditLog: jest.fn().mockImplementation(),
  };
}

export function newConfig(
  permFile?: string,
  users?: Array<{ name: string }>,
  superUsers?: Array<{ name: string }>,
): Config {
  const testUsers = [
    {
      name: 'user:default/guest',
    },
    {
      name: 'group:default/guests',
    },
  ];

  return mockServices.rootConfig({
    data: {
      permission: {
        rbac: {
          'policies-csv-file': permFile || csvPermFile,
          policyFileReload: true,
          admin: {
            users: users || testUsers,
            superUsers: superUsers,
          },
        },
      },
      backend: {
        database: {
          client: 'better-sqlite3',
          connection: ':memory:',
        },
      },
    },
  });
}

export async function newAdapter(config: Config): Promise<Adapter> {
  return await new CasbinDBAdapterFactory(
    config,
    mockClientKnex,
  ).createAdapter();
}

// export function newMockRoleManager(): RoleManager {
//   return {
//     addLink: jest.fn().mockImplementation(),
//     deleteLink: jest.fn().mockImplementation(),
//     hasLink: jest.fn().mockImplementation(),
//     getRoles: jest.fn().mockImplementation(),
//     getUsers: jest.fn().mockImplementation(),
//     printRoles: jest.fn().mockImplementation(),
//     clear: jest.fn().mockImplementation(),
//   }
// }

export async function createEnforcer(
  theModel: Model,
  adapter: Adapter,
  logger: LoggerService,
  config: Config,
): Promise<Enforcer> {
  const catalogDBClient = Knex.knex({ client: MockClient });
  const rbacDBClient = Knex.knex({ client: MockClient });
  const enf = await newEnforcer(theModel, adapter);

  const rm = new BackstageRoleManager(
    catalogApiMock,
    logger,
    catalogDBClient,
    rbacDBClient,
    config,
    mockAuthService,
  );
  enf.setRoleManager(rm);
  enf.enableAutoBuildRoleLinks(false);
  await enf.buildRoleLinks();

  return enf;
}

export async function newEnforcerDelegate(
  adapter: FilteredAdapter,
  config: Config,
  storedPolicies?: string[][],
  storedGroupingPolicies?: string[][],
): Promise<EnforcerDelegate> {
  const logger = mockServices.logger.mock();

  const rm = createRoleManager(logger, config);

  const enf = new EnforcerDelegate(
    adapter,
    rm,
    roleMetadataStorageMock,
    mockClientKnex,
  );

  if (storedPolicies) {
    await enf.addPolicies(storedPolicies);
  }

  if (storedGroupingPolicies) {
    await enf.addGroupingPolicies(storedGroupingPolicies, {
      source: 'rest',
      roleEntityRef: 'role:default/test',
      modifiedBy: 'user: default/test',
    });
  }

  return enf;
}

export function createRoleManager(
  logger: LoggerService,
  config: Config,
): RoleManager {
  const catalogDBClient = Knex.knex({ client: MockClient });
  const rbacDBClient = Knex.knex({ client: MockClient });

  return new BackstageRoleManager(
    catalogApiMock,
    logger,
    catalogDBClient,
    rbacDBClient,
    config,
    mockAuthService,
  );
}

export async function newPermissionPolicy(
  config: Config,
  enfDelegate: EnforcerDelegate,
  roleMock?: RoleMetadataStorage,
): Promise<RBACPermissionPolicy> {
  const logger = mockServices.logger.mock();
  const auditLoggerMock = auditLogger();
  const permissionPolicy = await RBACPermissionPolicy.build(
    logger,
    auditLoggerMock,
    config,
    conditionalStorageMock,
    enfDelegate,
    roleMock || roleMetadataStorageMock,
    mockClientKnex,
    pluginMetadataCollectorMock as PluginPermissionMetadataCollector,
    mockAuthService,
  );
  (auditLoggerMock.auditLog as jest.Mock).mockReset();
  return permissionPolicy;
}
