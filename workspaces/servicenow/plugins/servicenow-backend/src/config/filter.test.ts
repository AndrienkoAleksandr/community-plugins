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

import { generateEncodedQuery, type FilterGroup } from './filter';

describe('generateEncodedQuery', () => {
  describe('simple rules', () => {
    it('should generate query for single rule with default operator', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'priority',
            value: '1',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1');
    });

    it('should generate query for single rule with explicit operator', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'state',
            operator: '=',
            value: '2',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('state=2');
    });

    it('should generate query for multiple rules with AND', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'priority',
            value: '1',
          },
          {
            field: 'state',
            value: '2',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1^state=2');
    });

    it('should generate query for multiple rules with OR', () => {
      const filter: FilterGroup = {
        type: 'or',
        rules: [
          {
            field: 'priority',
            value: '1',
          },
          {
            field: 'priority',
            value: '2',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1^ORpriority=2');
    });

    it('should handle different operators', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'state',
            operator: '>',
            value: '1',
          },
          {
            field: 'state',
            operator: '<',
            value: '4',
          },
          {
            field: 'short_description',
            operator: 'STARTSWITH',
            value: 'EMAIL',
          },
          {
            field: 'description',
            operator: 'CONTAINS',
            value: 'Watcher',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe(
        'state>1^state<4^short_descriptionSTARTSWITHEMAIL^descriptionCONTAINSWatcher',
      );
    });

    it('should encode special characters in values', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'description',
            value: 'test & value',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('description=test%20%26%20value');
    });

    it('should handle numeric values', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'priority',
            value: 1,
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1');
    });

    it('should handle boolean values', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'active',
            value: true,
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('active=true');
    });
  });

  describe('negated rules', () => {
    it('should negate a single rule', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'state',
            operator: '=',
            value: '1',
            negate: true,
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('!state=1');
    });

    it('should handle mixed negated and non-negated rules', () => {
      const filter: FilterGroup = {
        type: 'or',
        rules: [
          {
            field: 'state',
            operator: '=',
            value: '1',
            negate: true,
          },
          {
            field: 'state',
            operator: '=',
            value: '2',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('!state=1^ORstate=2');
    });
  });

  describe('nested groups', () => {
    it('should handle nested groups with AND', () => {
      const filter: FilterGroup = {
        type: 'and',
        groups: [
          {
            type: 'or',
            rules: [
              {
                field: 'priority',
                value: '1',
              },
              {
                field: 'priority',
                value: '2',
              },
            ],
          },
          {
            type: 'and',
            rules: [
              {
                field: 'state',
                value: '2',
              },
            ],
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1^ORpriority=2^state=2');
    });

    it('should handle nested groups with OR', () => {
      const filter: FilterGroup = {
        type: 'or',
        groups: [
          {
            type: 'and',
            rules: [
              {
                field: 'priority',
                value: '1',
              },
            ],
          },
          {
            type: 'and',
            rules: [
              {
                field: 'priority',
                value: '2',
              },
            ],
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1^ORpriority=2');
    });

    it('should handle negated nested groups', () => {
      const filter: FilterGroup = {
        type: 'and',
        groups: [
          {
            type: 'or',
            rules: [
              {
                field: 'state',
                operator: '=',
                value: '1',
                negate: true,
              },
              {
                field: 'state',
                operator: '=',
                value: '2',
              },
            ],
          },
          {
            type: 'and',
            negate: true,
            groups: [
              {
                type: 'or',
                rules: [
                  {
                    field: 'priority',
                    value: '1',
                  },
                  {
                    field: 'priority',
                    value: '2',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('!state=1^ORstate=2^NQpriority=1^ORpriority=2');
    });

    it('should handle deeply nested groups', () => {
      const filter: FilterGroup = {
        type: 'and',
        groups: [
          {
            type: 'or',
            groups: [
              {
                type: 'and',
                rules: [
                  {
                    field: 'priority',
                    value: '1',
                  },
                ],
              },
              {
                type: 'and',
                rules: [
                  {
                    field: 'priority',
                    value: '2',
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('priority=1^ORpriority=2');
    });
  });

  describe('mixed rules and groups', () => {
    it('should handle rules and groups together', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'state',
            value: '2',
          },
        ],
        groups: [
          {
            type: 'or',
            rules: [
              {
                field: 'priority',
                value: '1',
              },
              {
                field: 'priority',
                value: '2',
              },
            ],
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('state=2^priority=1^ORpriority=2');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty filter', () => {
      const filter: FilterGroup = {
        type: 'and',
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('');
    });

    it('should return empty string for filter with empty rules array', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('');
    });

    it('should return empty string for filter with empty groups array', () => {
      const filter: FilterGroup = {
        type: 'and',
        groups: [],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('');
    });

    it('should handle group with empty nested group', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          {
            field: 'state',
            value: '2',
          },
        ],
        groups: [
          {
            type: 'and',
          },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe('state=2');
    });

    it('should handle all operators', () => {
      const filter: FilterGroup = {
        type: 'and',
        rules: [
          { field: 'f1', operator: '=', value: 'v1' },
          { field: 'f2', operator: '!=', value: 'v2' },
          { field: 'f3', operator: 'STARTSWITH', value: 'v3' },
          { field: 'f4', operator: 'ENDSWITH', value: 'v4' },
          { field: 'f5', operator: 'CONTAINS', value: 'v5' },
          { field: 'f6', operator: 'LIKE', value: 'v6' },
          { field: 'f7', operator: 'IN', value: 'v7' },
          { field: 'f8', operator: '>', value: 'v8' },
          { field: 'f9', operator: '<', value: 'v9' },
          { field: 'f10', operator: '>=', value: 'v10' },
          { field: 'f11', operator: '<=', value: 'v11' },
        ],
      };

      const result = generateEncodedQuery(filter);
      expect(result).toBe(
        'f1=v1^f2!=v2^f3STARTSWITHv3^f4ENDSWITHv4^f5CONTAINSv5^f6LIKEv6^f7INv7^f8>v8^f9<v9^f10>=v10^f11<=v11',
      );
    });
  });
});
