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

/**
 * Supported operators for filter rules.
 * @public
 */
export type RuleOperator =
  | '='
  | '!='
  | 'STARTSWITH'
  | 'ENDSWITH'
  | 'CONTAINS'
  | 'LIKE'
  | 'IN'
  | '>'
  | '<'
  | '>='
  | '<=';

/**
 * A single filter rule.
 * @public
 */
export interface Rule {
  /**
   * The field name to filter on.
   */
  field: string;
  /**
   * The value to compare against.
   */
  value: string | number | boolean;
  /**
   * The operator to use for comparison. Defaults to '=' if not specified.
   */
  operator?: RuleOperator;
  /**
   * If true, negates the rule (NOT condition).
   */
  negate?: boolean;
}

/**
 * The type of logical operation for a filter group.
 * @public
 */
export type FilterType = 'and' | 'or';

/**
 * A filter group that can contain rules and nested groups.
 * @public
 */
export interface FilterGroup {
  /**
   * The logical operation type: 'and' or 'or'.
   */
  type: FilterType;
  /**
   * List of rules in this group.
   */
  rules?: Rule[];
  /**
   * List of nested filter groups.
   */
  groups?: FilterGroup[];
  /**
   * If true, negates the entire group (NOT condition).
   */
  negate?: boolean;
}

/**
 * Generates a ServiceNow encoded query string from a FilterGroup.
 *
 * @param filter - The filter group to convert
 * @returns The encoded query string for ServiceNow API
 * @public
 */
export function generateEncodedQuery(filter: FilterGroup): string {
  const parts: string[] = [];

  // Operators that should not have URL-encoded values in ServiceNow
  const textOperators: RuleOperator[] = [
    'LIKE',
    'STARTSWITH',
    'ENDSWITH',
    'CONTAINS',
    'IN',
  ];

  // Process rules
  if (filter.rules) {
    for (const r of filter.rules) {
      const op = r.operator ?? '=';
      // For text operators (LIKE, STARTSWITH, ENDSWITH, CONTAINS, IN), don't encode the value
      // ServiceNow handles these operators differently and encoding breaks them
      const value = textOperators.includes(op)
        ? r.value.toString()
        : encodeURIComponent(r.value.toString());
      const ruleStr = `${r.field}${op}${value}`;
      parts.push(r.negate ? `!${ruleStr}` : ruleStr);
    }
  }

  // Process nested groups recursively
  if (filter.groups) {
    for (const g of filter.groups) {
      const subQuery = generateEncodedQuery(g);
      if (subQuery) {
        if (g.negate) {
          // Negate group in ServiceNow using ^NQ
          // Add NQ prefix without ^, it will be added by the separator
          parts.push(`NQ${subQuery}`);
        } else {
          parts.push(subQuery);
        }
      }
    }
  }

  if (parts.length === 0) return '';

  const sep = filter.type === 'or' ? '^OR' : '^';
  let result = parts.join(sep);

  // Fix double ^ before NQ (when separator adds ^ before NQ)
  result = result.replace(/\^\^NQ/g, '^NQ');

  return result;
}
