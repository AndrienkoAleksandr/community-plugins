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

import * as Knex from 'knex';
import { createTracker, MockClient, Tracker } from 'knex-mock-client';

import { AncestorSearchMemoPG } from './ancestor-search-memo-pg';

describe('ancestor-search-memo-pg', () => {
  const userRelations = [
    {
      source_entity_ref: 'user:default/adam',
      target_entity_ref: 'group:default/team-a',
    },
  ];

  const childOfTeamA = [
    {
      source_entity_ref: 'group:default/team-a',
      target_entity_ref: 'group:default/team-b',
    },
  ];

  const childOfTeamB = [
    {
      source_entity_ref: 'group:default/team-b',
      target_entity_ref: 'group:default/team-c',
    },
  ];

  const catalogDBClient = Knex.knex({ client: MockClient });

  let asm: AncestorSearchMemoPG;
  let tracker: Tracker;

  beforeAll(() => {
    tracker = createTracker(catalogDBClient);
  });

  beforeEach(() => {
    asm = new AncestorSearchMemoPG('user:default/adam', catalogDBClient);
  });

  afterEach(() => {
    tracker.reset();
  });

  describe('getUserASMGroups', () => {
    it('should return all user relations', async () => {
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = ?/,
        )
        .response(userRelations);
      const relations = await asm.getUserASMGroups();

      expect(relations).toEqual(userRelations);
    });

    it('should propagate errors when getting user relations', async () => {
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = ?/,
        )
        .simulateError('db down');

      await expect(asm.getUserASMGroups()).rejects.toThrow('db down');
    });
  });

  describe('buildUserGraph', () => {
    // user:default/adam -> group:default/team-a -> group:default/team-b -> group:default/team-c
    it('should build a graph via indexed upward childOf queries', async () => {
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" = \?/,
        )
        .responseOnce(userRelations);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .responseOnce(childOfTeamA);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .responseOnce(childOfTeamB);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .responseOnce([]);

      await asm.buildUserGraph();

      expect(asm.hasEntityRef('user:default/adam')).toBeTruthy();
      expect(asm.hasEntityRef('group:default/team-a')).toBeTruthy();
      expect(asm.hasEntityRef('group:default/team-b')).toBeTruthy();
      expect(asm.hasEntityRef('group:default/team-c')).toBeTruthy();
      expect(asm.hasEntityRef('group:default/team-d')).toBeFalsy();
    });

    // maxDepth of one                                  stops here
    //                                                       |
    // user:default/adam -> group:default/team-a -> group:default/team-b -> group:default/team-c
    it('should build the graph but stop based on the maxDepth', async () => {
      const asmMaxDepth = new AncestorSearchMemoPG(
        'user:default/adam',
        catalogDBClient,
        1,
      );

      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" = \?/,
        )
        .responseOnce(userRelations);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .responseOnce(childOfTeamA);

      await asmMaxDepth.buildUserGraph();

      expect(asmMaxDepth.hasEntityRef('user:default/adam')).toBeTruthy();
      expect(asmMaxDepth.hasEntityRef('group:default/team-a')).toBeTruthy();
      expect(asmMaxDepth.hasEntityRef('group:default/team-b')).toBeTruthy();
      expect(asmMaxDepth.hasEntityRef('group:default/team-c')).toBeFalsy();
      expect(asmMaxDepth.hasEntityRef('group:default/team-d')).toBeFalsy();
    });

    it('should follow multi-parent group edges', async () => {
      const multiParentChildOf = [
        {
          source_entity_ref: 'group:default/team-a',
          target_entity_ref: 'group:default/parent-1',
        },
        {
          source_entity_ref: 'group:default/team-a',
          target_entity_ref: 'group:default/parent-2',
        },
      ];

      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" = \?/,
        )
        .responseOnce(userRelations);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .responseOnce(multiParentChildOf);
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \? and "source_entity_ref" in \(.*\)/,
        )
        .response([]);

      await asm.buildUserGraph();

      expect(asm.hasEntityRef('group:default/parent-1')).toBeTruthy();
      expect(asm.hasEntityRef('group:default/parent-2')).toBeTruthy();
    });

    it('should propagate memberOf DB errors instead of building an empty graph', async () => {
      tracker.on
        .select(
          /select "source_entity_ref", "target_entity_ref" from "relations" where "type" = \?/,
        )
        .simulateError('db down');

      await expect(asm.buildUserGraph()).rejects.toThrow('db down');
      expect(asm.hasEntityRef('user:default/adam')).toBeFalsy();
    });
  });
});
