/*
 * Copyright 2025 The Backstage Authors
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

import { LoggerService } from '@backstage/backend-plugin-api';
import axios from 'axios';
import { ServiceNowConnection } from './connection';

type CachedSchema = {
  fields: Set<string>;
  fetchedAt: number;
};

const INCIDENT_TABLE_NAME = 'incident';
const SCHEMA_TTL_MS = 5 * 60 * 1000; // 5 minutes cache timeout

export class ServiceNowSchemaChecker {
  private cache?: CachedSchema;

  constructor(
    private readonly conn: ServiceNowConnection,
    private readonly logger?: LoggerService,
  ) {}

  private async fetchIncidentSchema(): Promise<Set<string> | 'access-denied'> {
    try {
      const authHeaders = await this.conn.getAuthHeaders();
      const url = `api/now/table/sys_dictionary`;

      const response = await this.conn.getAxiosInstance().get(url, {
        headers: {
          ...authHeaders,
          Accept: 'application/json',
        },
        params: {
          sysparm_query: `name=${INCIDENT_TABLE_NAME}`,
          sysparm_fields: 'element',
          sysparm_limit: 500,
        },
        responseType: 'json',
      });

      if (response.status !== 200) {
        throw new Error(`ServiceNow API returned status ${response.status}`);
      }

      const contentType = response.headers['content-type'];
      if (
        !contentType ||
        (typeof contentType === 'string' &&
          !contentType.includes('application/json')) ||
        (Array.isArray(contentType) &&
          !contentType.some(ct => ct.includes('application/json'))) ||
        (!Array.isArray(contentType) &&
          typeof contentType === 'object' &&
          !contentType.hasContentType('application/json'))
      ) {
        throw new Error(
          `Expected JSON response but got Content-Type: ${contentType}`,
        );
      }

      const data = response.data;
      if (!data || typeof data !== 'object') {
        throw new Error('ServiceNow API returned invalid JSON response');
      }

      if (data.error) {
        throw new Error(`ServiceNow API Error: ${data.error.message}`);
      }

      const result = data.result ?? [];
      return new Set(result.map((r: any) => r.element));
    } catch (e) {
      if (
        axios.isAxiosError(e) &&
        (e.response?.status === 401 || e.response?.status === 403)
      ) {
        this.logger?.warn(
          `Skipping ServiceNow schema validation; sys_dictionary returned ${e.response.status}. The integration user may lack dictionary access.`,
        );
        return 'access-denied';
      }
      if (e instanceof Error) {
        throw new Error(`Failed to fetch incident schema: ${e.message}`);
      }
      throw e;
    }
  }

  private async getIncidentFields(): Promise<Set<string> | 'access-denied'> {
    const now = Date.now();

    if (this.cache && now - this.cache.fetchedAt < SCHEMA_TTL_MS) {
      return this.cache.fields;
    }

    const fields = await this.fetchIncidentSchema();
    if (fields === 'access-denied') {
      return fields;
    }

    this.cache = {
      fields,
      fetchedAt: now,
    };

    return fields;
  }

  public async fieldExists(...fields: string[]): Promise<boolean> {
    if (fields.length === 0) {
      return true;
    }
    const incidentFields = await this.getIncidentFields();
    if (incidentFields === 'access-denied') {
      return true;
    }
    return fields.every(field => incidentFields.has(field));
  }
}
