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
  it('is absent from the fact sheet and reported as withheld', async () => {
    const result = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: '24ANB7' }),
    );
    expect((result.facts ?? []).map((fact) => fact.property)).not.toContain(BLOCKED_PROPERTY);

    const withheld = (result.withheldFacts ?? []).find(
      (item) => item.property === BLOCKED_PROPERTY,
    );
    // Reported, not hidden: an agent that cannot see the gap will conclude the
    // property does not exist, which is a different and worse claim.
    expect(withheld).toBeDefined();
    expect(withheld?.rule).toBe('NO_ELIGIBLE_CANDIDATE');
    expect(withheld?.reason).toContain('RED/UNREVIEWED');
    expect(result.trust?.withheldCount).toBeGreaterThan(0);
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
    expect(result.withheldFacts.map((item) => item.property)).toEqual([BLOCKED_PROPERTY]);
  });
});

describe('explaining a value that was refused', () => {
  it('counts the withheld claim without repeating it', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: BLOCKED_PROPERTY,
      }),
    );

    expect(result.canonicalValue).toBeNull();
    expect(result.claims).toEqual([]);
    expect(result.withheldClaimCount).toBe(1);

    // The exclusion is disclosed as a reason, which is actionable, rather than
    // as the claim itself, which is not publishable.
    expect(result.excluded.map((item) => item.reason)).toContain('RIGHTS_BLOCKED');
    expect(result.selectedBy).toBe('NO_ELIGIBLE_CANDIDATE');

    // The query layer's narrative renders one line per attribution, including
    // the excluded ones, complete with the value asserted and the document it
    // came from. None of those lines survive the projection.
    for (const line of result.narrative) {
      expect(line).not.toContain(BLOCKED_PUBLISHER);
      expect(line).not.toContain(BLOCKED_DOMAIN);
    }
    expect(result.narrative.some((line) => line.includes('publish gate'))).toBe(true);
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
    expect(result.narrative.some((line) => line.includes('Carrier'))).toBe(true);
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

  it('is withheld and counted when its only source fails the rights gate', async () => {
    // The edge is fully evidenced. It fails on rights and nothing else, which
    // is the case the unevidenced test above cannot reach.
    await relate(fixtures, fixtures.equipment, PREDICATE, fixtures.heatPump, 'blocked');

    const result = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
        predicate: PREDICATE,
        direction: 'out',
      }),
    );
    expect(result.edges).toEqual([]);
    expect(result.withheldEdgeCount).toBe(1);

    // The gap is reported; the blocked publisher is not. A count discloses that
    // something was refused, which is the point; naming the source it came from
    // would republish exactly what the gate refused.
    const raw = JSON.stringify(result);
    expect(raw).not.toContain(BLOCKED_PUBLISHER);
    expect(raw).not.toContain(BLOCKED_DOMAIN);
  });

  it('does not report a gap where there is none', async () => {
    // Without this, `withheldEdgeCount` could be hard-coded to 1 and both
    // assertions above would still pass.
    const result = resultOf<import('../src/index.js').TraverseRelationshipsResult>(
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.heatPump.id,
        predicate: 'replaced_by',
        direction: 'out',
      }),
    );
    expect(result.withheldEdgeCount).toBe(0);
  });
});
