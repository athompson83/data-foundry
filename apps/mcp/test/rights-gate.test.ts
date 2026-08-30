/**
 * AGENTS.md rule 1, at the interface.
 *
 * > No source without rights metadata. Unreviewed/RED sources must not publish.
 *
 * The gate itself lives in the selection cascade, one layer down, and this app
 * neither reimplements nor second-guesses it. What is asserted here is that the
 * interface does not undo it: the value never appears, the gap is reported
 * rather than hidden, and — the part that is easy to get wrong — the EXPLANATION
 * of a value does not repeat what the value itself was refused.
 *
 * `sound_level_db` is claimed by exactly one source, whose rights are
 * UNREVIEWED. It is a real fact row with real evidence: it fails on rights and
 * nothing else, which is the case that matters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpFixtures, errorOf, relate, resultOf, type McpFixtures } from './support.js';
import type {
  CompareEntitiesResult,
  ExplainFactResult,
  GetEntityResult,
  ListFactsResult,
} from '../src/index.js';

let fixtures: McpFixtures;

/** The UNREVIEWED fixture source, and the claim only it makes. */
const BLOCKED_PUBLISHER = 'HVAC Forum';
const BLOCKED_DOMAIN = 'forum.example';
const BLOCKED_PROPERTY = 'sound_level_db';
/** The number that source, and only that source, asserts. */
const BLOCKED_VALUE = 99;
/** The same number as the query layer renders it into prose, with its unit. */
const BLOCKED_VALUE_TEXT = '99 dB';

/** Every primitive in a payload, so a value can be searched for AS a value. */
function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => leaves(item));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => leaves(item));
  }
  return [value];
}

/**
 * Every place a blocked claim could surface in one tool result.
 *
 * Three things, because a leak into any one of them is a rule-1 breach on its
 * own and they fail independently:
 *
 *   * the PUBLISHER and DOMAIN — naming the source is a disclosure of it even
 *     where the value is absent;
 *   * the VALUE — "the forum says 99 dB" is exactly the claim the gate refused,
 *     and it is a breach whether or not anything says where it came from. It is
 *     checked as a leaf rather than as a substring because "99" occurs inside
 *     unrelated numbers (a confidence of 0.99, a uuid) and a substring sweep
 *     would either refuse ordinary results or have to be weakened until it
 *     caught nothing;
 *   * `content[].text` — MCP returns a human-readable block beside the
 *     structured payload, and a transport is free to forward either. Sweeping
 *     only `structuredContent` checked the half a model is least likely to
 *     read out loud.
 */
function assertNothingBlockedSurfaced(
  call: { readonly structuredContent: unknown; readonly content: readonly { text: string }[] },
  label: string,
): void {
  const rendered = [
    JSON.stringify(call.structuredContent),
    ...call.content.map((block) => block.text),
  ];
  for (const text of rendered) {
    expect(text, label).not.toContain(BLOCKED_PUBLISHER);
    expect(text, label).not.toContain(BLOCKED_DOMAIN);
    expect(text, label).not.toContain(BLOCKED_VALUE_TEXT);
  }
  const asserted = leaves(call.structuredContent).filter(
    (leaf) => leaf === BLOCKED_VALUE || leaf === String(BLOCKED_VALUE),
  );
  expect(asserted, `${label} carries the withheld value`).toEqual([]);
}

beforeAll(async () => {
  fixtures = await createMcpFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('the fixture is not vacuous', () => {
  it('really does hold an evidenced claim from an UNREVIEWED source', async () => {
    // If this stops being true, every assertion below passes for the wrong
    // reason, so it is checked directly rather than assumed.
    const rows = await fixtures.driver.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM facts f
         JOIN fact_evidence fe ON fe.fact_id = f.id
         JOIN source_records sr ON sr.id = fe.source_record_id
         JOIN sources s ON s.id = sr.source_id
        WHERE f.entity_id = $1 AND f.property = $2 AND s.rights_classification = 'UNREVIEWED'`,
      [fixtures.equipment.id, BLOCKED_PROPERTY],
    );
    expect(Number(rows[0]?.total ?? 0)).toBeGreaterThan(0);
  });
});

describe('a fact backed only by an unpublishable source', () => {
  it('is absent from the fact sheet without becoming a refusal oracle', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: '24ANB7' }),
    );
    expect((result.facts ?? []).map((fact) => fact.property)).not.toContain(BLOCKED_PROPERTY);

    const withheld = (result.withheldFacts ?? []).find(
      (item) => item.property === BLOCKED_PROPERTY,
    );
    expect(withheld).toBeUndefined();
    expect(result.trust?.withheldCount).toBe(0);
  });

  it('surfaces neither the value nor the publisher, in either half of any result', async () => {
    const calls: readonly (readonly [string, Awaited<ReturnType<typeof fixtures.server.callTool>>])[] =
      [
        ['get_entity', await fixtures.server.callTool('get_entity', { identifier: '24ANB7' })],
        [
          'list_facts',
          await fixtures.server.callTool('list_facts', { entity_id: fixtures.equipment.id }),
        ],
        [
          'list_facts narrowed to the blocked property',
          await fixtures.server.callTool('list_facts', {
            entity_id: fixtures.equipment.id,
            properties: [BLOCKED_PROPERTY],
          }),
        ],
        [
          'compare_entities',
          await fixtures.server.callTool('compare_entities', {
            entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
          }),
        ],
        [
          'compare_entities narrowed to the blocked property',
          await fixtures.server.callTool('compare_entities', {
            entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
            properties: [BLOCKED_PROPERTY],
          }),
        ],
        [
          'explain_fact',
          await fixtures.server.callTool('explain_fact', {
            entity_id: fixtures.equipment.id,
            property: BLOCKED_PROPERTY,
          }),
        ],
        ['search_entities', await fixtures.server.callTool('search_entities', { query: 'Carrier' })],
      ];

    for (const [label, call] of calls) assertNothingBlockedSurfaced(call, label);
  });

  it('is a present-but-empty row in a comparison, not an invented value', async () => {
    const result = resultOf<CompareEntitiesResult>(
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
        properties: [BLOCKED_PROPERTY],
      }),
    );
    for (const row of result.rows) {
      for (const cell of row.cells) {
        expect(cell.present).toBe(false);
        expect(cell.value).toBeNull();
      }
    }
  });

  it('narrows to nothing when asked for that property alone', async () => {
    const result = resultOf<ListFactsResult>(
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        properties: [BLOCKED_PROPERTY],
      }),
    );
    expect(result.facts).toEqual([]);
    expect(result.withheldFacts).toEqual([]);
  });
});

describe('explaining a value that was refused', () => {
  it('returns the same unavailable answer as an absent property', async () => {
    const error = errorOf(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: BLOCKED_PROPERTY,
      }),
    );
    expect(error.code).toBe('PROPERTY_NOT_RECORDED');
    expect(error.message).toContain('may be absent or unavailable');
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain(BLOCKED_PUBLISHER);
    expect(serialized).not.toContain(BLOCKED_DOMAIN);
  });

  it('still explains a publishable value in full', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.plainServer.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'seer2_rating',
      }),
    );
    expect(result.claims.length).toBeGreaterThan(1);
    expect(result.withheldClaimCount).toBe(0);
    expect(result.narrative.some((line) => line.includes('Acme Climate'))).toBe(true);
  });
});

describe('the payload sweep', () => {
  it('refuses a result carrying a withheld source, rather than trimming it', async () => {
    // Direct unit check of the backstop: if the narrative filter ever misses a
    // line, this is what happens instead of a rule-1 breach.
    const { assertPayloadCarriesNoWithheldSource } = await import('../src/index.js');
    expect(() =>
      assertPayloadCarriesNoWithheldSource({ narrative: ['HVAC Forum claims "99"'] }, [
        'hvac forum',
      ]),
    ).toThrowError(/publish gate/);
    expect(() =>
      assertPayloadCarriesNoWithheldSource({ narrative: ['Carrier claims "16"'] }, ['hvac forum']),
    ).not.toThrow();
  });
});

/**
 * AGENTS.md rules 1 and 2 at the interface, for edges rather than facts.
 *
 * An edge can lose the right to be served two ways: it carries no evidence at
 * all (rule 2), or every source behind it fails the publish gate (rule 1). The
 * query layer refuses both — it must, since a hop taken through such an edge
 * would publish the refused claim as a path — so neither reaches this
 * projection to be filtered here. What this app is responsible for is that the
 * refusal is REPORTED. An empty edge list on its own says "the graph holds
 * nothing here", which is a stronger and different claim than "we hold nothing
 * here we may publish", and an agent cannot tell them apart without the count.
 *
 * Both cases are constructed rather than assumed: the store refuses to write a
 * relationship without evidence, so the unevidenced one is made by deleting the
 * evidence rows underneath a real edge.
 */
describe('a relationship no publishable evidence backs', () => {
  /** A predicate no fixture uses, so the rights case owns what it walks. */
  const PREDICATE = 'blocked_only_edge';

  it('is withheld from traversal and counted, not returned as a fact', async () => {
    const before = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.heatPump.id,
        predicate: 'uses_part',
        direction: 'out',
      }),
    );
    expect(before.edges).toHaveLength(1);
    expect(before.withheldEdgeCount).toBe(0);
    const relationshipId = before.edges[0]?.relationshipId ?? '';

    await fixtures.driver.query('DELETE FROM relationship_evidence WHERE relationship_id = $1', [
      relationshipId,
    ]);

    const after = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.heatPump.id,
        predicate: 'uses_part',
        direction: 'out',
      }),
    );
    expect(after.edges).toEqual([]);
    // Counted, so a caller can tell "the graph holds nothing here" apart from
    // "we hold something we are not willing to publish".
    expect(after.withheldEdgeCount).toBe(1);
    expect(JSON.stringify(after)).not.toContain(relationshipId);
  });

  it('is withheld SILENTLY when its only source fails the rights gate', async () => {
    // The edge is fully evidenced. It fails on rights and nothing else, which
    // is the case the unevidenced test above cannot reach — and it is reported
    // differently on purpose.
    //
    // An earlier version counted it into `withheldEdgeCount`, on the reasoning
    // that a count says how many without saying which. That reasoning was
    // wrong: `predicate` and `direction` are arguments the CALLER supplies, so
    // the count answers yes/no about any triple they name, and two sweeps
    // reconstruct the edge the gate refused. An unevidenced edge has no source
    // to protect and is still counted; a rights-refused one is not.
    await relate(fixtures, fixtures.equipment, PREDICATE, fixtures.heatPump, 'blocked');

    const result = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        predicate: PREDICATE,
        direction: 'out',
      }),
    );
    expect(result.edges).toEqual([]);
    expect(result.withheldEdgeCount, 'a rights refusal leaves no count behind').toBe(0);

    const raw = JSON.stringify(result);
    expect(raw).not.toContain(BLOCKED_PUBLISHER);
    expect(raw).not.toContain(BLOCKED_DOMAIN);
    expect(raw, 'nor the entity on the far end of the refused edge').not.toContain(
      fixtures.heatPump.canonical_slug,
    );
  });

  it('says in its own tool description that the graph it serves is partial', () => {
    // Withholding silently is only defensible because the incompleteness is
    // stated somewhere a caller reads once, rather than in a number they can
    // difference. If that sentence goes, the silence stops being honest.
    const tool = fixtures.server.listTools().find((entry) => entry.name === 'traverse_relationships');
    expect(tool, 'the tool must exist to describe anything').toBeDefined();
    const description = tool?.description ?? '';
    expect(description).toMatch(/publishable graph/i);
    expect(description).toMatch(/withheld/i);
    expect(description, 'one allowed contribution must not launder refused provenance').toMatch(
      /any required provenance contribution.*withheld|withheld.*any required provenance contribution/i,
    );
    expect(description, 'endpoint identity support must be current').toMatch(
      /endpoint identit.*current FINALIZED/i,
    );
    expect(description, 'edge assertion support must independently be current').toMatch(
      /current FINALIZED.*assertion/i,
    );
    expect(description, 'and it must not read an absent edge as a denial').toMatch(
      /never "asserted to be false"|not "asserted to be false"/i,
    );
  });

  it('does not report a gap where there is none', async () => {
    // The control this replaces asked `heatPump` for `replaced_by` edges going
    // OUT — but the fixture makes `heatPump` the OBJECT of that edge, so the
    // walk matched nothing and the assertion held over an empty traversal. It
    // could not tell "refused nothing" from "there was nothing to refuse".
    const result = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        predicate: 'replaced_by',
        direction: 'out',
      }),
    );
    expect(result.edges, 'the control must walk a real, publishable edge').toHaveLength(1);
    expect(result.edges[0]?.evidenceCount).toBeGreaterThan(0);
    expect(result.withheldEdgeCount).toBe(0);
  });
});
