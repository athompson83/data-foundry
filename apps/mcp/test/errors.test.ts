/**
 * Failure is part of the contract.
 *
 * A model cannot act on a stack trace, and it cannot tell "you asked for
 * something that does not exist" apart from "the database fell over" if both
 * arrive as prose. Every failure this dispatcher can produce is therefore a
 * distinguishable code with machine-readable details, and `callTool` never
 * throws — the last assertion in this file is the one that keeps that true for
 * tools written later.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AT, createMcpFixtures, errorOf, ts, type McpFixtures } from './support.js';
import {
  MCP_TOOL_ERROR_CODES,
  createMcpServer,
  type McpServer,
  type McpServerOptions,
} from '../src/index.js';
import { entityQualityScore, identityConfidence } from '@data-foundry/canonical-schema';

let fixtures: McpFixtures;

beforeAll(async () => {
  fixtures = await createMcpFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('an unknown tool', () => {
  it('names the tools that do exist instead of throwing', async () => {
    const call = await fixtures.server.callTool('find_replacement_model', { identifier: 'x' });
    const error = errorOf(call);

    expect(call.isError).toBe(true);
    expect(error.code).toBe('UNKNOWN_TOOL');
    expect(error.retryable).toBe(false);
    expect(error.details['requested']).toBe('find_replacement_model');
    expect(error.details['available']).toEqual(
      expect.arrayContaining(['get_entity', 'search_entities']),
    );
    // The failure is not attributed to a tool, because there is no such tool.
    expect(
      (call.structuredContent as { tool: string | null }).tool,
    ).toBeNull();
  });
});

describe('malformed arguments', () => {
  const cases: readonly (readonly [string, string, unknown, string])[] = [
    ['a missing required argument', 'list_facts', {}, 'entity_id'],
    ['a wrong type', 'get_entity', { identifier: 42 }, 'identifier'],
    [
      'a value outside the declared range',
      'search_entities',
      { query: 'x', limit: 500 },
      'limit',
    ],
    [
      'a value below the declared minimum',
      'traverse_relationships',
      { entity_id: '00000000-0000-4000-8000-000000000000', depth: 0 },
      'depth',
    ],
    [
      'an id that is not a uuid',
      'list_facts',
      { entity_id: 'carrier-infinity-24anb7' },
      'entity_id',
    ],
    [
      'a property name that is not a canonical identifier',
      'explain_fact',
      { entity_id: '00000000-0000-4000-8000-000000000000', property: 'SEER2 Rating' },
      'property',
    ],
    [
      'an enum value outside the declared set',
      'traverse_relationships',
      { entity_id: '00000000-0000-4000-8000-000000000000', direction: 'sideways' },
      'direction',
    ],
    ['too few entities to compare', 'compare_entities', { entity_ids: [] }, 'entity_ids'],
  ];

  for (const [label, tool, args, path] of cases) {
    it(`rejects ${label} with the offending path`, async () => {
      const error = errorOf(await fixtures.server.callTool(tool, args));
      expect(error.code).toBe('INVALID_ARGUMENTS');
      expect(error.retryable).toBe(false);
      const issues = error.details['issues'] as readonly { path: string }[];
      expect(issues.map((issue) => issue.path)).toContain(path);
    });
  }

  it('rejects an unrecognised argument rather than ignoring it', async () => {
    // A misspelled argument that is silently dropped answers a different
    // question than the one the caller asked.
    const error = errorOf(
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        propertys: ['tonnage'],
      }),
    );
    expect(error.code).toBe('INVALID_ARGUMENTS');
    expect(JSON.stringify(error.details)).toContain('propertys');
  });

  it('refuses to let a caller supply a fact-selection policy', async () => {
    // `editorialOverrides` is the trump card of the whole selection cascade. A
    // tool argument that reached it would let an agent publish a correction
    // nobody reviewed, under a reviewer name it made up.
    const error = errorOf(
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        editorialOverrides: [
          { source: 'editorial.internal', reason: 'because I said so', reviewer: 'nobody' },
        ],
      }),
    );
    expect(error.code).toBe('INVALID_ARGUMENTS');
    expect(JSON.stringify(error.details)).toContain('editorialOverrides');
  });

  it('treats missing arguments as an empty object rather than crashing', async () => {
    const error = errorOf(await fixtures.server.callTool('get_entity'));
    expect(error.code).toBe('INVALID_ARGUMENTS');
  });
});

describe('a missing entity', () => {
  it('says the identifier is unknown, and how it was read', async () => {
    const error = errorOf(
      await fixtures.server.callTool('get_entity', { identifier: '24-ACC6/36A003' }),
    );
    expect(error.code).toBe('ENTITY_NOT_FOUND');
    expect(error.retryable).toBe(false);
    // Rule 7 stated as behaviour: no near match was offered, and the caller can
    // see the normalized forms that were tried.
    expect(error.details['normalized_forms_tried']).toEqual(
      expect.arrayContaining(['24acc636a003']),
    );
    expect(error.message).toContain('exact');
  });

  it('reports a well-formed id that resolves to nothing', async () => {
    const error = errorOf(
      await fixtures.server.callTool('list_facts', {
        entity_id: '00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('refuses an id belonging to another vertical', async () => {
    const other = await fixtures.store.upsertVertical({
      slug: 'plumbing',
      name: 'Plumbing',
      schema_version: '1.0.0',
      status: 'ACTIVE',
      default_refresh_policy: { cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 },
    });
    const foreign = await fixtures.store.upsertEntity({
      vertical_id: other.id,
      entity_type: 'equipment',
      canonical_name: 'Some Water Heater',
      canonical_slug: 'some-water-heater',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.5),
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    });

    // The id is real and the entity exists. This server serves one vertical,
    // so reading it here would be a tenancy leak dressed as a lookup.
    for (const tool of ['list_facts', 'traverse_relationships']) {
      const error = errorOf(await fixtures.server.callTool(tool, { entity_id: foreign.id }));
      expect(error.code, tool).toBe('ENTITY_NOT_FOUND');
    }
    const compare = errorOf(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [fixtures.equipment.id, foreign.id],
      }),
    );
    expect(compare.code).toBe('TOO_FEW_ENTITIES');
    expect(compare.details['unresolved']).toEqual([foreign.id]);
  });
});

describe('an ambiguous identifier', () => {
  it('returns the candidates rather than guessing', async () => {
    for (const entity of [fixtures.equipment, fixtures.heatPump]) {
      await fixtures.store.addAlias({
        entity_id: entity.id,
        alias_type: 'sku',
        alias_value: 'DIST-4471',
        normalized_value: 'dist4471',
        source_id: fixtures.sources.aggregator.source.id,
        identity_confidence: identityConfidence(0.8),
        valid_from: ts('2026-01-01T00:00:00Z'),
        valid_to: null,
      });
    }

    const error = errorOf(
      await fixtures.server.callTool('get_entity', { identifier: 'dist-4471' }),
    );
    expect(error.code).toBe('AMBIGUOUS_IDENTIFIER');
    const candidates = error.details['candidates'] as readonly { entity_id: string }[];
    expect(candidates.map((candidate) => candidate.entity_id).sort()).toEqual(
      [fixtures.equipment.id, fixtures.heatPump.id].sort(),
    );
  });
});

describe('a property nobody publishes', () => {
  it('is a coverage gap, reported as its own code', async () => {
    const error = errorOf(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'warranty_years',
      }),
    );
    expect(error.code).toBe('PROPERTY_NOT_RECORDED');
    expect(error.details['property']).toBe('warranty_years');
    expect(error.details['as_of']).toBe(AT);
  });
});

describe('a filter on a field the vertical does not declare', () => {
  it('is refused, not silently dropped', async () => {
    const undeclared = errorOf(
      await fixtures.server.callTool('search_entities', {
        filters: [{ property: 'blower_speed', op: 'exists' }],
      }),
    );
    expect(undeclared.code).toBe('UNKNOWN_FIELD');
    expect(undeclared.details['field']).toBe('blower_speed');

    // Declared, but with `filter.type: none` — filtering on it is still an
    // error, because a filter the caller set and the system ignored is worse
    // than no answer.
    const notFilterable = errorOf(
      await fixtures.server.callTool('search_entities', {
        filters: [{ property: 'internal_note', op: 'exists' }],
      }),
    );
    expect(notFilterable.code).toBe('UNKNOWN_FIELD');
  });
});

describe('an unmodelled failure below the dispatcher', () => {
  /** The real query layer, with one method faulted. Nothing else is stubbed. */
  const faulted = (fault: () => never, onError?: McpServerOptions['onError']): McpServer =>
    createMcpServer({
      queryModel: { ...fixtures.qm, search: fault },
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      ...(onError === undefined ? {} : { onError }),
    });

  it('becomes a retryable code and never leaks the exception', async () => {
    const exploding = faulted(() => {
      throw new Error('ECONNREFUSED postgres://user:hunter2@db.internal:5432');
    });

    const call = await exploding.callTool('search_entities', { query: 'anything' });
    const error = errorOf(call);
    expect(call.isError).toBe(true);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.retryable).toBe(true);
    const serialized = JSON.stringify(call.structuredContent);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('at Object');
  });

  /**
   * The other half of that opacity. A failure a caller is deliberately told
   * nothing about has to be told to SOMEBODY, or the exception is simply gone:
   * no channel, no log, and an operator whose only evidence that anything broke
   * is a customer reporting a retryable error that never stops being retryable.
   * `apps/api` solves this with an `onError` operator channel; this is the same
   * channel, with the tool name and the code the caller was given so the two
   * ends can be matched up.
   */
  it('hands the real cause to the operator channel and nothing to the caller', async () => {
    const reported: { error: unknown; context: unknown }[] = [];
    const cause = new Error('ECONNREFUSED postgres://user:hunter2@db.internal:5432');
    const exploding = faulted(
      () => {
        throw cause;
      },
      (error, context) => reported.push({ error, context }),
    );

    const call = await exploding.callTool('search_entities', { query: 'anything' });

    // Operators get the cause itself, not a copy and not a summary.
    expect(reported).toHaveLength(1);
    expect(reported[0]?.error).toBe(cause);
    expect(reported[0]?.context).toEqual({ tool: 'search_entities', code: 'INTERNAL_ERROR' });

    // The caller still gets the opaque code and none of the detail.
    expect(errorOf(call).code).toBe('INTERNAL_ERROR');
    const serialized = JSON.stringify(call.structuredContent);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('db.internal');
  });

  it('does not report a modelled refusal, which is an answer rather than a fault', async () => {
    // `ENTITY_NOT_FOUND` is a decided answer to a legitimate question. Paging an
    // operator for it would bury the failures that mean something.
    const reported: unknown[] = [];
    const server = createMcpServer({
      queryModel: fixtures.qm,
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      onError: (error) => reported.push(error),
    });

    const call = await server.callTool('list_facts', {
      entity_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(errorOf(call).code).toBe('ENTITY_NOT_FOUND');
    expect(reported).toEqual([]);
  });

  it('keeps its never-throws guarantee even when the channel itself throws', async () => {
    // The dispatcher's contract is that every failure leaves as a result. A
    // logger that is itself broken must not be able to turn a structured
    // failure into a rejected promise the transport has to invent a shape for.
    const exploding = faulted(
      () => {
        throw new Error('the query layer fell over');
      },
      () => {
        throw new Error('the operator channel fell over too');
      },
    );

    const call = await exploding.callTool('search_entities', { query: 'anything' });
    expect(call.isError).toBe(true);
    expect(errorOf(call).code).toBe('INTERNAL_ERROR');
  });
});

describe('callTool', () => {
  it('never throws, for any tool, on any garbage', async () => {
    const garbage: readonly unknown[] = [
      undefined,
      null,
      'a string',
      42,
      [],
      { entity_id: null },
      { entity_ids: 'not-an-array' },
      // An own `__proto__` key, which an object literal cannot express.
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ];

    for (const tool of fixtures.server.listTools()) {
      for (const args of garbage) {
        const label = `${tool.name} with ${String(JSON.stringify(args))}`;
        // The guarantee: a resolved result, never a rejection.
        const call = await fixtures.server.callTool(tool.name, args);
        expect(call.structuredContent, label).toBeDefined();
        if (call.isError) {
          expect(MCP_TOOL_ERROR_CODES, label).toContain(errorOf(call).code);
        }
      }
    }
  });

  it('rejects an empty argument object for every tool that declares a required field', async () => {
    for (const tool of fixtures.server.listTools()) {
      const required = (tool.inputSchema['required'] as readonly string[] | undefined) ?? [];
      if (required.length === 0) continue;
      const error = errorOf(await fixtures.server.callTool(tool.name, {}));
      expect(error.code, tool.name).toBe('INVALID_ARGUMENTS');
      const issues = error.details['issues'] as readonly { path: string }[];
      for (const field of required) {
        expect(issues.map((issue) => issue.path), `${tool.name}.${field}`).toContain(field);
      }
    }
  });

  it('accepts an omitted argument object only where the schema requires nothing', async () => {
    // search_entities browses the whole vertical with no arguments at all. That
    // is a real answer, not a swallowed error, and the schema says so by
    // requiring nothing.
    const search = fixtures.server.listTools().find((tool) => tool.name === 'search_entities');
    expect(search?.inputSchema['required']).toBeUndefined();
    const call = await fixtures.server.callTool('search_entities');
    expect(call.isError).toBe(false);
  });
});
