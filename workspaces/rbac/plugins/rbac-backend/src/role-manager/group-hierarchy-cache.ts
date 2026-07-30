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

import { Relation } from './ancestor-search-memo';

const DEFAULT_TTL_MS = 60_000;

export class GroupHierarchyCache {
  private cachedRelations: Relation[] | null = null;
  private cacheTimestamp = 0;
  private inflightPromise: Promise<Relation[]> | null = null;

  constructor(
    private readonly fetchAllGroups: () => Promise<Relation[]>,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async getAllGroups(): Promise<Relation[]> {
    const now = Date.now();

    if (this.cachedRelations && now - this.cacheTimestamp < this.ttlMs) {
      return this.cachedRelations;
    }

    if (this.inflightPromise) {
      return this.inflightPromise;
    }

    this.inflightPromise = this.fetchAllGroups()
      .then(relations => {
        this.cachedRelations = relations;
        this.cacheTimestamp = Date.now();
        this.inflightPromise = null;
        return relations;
      })
      .catch(err => {
        this.inflightPromise = null;
        throw err;
      });

    return this.inflightPromise;
  }

  invalidate(): void {
    this.cachedRelations = null;
    this.cacheTimestamp = 0;
  }
}
