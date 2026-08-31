/**
 * REST query strings encode a numeric range as two parameters, but the
 * canonical query model (and MCP) receive one logical range filter. The REST
 * request bound therefore applies after those two halves are coalesced.
 */
import { describe, expect, it } from 'vitest';
import { SearchEntitiesInput } from '../../mcp/src/index.js';
import { parseFilters } from '../src/params.js';

describe('REST and MCP filter bounds', () => {
  it('counts six min/max pairs as six logical filters, matching MCP', () => {
    const params = new URLSearchParams(
      'filter.capacity_1.min=1&filter.capacity_1.max=2&' +
        'filter.capacity_2.min=3&filter.capacity_2.max=4&' +
        'filter.capacity_3.min=5&filter.capacity_3.max=6&' +
        'filter.capacity_4.min=7&filter.capacity_4.max=8&' +
        'filter.capacity_5.min=9&filter.capacity_5.max=10&' +
        'filter.capacity_6.min=11&filter.capacity_6.max=12',
    );

    const restFilters = parseFilters(params);

    expect(restFilters).toEqual([
      { property: 'capacity_1', op: 'range', min: 1, max: 2 },
      { property: 'capacity_2', op: 'range', min: 3, max: 4 },
      { property: 'capacity_3', op: 'range', min: 5, max: 6 },
      { property: 'capacity_4', op: 'range', min: 7, max: 8 },
      { property: 'capacity_5', op: 'range', min: 9, max: 10 },
      { property: 'capacity_6', op: 'range', min: 11, max: 12 },
    ]);
    expect(SearchEntitiesInput.parse({ filters: restFilters }).filters).toEqual(restFilters);
  });

  it('accepts ten logical ranges and refuses the eleventh, matching the MCP bound', () => {
    const filters = Array.from({ length: 11 }, (_, index) => ({
      property: `capacity_${index + 1}`,
      op: 'range' as const,
      min: index,
      max: index + 1,
    }));
    const query = new URLSearchParams();
    for (const filter of filters) {
      query.append(`filter.${filter.property}.min`, String(filter.min));
      query.append(`filter.${filter.property}.max`, String(filter.max));
    }

    const tenRest = new URLSearchParams([...query.entries()].slice(0, 20));
    expect(parseFilters(tenRest)).toHaveLength(10);
    expect(SearchEntitiesInput.parse({ filters: filters.slice(0, 10) }).filters).toHaveLength(10);

    expect(() => parseFilters(query)).toThrow(/at most 10 logical filters/);
    expect(SearchEntitiesInput.safeParse({ filters }).success).toBe(false);
  });
});
