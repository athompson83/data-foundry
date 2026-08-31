/**
 * One accepted MCP call owns one immutable database snapshot.
 *
 * The tool handlers intentionally compose several canonical reads. These
 * tests use the real PGlite-backed query model and observe only the driver
 * transaction boundary, so a handler that escapes the call snapshot is caught
 * without replacing the behavior under test with a query-model mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  AT,
  createMcpFixtures,
  errorOf,
  type McpFixtures,
} from './support.js';

let fixtures: McpFixtures;
let transactions: MockInstance;

beforeAll(async () => {
  fixtures = await createMcpFixtures();
  transactions = vi.spyOn(fixtures.driver, 'transaction');
});

beforeEach(() => {
  transactions.mockClear();
});

afterAll(async () => {
  transactions?.mockRestore();
  await fixtures?.driver.close();
});

describe('one snapshot per accepted tool call', () => {
  const calls = (): readonly { readonly name: string; readonly args: unknown }[] => [
    { name: 'search_entities', args: { query: 'carrier' } },
    {
      name: 'get_entity',
      args: { identifier: fixtures.equipment.id, include_facts: true },
    },
    {
      name: 'list_facts',
      args: { entity_id: fixtures.equipment.id, as_of: AT },
    },
    {
      name: 'compare_entities',
      args: { entity_ids: [fixtures.equipment.id, fixtures.heatPump.id] },
    },
    {
      name: 'traverse_relationships',
      args: {
        entity_id: fixtures.equipment.id,
        direction: 'out',
        depth: 2,
        limit: 10,
      },
    },
    {
      name: 'explain_fact',
      args: { entity_id: fixtures.equipment.id, property: 'seer2_rating', as_of: AT },
    },
  ];

  for (const name of [
    'search_entities',
    'get_entity',
    'list_facts',
    'compare_entities',
    'traverse_relationships',
    'explain_fact',
  ] as const) {
    it(`${name} keeps its complete handler and payload guards in one driver transaction`, async () => {
      const selected = calls().find((candidate) => candidate.name === name);
      if (selected === undefined) throw new Error(`missing ${name} call fixture`);

      const result = await fixtures.server.callTool(selected.name, selected.args);

      expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
      expect(transactions).toHaveBeenCalledTimes(1);
    });
  }
});

describe('calls rejected before handler execution', () => {
  it('rejects an unknown tool without opening a database transaction', async () => {
    const result = await fixtures.server.callTool('not_a_tool', {});

    expect(errorOf(result).code).toBe('UNKNOWN_TOOL');
    expect(transactions).not.toHaveBeenCalled();
  });

  it('rejects invalid arguments without opening a database transaction', async () => {
    const result = await fixtures.server.callTool('list_facts', { entity_id: 'not-an-id' });

    expect(errorOf(result).code).toBe('INVALID_ARGUMENTS');
    expect(transactions).not.toHaveBeenCalled();
  });
});
