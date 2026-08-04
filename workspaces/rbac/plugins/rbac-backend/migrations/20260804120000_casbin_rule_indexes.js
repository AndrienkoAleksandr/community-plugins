/*
 * Copyright 2026 The Backstage Authors
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

/**
 * Indexes for casbin_rule filtered-policy queries.
 * Also applied at runtime from CasbinDBAdapterFactory.ensureCasbinRuleIndexes
 * because typeorm-adapter synchronize may drop undeclared indexes.
 */

const INDEXES = [
  {
    name: 'IDX_casbin_rule_ptype_v0_v1_v2',
    columns: ['ptype', 'v0', 'v1', 'v2'],
  },
  { name: 'IDX_casbin_rule_ptype_v0', columns: ['ptype', 'v0'] },
  { name: 'IDX_casbin_rule_ptype_v1', columns: ['ptype', 'v1'] },
];

/**
 * @param { import("knex").Knex } knex
 */
async function hasIndex(knex, table, indexName) {
  const client = knex.client.config.client;
  if (client === 'pg') {
    const row = await knex
      .select('indexname')
      .from('pg_indexes')
      .where({ tablename: table, indexname: indexName })
      .first();
    return Boolean(row);
  }
  if (client === 'better-sqlite3') {
    const row = await knex
      .select('name')
      .from('sqlite_master')
      .where({ type: 'index', name: indexName })
      .first();
    return Boolean(row);
  }
  return false;
}

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('casbin_rule');
  if (!exists) {
    return;
  }

  for (const { name, columns } of INDEXES) {
    if (await hasIndex(knex, 'casbin_rule', name)) {
      continue;
    }
    await knex.schema.alterTable('casbin_rule', table => {
      table.index(columns, name);
    });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('casbin_rule');
  if (!exists) {
    return;
  }

  for (const { name } of INDEXES) {
    if (!(await hasIndex(knex, 'casbin_rule', name))) {
      continue;
    }
    await knex.schema.alterTable('casbin_rule', table => {
      table.dropIndex([], name);
    });
  }
};
