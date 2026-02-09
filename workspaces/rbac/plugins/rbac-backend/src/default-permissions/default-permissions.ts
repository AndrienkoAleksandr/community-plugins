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
import { Config } from '@backstage/config';

import {
  RoleBasedPolicy,
  isValidPermissionAction,
} from '@backstage-community/plugin-rbac-common';

export const getDefaultPolicies = (config: Config): RoleBasedPolicy[] => {
  const defaultRole = config.getOptionalString(
    'permission.rbac.defaultPermissions.defaultRole',
  );
  if (defaultRole === '') {
    throw new Error(
      'Ignoring default role as it is empty. Please set a valid default role in the configuration.',
    );
  }

  if (!defaultRole) {
    return [];
  }

  const basicPermissions = config.getOptionalConfigArray(
    'permission.rbac.defaultPermissions.basicPermissions',
  );

  if (!basicPermissions) {
    return [];
  }

  return basicPermissions.map(permission => {
    const permissionName = permission.getString('permission');
    const action = permission.getOptionalString('action');
    const effect = permission.getOptionalString('effect');

    if (action && !isValidPermissionAction(action)) {
      throw new Error(
        `Invalid action '${action}' for permission '${permissionName}'.`,
      );
    }

    if (effect && effect !== 'allow' && effect !== 'deny') {
      throw new Error(
        `Invalid effect '${effect}' for permission '${permissionName}'. It must be 'allow' or 'deny'.`,
      );
    }

    return {
      entityReference: defaultRole,
      permission: permissionName,
      policy: action || 'use',
      effect: effect || 'allow',
      metadata: {
        source: 'configuration',
      },
    };
  });
};
