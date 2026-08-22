/**
 * AGENTS.md rule 1 on the READ side: "Unreviewed/RED sources must not publish."
 *
 * The write side already refuses — a source without a rights decision cannot be
 * ACTIVE (a CHECK constraint in `0001_verticals_and_sources.sql`) — and fact
 * selection already refuses, in `usableEvidence`. This file covers the two read
 * paths in the query layer that did not:
 *
 *   1. relationship traversal, which counted and returned edges backed only by
 *      a source that may not publish;
 *   2. `canonicalFacts`, which re-derived its `sources` list from the RAW
 *      candidate evidence and so named publishers whose evidence had already
 *      been excluded from the selection.
 *
 * Rule 1 covers the ASSOCIATION, not only the value. Telling a customer that a
 * published value is backed by a source that is not cleared is a disclosure of
 * that source and a misstatement of provenance, even when the value itself came
 * from somewhere clean.
 *
 * The flag is the same one fact selection uses, with the same fail-closed
 * default: an internal analysis caller may legitimately turn it off, and these
 * tests prove the flag genuinely controls the behaviour rather than the filter
 * being unconditional.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import {
  addSourceFixture,
  createQueryFixtures,
  claim,
  relate,
  ts,
  type QueryFixtures,
  type SourceFixture,
} from './support.js';

const AT = ts('2026-07-01T00:00:00Z');

/** Publisher of the shared UNREVIEWED source. Must never reach a consumer. */
const BLOCKED_PUBLISHER = 'HVAC Forum';

let fixtures: QueryFixtures;
/** Reachable only across an edge evidenced solely by the UNREVIEWED source. */
let hiddenPart: Entity;
/** Reachable across an edge with one GREEN and one UNREVIEWED evidence row. */
let mixedPart: Entity;
/** Reachable across an edge evidenced solely by an AMBER source. */
let amberPart: Entity;
let distributor: SourceFixture;

const entity = async (name: string, slug: string): Promise<Entity> =>
  fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'part',
    canonical_name: name,
    canonical_slug: slug,
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.5),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });

beforeAll(async () => {
  fixtures = await createQueryFixtures();

  // AMBER may publish (`canPublish`), and it is exactly what a filter written
  // as `rights_classification = 'GREEN'` would wrongly refuse.
  distributor = await addSourceFixture(fixtures, {
    key: 'distributor',
    publisher: 'CoolSupply Distribution',
    domain: 'coolsupply.example',
    source_type: 'DISTRIBUTOR',
    authority_rank: 55,
    rights: 'AMBER',
  });

  hiddenPart = await entity('Forum-Sourced Blower Wheel', 'forum-sourced-blower-wheel');
  mixedPart = await entity('Carrier Capacitor', 'carrier-capacitor');
  amberPart = await entity('CoolSupply Contactor', 'coolsupply-contactor');

  // Only an UNREVIEWED source says this edge exists.
  await relate(fixtures, fixtures.equipment, 'has_part', hiddenPart, 'blocked');

  // Two sources say this edge exists; only one of them may publish.
  await relate(fixtures, fixtures.equipment, 'has_part', mixedPart, 'manufacturer');
  await relate(fixtures, fixtures.equipment, 'has_part', mixedPart, 'blocked');

  // Only an AMBER source says this edge exists. AMBER may publish.
  await relate(fixtures, fixtures.equipment, 'has_part', amberPart, distributor);

  // One GREEN and one UNREVIEWED source claim the SAME value for one property.
  // The value is publishable; the UNREVIEWED publisher's name is not.
  await claim(fixtures, 'certifier', {
    property: 'refrigerant',
    value: 'R-454B',
    entity_id: mixedPart.id,
    valid_from: '2026-02-01T00:00:00Z',
  });
  await claim(fixtures, 'blocked', {
    property: 'refrigerant',
    value: 'R-454B',
    entity_id: mixedPart.id,
    valid_from: '2026-02-01T00:00:00Z',
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

const neighbours = (traversal: { edges: readonly { neighbor: Entity }[] }): string[] =>
  traversal.edges.map((edge) => edge.neighbor.canonical_slug).sort();

describe('relationship traversal — rule 1 (gap 1)', () => {
  it('does not return an edge whose only evidence comes from an UNREVIEWED source', async () => {
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
    });

    // The edge exists in the database; the question is whether it may be served.
    const stored = await fixtures.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM relationships r
         JOIN entities e ON e.id = r.object_entity_id
        WHERE e.canonical_slug = $1`,
      [hiddenPart.canonical_slug],
    );
    expect(Number(stored[0]?.n), 'the edge is stored').toBe(1);

    expect(neighbours(traversal)).not.toContain(hiddenPart.canonical_slug);
  });

  it('still returns a mixed-rights edge, counting only the rights-usable evidence', async () => {
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
    });

    const edge = traversal.edges.find((row) => row.neighbor.id === mixedPart.id);
    expect(edge, 'a clean source vouches for this edge, so it is publishable').toBeDefined();
    // Two evidence rows are stored; one of them may not be shown or counted.
    const stored = await fixtures.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM relationship_evidence
        WHERE relationship_id = $1`,
      [edge?.relationship.id ?? ''],
    );
    expect(Number(stored[0]?.n), 'both rows are stored').toBe(2);
    expect(edge?.evidence_count, 'only the publishable row is counted').toBe(1);

    // Nothing anywhere in the served result may name the blocked publisher —
    // asserted over the whole payload so a future field cannot leak it back.
    expect(JSON.stringify(traversal)).not.toContain(BLOCKED_PUBLISHER);
  });

  it('does not refuse AMBER: publishable is `canPublish`, not "GREEN"', async () => {
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
    });

    const edge = traversal.edges.find((row) => row.neighbor.id === amberPart.id);
    expect(edge, 'AMBER may publish; refusing it would be over-refusal').toBeDefined();
    expect(edge?.evidence_count).toBe(1);
  });

  it('returns everything when require_publishable_rights is off', async () => {
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      require_publishable_rights: false,
    });

    expect(neighbours(traversal)).toEqual(
      [amberPart.canonical_slug, hiddenPart.canonical_slug, mixedPart.canonical_slug].sort(),
    );
    const mixed = traversal.edges.find((row) => row.neighbor.id === mixedPart.id);
    expect(mixed?.evidence_count, 'both rows are counted when nothing is filtered').toBe(2);
  });

  it('reports how many edges it refused, so a surface can say so', async () => {
    // Withholding silently would let a caller read an empty or short edge list
    // as "the graph holds nothing more here" — a stronger claim than the truth,
    // and one the caller has no way to check. The count is the difference
    // between a reported gap and an invisible one.
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
    });

    expect(traversal.withheld_edge_count, 'the UNREVIEWED-only edge, and only it').toBe(1);
    expect(traversal.edges).toHaveLength(2);

    // A count, not an identity: it says something was refused without saying
    // what, or by whom, which is what makes it safe to publish.
    expect(JSON.stringify(traversal)).not.toContain(BLOCKED_PUBLISHER);
  });

  it('reports no gap when it refused nothing', async () => {
    // Otherwise a hard-coded 1 would satisfy the assertion above.
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      require_publishable_rights: false,
    });
    expect(traversal.withheld_edge_count).toBe(0);
  });

  it('does not reach a further node through an edge it may not serve', async () => {
    const beyond = await entity('Forum-Only Bearing', 'forum-only-bearing');
    await relate(fixtures, hiddenPart, 'has_part', beyond, 'manufacturer');

    const guarded = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      depth: 2,
    });
    expect(neighbours(guarded)).not.toContain(beyond.canonical_slug);

    // The node is genuinely reachable — it is the blocked hop, not a missing
    // edge, that keeps it out.
    const unguarded = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      depth: 2,
      require_publishable_rights: false,
    });
    expect(neighbours(unguarded)).toContain(beyond.canonical_slug);
  });
});

describe('canonicalFacts — rule 1 in the publisher list (gap 2)', () => {
  it('names only the publishable source behind a value backed by GREEN and UNREVIEWED', async () => {
    const rows = await fixtures.qm.canonicalFacts(mixedPart.id, { at: AT });
    const refrigerant = rows.find((row) => row.property === 'refrigerant');

    expect(refrigerant?.value, 'the value itself is publishable').toBe('R-454B');
    expect(refrigerant?.sources).toEqual(['AHRI Directory']);
    expect(refrigerant?.sources).not.toContain(BLOCKED_PUBLISHER);
  });

  it('names both when requirePublishableRights is off', async () => {
    const rows = await fixtures.qm.canonicalFacts(mixedPart.id, {
      at: AT,
      requirePublishableRights: false,
    });
    const refrigerant = rows.find((row) => row.property === 'refrigerant');

    expect([...(refrigerant?.sources ?? [])].sort()).toEqual(
      ['AHRI Directory', BLOCKED_PUBLISHER].sort(),
    );
  });
});
