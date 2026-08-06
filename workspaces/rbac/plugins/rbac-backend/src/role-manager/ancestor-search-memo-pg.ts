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

import { Knex } from 'knex';
import { AncestorSearchMemo, Relation } from './ancestor-search-memo';

export class AncestorSearchMemoPG extends AncestorSearchMemo<Relation> {
  constructor(
    private readonly userEntityRef: string,
    private readonly catalogDBClient: Knex,
    private readonly maxDepth?: number,
  ) {
    super();
  }

  /**
   * Legacy helper: full childOf dump. Prefer {@link buildUserGraph}, which
   * walks ancestors via indexed source_entity_ref lookups only.
   */
  async getAllASMGroups(): Promise<Relation[]> {
    return this.catalogDBClient('relations')
      .select('source_entity_ref', 'target_entity_ref')
      .where('type', 'childOf');
  }

  async getUserASMGroups(): Promise<Relation[]> {
    return this.catalogDBClient('relations')
      .select('source_entity_ref', 'target_entity_ref')
      .where({ type: 'memberOf', source_entity_ref: this.userEntityRef });
  }

  /**
   * In-memory walk over a preloaded relation list (tests / legacy).
   * Production build uses {@link buildUserGraph} iterative DB queries.
   */
  traverse(
    relation: Relation,
    allRelations: Relation[],
    current_depth: number,
  ) {
    // We add one to the maxDepth here because the user is considered the starting node
    if (this.maxDepth !== undefined && current_depth >= this.maxDepth + 1) {
      return;
    }
    const depth = current_depth + 1;

    if (!super.hasEntityRef(relation.source_entity_ref)) {
      super.setNode(relation.source_entity_ref);
    }

    super.setEdge(relation.target_entity_ref, relation.source_entity_ref);

    if (!super.isAcyclic()) {
      return;
    }

    const parentGroups = allRelations.filter(
      g => g.source_entity_ref === relation.target_entity_ref,
    );

    for (const parentGroup of parentGroups) {
      this.traverse(parentGroup, allRelations, depth);
    }
  }

  /**
   * Builds the user's group subgraph without loading all childOf rows.
   *
   * Uses catalog index relations_source_entity_ref_idx:
   *   WHERE type = 'childOf' AND source_entity_ref IN (frontier)
   *
   * Membership freshness is per rebuild; group edges are only the ancestors
   * of this user's direct groups (not a process-wide hierarchy dump).
   */
  async buildUserGraph() {
    const userRelations = await this.getUserASMGroups();

    let frontier: string[] = [];
    const queried = new Set<string>();

    for (const relation of userRelations) {
      if (this.maxDepth !== undefined && this.maxDepth + 1 <= 0) {
        continue;
      }
      if (!super.hasEntityRef(relation.source_entity_ref)) {
        super.setNode(relation.source_entity_ref);
      }
      super.setEdge(relation.target_entity_ref, relation.source_entity_ref);
      frontier.push(relation.target_entity_ref);
    }

    let currentDepth = 1;
    while (frontier.length > 0) {
      if (this.maxDepth !== undefined && currentDepth >= this.maxDepth + 1) {
        break;
      }

      const toQuery = [...new Set(frontier.filter(ref => !queried.has(ref)))];
      frontier = [];
      if (toQuery.length === 0) {
        break;
      }
      for (const ref of toQuery) {
        queried.add(ref);
      }

      // Hits relations_source_entity_ref_idx; type is a residual filter.
      const rows: Relation[] = await this.catalogDBClient('relations')
        .select('source_entity_ref', 'target_entity_ref')
        .where('type', 'childOf')
        .whereIn('source_entity_ref', toQuery);

      for (const relation of rows) {
        if (!super.hasEntityRef(relation.source_entity_ref)) {
          super.setNode(relation.source_entity_ref);
        }
        super.setEdge(relation.target_entity_ref, relation.source_entity_ref);

        if (!super.isAcyclic()) {
          continue;
        }

        if (!queried.has(relation.target_entity_ref)) {
          frontier.push(relation.target_entity_ref);
        }
      }

      currentDepth += 1;
    }
  }
}
