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
import {
  Enforcer,
  FilteredAdapter,
  newModelFromString,
  RoleManager,
} from 'casbin';
import { Knex } from 'knex';

import EventEmitter from 'events';

import { ADMIN_ROLE_NAME } from '../admin-permissions/admin-creation';
import {
  RoleMetadataDao,
  RoleMetadataStorage,
} from '../database/role-metadata';
import { mergeRoleMetadata } from '../helper';
import { MODEL } from './permission-model';

export type RoleEvents = 'roleAdded';
export interface RoleEventEmitter<T extends RoleEvents> {
  on(event: T, listener: (roleEntityRef: string | string[]) => void): this;
}

type EventMap = {
  [event in RoleEvents]: any[];
};

// TODO: rename to NonCahcedEnforcer
export class EnforcerDelegate implements RoleEventEmitter<RoleEvents> {
  private readonly roleEventEmitter = new EventEmitter<EventMap>();

  constructor(
    private readonly adapter: FilteredAdapter,
    private readonly roleManager: RoleManager,
    private readonly roleMetadataStorage: RoleMetadataStorage,
    private readonly knex: Knex,
  ) {}

  on(event: RoleEvents, listener: (role: string) => void): this {
    this.roleEventEmitter.on(event, listener);
    return this;
  }

  async hasPolicy(...policy: string[]): Promise<boolean> {
    const tempModel = newModelFromString(MODEL);
    await this.adapter.loadFilteredPolicy(tempModel, [
      {
        ptype: 'p',
        v0: policy[0],
        v1: policy[1],
        v2: policy[2],
        v3: policy[3],
      },
    ]);
    return tempModel.hasPolicy('p', 'p', policy);
  }

  async hasGroupingPolicy(...policy: string[]): Promise<boolean> {
    const tempModel = newModelFromString(MODEL);
    await this.adapter.loadFilteredPolicy(tempModel, [
      {
        ptype: 'g',
        v0: policy[0],
        v1: policy[1],
      },
    ]);
    return tempModel.hasPolicy('g', 'g', policy);
  }

  async getPolicy(): Promise<string[][]> {
    const tempModel = newModelFromString(MODEL);
    await this.adapter.loadFilteredPolicy(tempModel, [{ ptype: 'p' }]);
    return await tempModel.getPolicy('p', 'p');
  }

  async getGroupingPolicy(): Promise<string[][]> {
    const tempModel = newModelFromString(MODEL);
    await this.adapter.loadFilteredPolicy(tempModel, [{ ptype: 'g' }]);
    return await tempModel.getPolicy('g', 'g');
  }

  async getRolesForUser(userEntityRef: string): Promise<string[]> {
    return await this.roleManager.getRoles(userEntityRef);
  }

  async getFilteredPolicy(
    fieldIndex: number,
    ...filter: string[]
  ): Promise<string[][]> {
    const tempModel = newModelFromString(MODEL);

    const filterArgs: Record<string, string>[] = [];
    const filterObj: Record<string, string> = { ptype: 'p' };
    for (let i = 0; i < filter.length; i++) {
      filterObj[`v${i + fieldIndex}`] = filter[i];
      filterArgs.push(filterObj);
    }

    await this.adapter.loadFilteredPolicy(tempModel, filterArgs);

    return await tempModel.getPolicy('p', 'p');
  }

  async getFilteredGroupingPolicy(
    fieldIndex: number,
    ...filter: string[]
  ): Promise<string[][]> {
    const tempModel = newModelFromString(MODEL);

    const filterArgs: Record<string, string>[] = [];
    const filterObj: Record<string, string> = { ptype: 'g' };
    for (let i = 0; i < filter.length; i++) {
      filterObj[`v${i + fieldIndex}`] = filter[i];
      filterArgs.push(filterObj);
    }

    await this.adapter.loadFilteredPolicy(tempModel, filterArgs);

    return await tempModel.getPolicy('g', 'g');
  }

  async addPolicy(
    policy: string[],
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    const trx = externalTrx ?? (await this.knex.transaction());

    if (await this.hasPolicy(...policy)) {
      return;
    }
    try {
      await this.adapter.addPolicy('p', 'p', policy);
      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async addPolicies(
    policies: string[][],
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    if (policies.length === 0) {
      return;
    }

    const trx = externalTrx || (await this.knex.transaction());

    try {
      for (const policy of policies) {
        await this.adapter.addPolicy('p', 'p', policy);
      }
      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async addGroupingPolicy(
    policy: string[],
    roleMetadata: RoleMetadataDao,
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    const trx = externalTrx ?? (await this.knex.transaction());
    const entityRef = roleMetadata.roleEntityRef;

    if (await this.hasGroupingPolicy(...policy)) {
      return;
    }
    try {
      let currentMetadata;
      if (entityRef.startsWith(`role:`)) {
        currentMetadata = await this.roleMetadataStorage.findRoleMetadata(
          entityRef,
          trx,
        );
      }

      if (currentMetadata) {
        await this.roleMetadataStorage.updateRoleMetadata(
          mergeRoleMetadata(currentMetadata, roleMetadata),
          entityRef,
          trx,
        );
      } else {
        const currentDate: Date = new Date();
        roleMetadata.createdAt = currentDate.toUTCString();
        roleMetadata.lastModified = currentDate.toUTCString();
        await this.roleMetadataStorage.createRoleMetadata(roleMetadata, trx);
      }

      await this.adapter.addPolicy('g', 'g', policy);
      await this.roleManager.addLink(policy[0], policy[1]);

      if (!externalTrx) {
        await trx.commit();
      }
      if (!currentMetadata) {
        this.roleEventEmitter.emit('roleAdded', roleMetadata.roleEntityRef);
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async addGroupingPolicies(
    policies: string[][],
    roleMetadata: RoleMetadataDao,
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    if (policies.length === 0) {
      return;
    }

    const trx = externalTrx ?? (await this.knex.transaction());

    try {
      const currentRoleMetadata =
        await this.roleMetadataStorage.findRoleMetadata(
          roleMetadata.roleEntityRef,
          trx,
        );
      if (currentRoleMetadata) {
        await this.roleMetadataStorage.updateRoleMetadata(
          mergeRoleMetadata(currentRoleMetadata, roleMetadata),
          roleMetadata.roleEntityRef,
          trx,
        );
      } else {
        const currentDate: Date = new Date();
        roleMetadata.createdAt = currentDate.toUTCString();
        roleMetadata.lastModified = currentDate.toUTCString();
        await this.roleMetadataStorage.createRoleMetadata(roleMetadata, trx);
      }

      for (const policy of policies) {
        await this.adapter.addPolicy('g', 'g', policy);
        await this.roleManager.addLink(policy[0], policy[1]);
      }

      if (!externalTrx) {
        await trx.commit();
      }
      if (!currentRoleMetadata) {
        this.roleEventEmitter.emit('roleAdded', roleMetadata.roleEntityRef);
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async updateGroupingPolicies(
    oldRole: string[][],
    newRole: string[][],
    newRoleMetadata: RoleMetadataDao,
  ): Promise<void> {
    const oldRoleName = oldRole.at(0)?.at(1)!;

    const trx = await this.knex.transaction();
    try {
      const currentMetadata = await this.roleMetadataStorage.findRoleMetadata(
        oldRoleName,
        trx,
      );
      if (!currentMetadata) {
        throw new Error(`Role metadata ${oldRoleName} was not found`);
      }

      await this.removeGroupingPolicies(oldRole, currentMetadata, true, trx);
      await this.addGroupingPolicies(newRole, newRoleMetadata, trx);
      await trx.commit();
    } catch (err) {
      await trx.rollback(err);
      throw err;
    }
  }

  async updatePolicies(
    oldPolicies: string[][],
    newPolicies: string[][],
  ): Promise<void> {
    const trx = await this.knex.transaction();

    try {
      await this.removePolicies(oldPolicies, trx);
      await this.addPolicies(newPolicies, trx);
      await trx.commit();
    } catch (err) {
      await trx.rollback(err);
      throw err;
    }
  }

  async removePolicy(policy: string[], externalTrx?: Knex.Transaction) {
    const trx = externalTrx ?? (await this.knex.transaction());

    try {
      await this.adapter.removePolicy('p', 'p', policy);
      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async removePolicies(
    policies: string[][],
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    const trx = externalTrx ?? (await this.knex.transaction());

    try {
      for (const policy of policies) {
        await this.adapter.removePolicy('p', 'p', policy);
      }

      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async removeGroupingPolicy(
    policy: string[],
    roleMetadata: RoleMetadataDao,
    isUpdate?: boolean,
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    const trx = externalTrx ?? (await this.knex.transaction());
    const roleEntity = policy[1];

    try {
      await this.adapter.removePolicy('g', 'g', policy);
      await this.roleManager.deleteLink(policy[0], policy[1]);

      if (!isUpdate) {
        const currentRoleMetadata =
          await this.roleMetadataStorage.findRoleMetadata(roleEntity, trx);
        const remainingGroupPolicies = await this.getFilteredGroupingPolicy(
          1,
          roleEntity,
        );
        if (
          currentRoleMetadata &&
          remainingGroupPolicies.length === 0 &&
          roleEntity !== ADMIN_ROLE_NAME
        ) {
          await this.roleMetadataStorage.removeRoleMetadata(roleEntity, trx);
        } else if (currentRoleMetadata) {
          await this.roleMetadataStorage.updateRoleMetadata(
            mergeRoleMetadata(currentRoleMetadata, roleMetadata),
            roleEntity,
            trx,
          );
        }
      }

      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  async removeGroupingPolicies(
    policies: string[][],
    roleMetadata: RoleMetadataDao,
    isUpdate?: boolean,
    externalTrx?: Knex.Transaction,
  ): Promise<void> {
    const trx = externalTrx ?? (await this.knex.transaction());

    const roleEntity = roleMetadata.roleEntityRef;
    try {
      for (const policy of policies) {
        await this.adapter.removePolicy('g', 'g', policy);
        await this.roleManager.deleteLink(policy[0], policy[1]);
      }

      if (!isUpdate) {
        const currentRoleMetadata =
          await this.roleMetadataStorage.findRoleMetadata(roleEntity, trx);
        const remainingGroupPolicies = await this.getFilteredGroupingPolicy(
          1,
          roleEntity,
        );
        if (
          currentRoleMetadata &&
          remainingGroupPolicies.length === 0 &&
          roleEntity !== ADMIN_ROLE_NAME
        ) {
          await this.roleMetadataStorage.removeRoleMetadata(roleEntity, trx);
        } else if (currentRoleMetadata) {
          await this.roleMetadataStorage.updateRoleMetadata(
            mergeRoleMetadata(currentRoleMetadata, roleMetadata),
            roleEntity,
            trx,
          );
        }
      }

      if (!externalTrx) {
        await trx.commit();
      }
    } catch (err) {
      if (!externalTrx) {
        await trx.rollback(err);
      }
      throw err;
    }
  }

  /**
   * enforce aims to enforce a particular permission policy based on the user that it receives.
   * Under the hood, enforce uses the `enforce` method from the enforcer`.
   *
   * Before enforcement, a filter is set up to reduce the number of permission policies that will
   * be loaded in.
   * This will reduce the amount of checks that need to be made to determine if a user is authorize
   * to perform an action
   *
   * A temporary enforcer will also be used while enforcing.
   * This is to ensure that the filter does not interact with the base enforcer.
   * The temporary enforcer has lazy loading of the permission policies enabled to reduce the amount
   * of time it takes to initialize the temporary enforcer.
   * The justification for lazy loading is because permission policies are already present in the
   * role manager / database and it will be filtered and loaded whenever `getFilteredPolicy` is called
   * and permissions / roles are applied to the temp enforcer
   * @param entityRef The user to enforce
   * @param resourceType The resource type / name of the permission policy
   * @param action The action of the permission policy
   * @param roles Any roles that the user is directly or indirectly attached to.
   * Used for filtering permission policies.
   * @returns True if the user is allowed based on the particular permission
   */
  async enforce(
    entityRef: string,
    resourceType: string,
    action: string,
    roles: string[],
  ): Promise<boolean> {
    // const tempEnforcer = new Enforcer();
    // const model = newModelFromString(MODEL);

    // // copy filtered policies from enforcer to tempEnforcer
    // let policies: string[][] = [];
    // if (roles.length > 0) {
    //   for (const role of roles) {
    //     const filteredRolePolicies = await this.getFilteredPolicy(
    //       0,
    //       ...[role, resourceType, action],
    //     );
    //     policies.push(...filteredRolePolicies);
    //   }
    // } else {
    //   const regex = /\b(?:user|group):[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\b/g;

    //   const enforcePolicies = await this.getFilteredPolicy(
    //     1,
    //     ...[resourceType, action],
    //   );

    //   policies = enforcePolicies.filter(policy => policy[0].match(regex));
    // }
    // model.addPolicies('p', 'p', policies);

    // // init temp enforce with model only, without adapter at all...
    // await tempEnforcer.initWithModelAndAdapter(model);

    // tempEnforcer.setRoleManager(this.roleManager);
    // tempEnforcer.enableAutoBuildRoleLinks(false);
    // await tempEnforcer.buildRoleLinks();

    // return await tempEnforcer.enforce(entityRef, resourceType, action);

    // ======== my ========
    const filter = [];
    if (roles.length > 0) {
      roles.forEach(role => {
        filter.push({ ptype: 'p', v0: role, v1: resourceType, v2: action });
      });
    } else {
      filter.push({ ptype: 'p', v1: resourceType, v2: action });
    }

    const tempEnforcer = new Enforcer();
    let model = newModelFromString(MODEL);
    await this.adapter.loadFilteredPolicy(model, filter);
    if (roles.length === 0) {
      // remove role assigned policies, stay only user and group assigned
      const filteredPolicies = model
        .getPolicy('p', 'p')
        .filter(p => p[0].startsWith('user') || p[0].startsWith('group'));
      model = newModelFromString(MODEL);
      model.addPolicies('p', 'p', filteredPolicies);
    }

    await tempEnforcer.initWithModelAndAdapter(model);

    tempEnforcer.setRoleManager(this.roleManager);
    tempEnforcer.enableAutoBuildRoleLinks(false);
    await tempEnforcer.buildRoleLinks();

    return await tempEnforcer.enforce(entityRef, resourceType, action);
  }

  // todo optimize this to speed up the process
  async getImplicitPermissionsForUser(user: string): Promise<string[][]> {
    const roles = await this.getRolesForUser(user);
    const permissions: string[][] = [];
    for (const role of roles) {
      const rolePermissions = await this.getFilteredPolicy(0, role);
      permissions.push(...rolePermissions);
    }
    return permissions;
  }
}
