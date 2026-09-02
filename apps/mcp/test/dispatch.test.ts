/**
 * Every tool's success shape, against a real database.
 *
 * The assertions are about the CONTRACT a model consumes: that a tool answers
 * the question its description promises, and that the trust surface travels
 * with the answer instead of being tidied away. A result that is correct but
 * strips `editoriallyCorrected` or `selectionWarnings` has told the model that
 * a corrected value and a source-selected one are the same thing, which is
 * exactly the confusion those fields exist to prevent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AT,
  createMcpFixtures,
  errorOf,
  resultOf,
  type McpFixtures,
} from './support.js';
import type {
  CompareEntitiesResult,
  ExplainFactResult,
  GetEntityResult,
  ListFactsResult,
  SearchEntitiesResult,
  TraverseRelationshipsResult,
} from '../src/index.js';

let fixtures: McpFixtures;

beforeAll(async () => {
  fixtures = await createMcpFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('the tool set', () => {
  it('is small, intent-oriented, and declares a schema and error codes for each tool', () => {
    const tools = fixtures.server.listTools();
    // AGENTS.md scope control: "do not introduce ... dozens of MCP tools".
    expect(tools.length).toBeLessThanOrEqual(8);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'compare_entities',
      'explain_fact',
      'get_entity',
      'list_facts',
      'search_entities',
      'traverse_relationships',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema['type'], tool.name).toBe('object');
      expect(tool.errorCodes, tool.name).toContain('INVALID_ARGUMENTS');
      // Every tool enters the surface-bound query model, whose bounded rights
      // evaluation may refuse a catalogue that cannot be authorized safely.
      // A client must be told this can happen before it chooses a tool.
      expect(tool.errorCodes, tool.name).toContain('SERVICE_UNAVAILABLE');
      // Doc 07: a description that does not say what the tool cannot do gets
      // called for the wrong reason.
      expect(tool.description.toUpperCase(), tool.name).toContain('LIMITATIONS');
    }
  });
});

describe('search_entities', () => {
  it('returns hits with the match reason and the ordering made observable', async () => {
    const call = await fixtures.server.callTool('search_entities', { query: '24ANB7' });
    const result = resultOf<SearchEntitiesResult>(call);

    expect(call.isError).toBe(false);
    expect(result.vertical).toBe('hvac');
    expect(result.exactMatch).toBe(true);
    expect(result.hits[0]?.entity.entityId).toBe(fixtures.equipment.id);
    expect(result.hits[0]?.matchKind).toBe('EXACT_IDENTIFIER');
    expect(result.hits[0]?.matchedOn).toBe('24ANB7');
    expect(result.hits[0]?.why).toContain('rule 7');
    expect(result.hits[0]?.entity.canonicalUrl).toBe(
      'https://example.test/hvac/equipment/carrier-infinity-24anb7',
    );
  });

  it('places an exact identifier ahead of a better-scoring text match (rule 7)', async () => {
    // `hk32ea001` is the motor's NORMALIZED part number and is literally the
    // rival part's name, so the rival wins on text and must still lose.
    const call = await fixtures.server.callTool('search_entities', { query: 'hk32ea001' });
    const result = resultOf<SearchEntitiesResult>(call);

    expect(result.hits[0]?.entity.entityId).toBe(fixtures.motor.id);
    expect(result.hits[0]?.exact).toBe(true);
    const rival = result.hits.find((hit) => hit.entity.entityId === fixtures.rival.id);
    expect(rival).toBeDefined();
    // The losing hit outranks the winner textually. Exactness is a tier, not a
    // bonus, and the response lets a caller see that.
    expect(rival?.textRank ?? 0).toBeGreaterThan(result.hits[0]?.textRank ?? 0);
  });

  it('tells the caller there is no vector search behind it', async () => {
    const result = resultOf<SearchEntitiesResult>(
      await fixtures.server.callTool('search_entities', { query: 'Carrier' }),
    );
    expect(result.strategy.vector).toBe(false);
    expect(result.strategy.exact_first).toBe(true);
  });

  it('browses by filter with no text query, and can return facet counts', async () => {
    const result = resultOf<SearchEntitiesResult>(
      await fixtures.server.callTool('search_entities', {
        entity_type: 'equipment',
        filters: [{ property: 'seer2_rating', op: 'range', min: 17, max: null }],
        include_facets: true,
      }),
    );
    expect(result.query).toBeNull();
    expect(result.hits.map((hit) => hit.entity.entityId)).toEqual([fixtures.heatPump.id]);
    expect(result.facets.length).toBeGreaterThan(0);
  });

  it('honours limit and offset from the declared schema', async () => {
    const page = resultOf<SearchEntitiesResult>(
      await fixtures.server.callTool('search_entities', {
        entity_type: 'equipment',
        limit: 1,
        offset: 1,
      }),
    );
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(1);
    expect(page.hits).toHaveLength(1);
  });

  it('rejects an in-filter whose value set exceeds the declared bound', async () => {
    const call = await fixtures.server.callTool('search_entities', {
      filters: [{
        property: 'seer2_rating',
        op: 'in',
        values: Array.from({ length: 101 }, (_, index) => index),
      }],
    });

    expect(call.isError).toBe(true);
    expect(errorOf(call).code).toBe('INVALID_ARGUMENTS');
  });
});

describe('get_entity', () => {
  it('resolves a messy identifier deterministically and returns the fact sheet', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: 'hk-32ea/001' }),
    );
    expect(result.entity.entityId).toBe(fixtures.motor.id);
    expect(result.resolvedBy).toBe('identifier');
    expect(result.redirectedFrom).toBeNull();
    expect(result.trust).not.toBeNull();
  });

  it('resolves a canonical id and a slug', async () => {
    const byId = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: fixtures.equipment.id }),
    );
    expect(byId.resolvedBy).toBe('entity_id');

    const bySlug = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', {
        identifier: 'carrier-infinity-25vna4',
        entity_type: 'equipment',
      }),
    );
    expect(bySlug.resolvedBy).toBe('slug');
    expect(bySlug.entity.entityId).toBe(fixtures.heatPump.id);
  });

  it('carries the whole trust surface on every fact', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: '24ANB7' }),
    );
    const facts = result.facts ?? [];
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      // The shared serializer's fields, present by construction rather than by
      // this projection remembering them.
      expect(fact).toHaveProperty('editoriallyCorrected');
      expect(fact).toHaveProperty('editorialCorrectionReason');
      expect(fact).toHaveProperty('selectionWarnings');
      expect(fact).toHaveProperty('unresolvedConflict');
      expect(Array.isArray(fact.sources)).toBe(true);
      expect(fact.rule).toBeTruthy();
      expect(fact.reason).toBeTruthy();
    }

    const refrigerant = facts.find((fact) => fact.property === 'refrigerant');
    expect(refrigerant?.editoriallyCorrected).toBe(true);
    expect(refrigerant?.value).toBe('R-32');
    expect(refrigerant?.editorialCorrectionReason).toContain('pre-transition blend');
    expect(result.trust?.editoriallyCorrectedCount).toBe(1);
  });

  it('can answer identity only, without reading facts', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', {
        identifier: '24ANB7',
        include_facts: false,
      }),
    );
    expect(result.facts).toBeNull();
    expect(result.trust).toBeNull();
    expect(result.entity.name).toBe('Carrier Infinity 24ANB7');
  });
});

describe('list_facts', () => {
  it('returns the canonical sheet for a canonical id', async () => {
    const result = resultOf<ListFactsResult>(
      await fixtures.server.callTool('list_facts', { entity_id: fixtures.equipment.id }),
    );
    expect(result.asOf).toBe(AT);
    expect(result.entity.entityId).toBe(fixtures.equipment.id);
    expect(result.facts.map((fact) => fact.property)).toContain('seer2_rating');
  });

  it('narrows to named properties', async () => {
    const result = resultOf<ListFactsResult>(
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        properties: ['tonnage'],
      }),
    );
    expect(result.properties).toEqual(['tonnage']);
    expect(result.facts.map((fact) => fact.property)).toEqual(['tonnage']);
  });

  it('reads the sheet as it stood at an earlier instant', async () => {
    const before = resultOf<ListFactsResult>(
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        as_of: '2026-01-15T00:00:00.000Z',
      }),
    );
    // Every fixture claim starts on 2026-02-01, so the sheet is empty before it.
    expect(before.asOf).toBe('2026-01-15T00:00:00.000Z');
    expect(before.facts).toEqual([]);
  });
});

describe('compare_entities', () => {
  it('aligns two entities on properties and flags what differs', async () => {
    const result = resultOf<CompareEntitiesResult>(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
      }),
    );
    expect(result.entities).toHaveLength(2);
    expect(result.unresolvedEntityIds).toEqual([]);
    expect(result.propertiesCompared).toBeGreaterThan(0);

    const seer = result.rows.find((row) => row.property === 'seer2_rating');
    expect(seer?.label).toBe('SEER2 rating');
    expect(seer?.differs).toBe(true);
    expect(seer?.cells.map((cell) => cell.value)).toEqual([16, 18]);
    for (const cell of seer?.cells ?? []) {
      expect(cell.sources.length).toBeGreaterThan(0);
      expect(cell.rule).toBeTruthy();
    }
  });

  it('restricts to named properties', async () => {
    const result = resultOf<CompareEntitiesResult>(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
        properties: ['tonnage'],
      }),
    );
    expect(result.rows.map((row) => row.property)).toEqual(['tonnage']);
  });
});

describe('traverse_relationships', () => {
  it('walks one hop by default and reports evidence per edge', async () => {
    const result = resultOf<TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        direction: 'out',
      }),
    );
    expect(result.root.entityId).toBe(fixtures.equipment.id);
    expect(result.depth).toBe(1);
    const replaced = result.edges.find((edge) => edge.predicate === 'replaced_by');
    expect(replaced?.to.entityId).toBe(fixtures.heatPump.id);
    expect(replaced?.evidenceCount).toBeGreaterThan(0);
    expect(replaced?.depth).toBe(1);
  });

  it('follows a chain when asked for more depth', async () => {
    const oneHop = resultOf<TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        predicate: 'uses_part',
        direction: 'out',
        depth: 1,
      }),
    );
    expect(oneHop.edges).toEqual([]);

    const twoHops = resultOf<TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        direction: 'out',
        depth: 2,
      }),
    );
    const deep = twoHops.edges.find((edge) => edge.depth === 2);
    expect(deep?.predicate).toBe('uses_part');
    expect(deep?.to.entityId).toBe(fixtures.motor.id);
  });

  it('reports truncation rather than silently returning fewer edges', async () => {
    const result = resultOf<TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        depth: 4,
        limit: 1,
      }),
    );
    expect(result.edges).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe('explain_fact', () => {
  it('returns every publishable claim, the winner, and the rule that chose it', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.plainServer.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'seer2_rating',
      }),
    );
    expect(result.property).toBe('seer2_rating');
    expect(result.asOf).toBe(AT);
    expect(result.canonicalValue).toBe(16);
    expect(result.selectedBy).toBeTruthy();
    expect(result.selectionReason).toBeTruthy();

    // The losing claim is retained, not collapsed away.
    const values = result.claims.map((claim) => claim.value).sort();
    expect(values).toContain(15.2);
    const selected = result.claims.filter((claim) => claim.selected);
    expect(selected).toHaveLength(1);

    for (const claim of result.claims) {
      expect(claim.sources.length).toBeGreaterThan(0);
      for (const source of claim.sources) {
        expect(source.publisher).toBeTruthy();
        expect(source.locator).toBeTruthy();
        expect(source.artifactUrl).toBeTruthy();
        expect(source.sourceValue).toBeTruthy();
      }
    }
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it('states an editorial correction and its customer-visible reason', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'refrigerant',
      }),
    );
    expect(result.editoriallyCorrected).toBe(true);
    expect(result.editorialCorrectionReason).toContain('pre-transition blend');
    expect(result.canonicalValue).toBe('R-32');
    expect(result.unresolvedConflict).toBe(true);
    expect(result.conflicts.map((conflict) => conflict.value)).toContain('R-454B');
  });
});

describe('the result envelope', () => {
  it('carries the same object as text and as structured content', async () => {
    const call = await fixtures.server.callTool('get_entity', { identifier: '24ANB7' });
    expect(call.content).toHaveLength(1);
    expect(call.content[0]?.type).toBe('text');
    expect(JSON.parse(call.content[0]?.text ?? 'null')).toEqual(
      JSON.parse(JSON.stringify(call.structuredContent)),
    );
  });

  it('marks failures with isError and a code, and never throws', async () => {
    const call = await fixtures.server.callTool('get_entity', { identifier: 'nothing-like-this' });
    expect(call.isError).toBe(true);
    expect(errorOf(call).code).toBe('ENTITY_NOT_FOUND');
  });
});
