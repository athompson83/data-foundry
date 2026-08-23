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
import { canPublish, entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
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
    // The classification is read back from the database rather than taken from
    // the helper's argument. Without this the whole AMBER guarantee rested on
    // an unasserted fixture detail: flipping `rights: 'AMBER'` to `'GREEN'` in
    // the setup used to leave all twelve tests in this file passing, so nothing
    // here could tell whether it was testing over-refusal at all.
    const [row] = await fixtures.driver.query<{ rights_classification: string }>(
      'SELECT rights_classification FROM sources WHERE id = $1',
      [distributor.source.id],
    );
    expect(row?.rights_classification, 'this test is named for AMBER').toBe('AMBER');
    expect(canPublish('AMBER'), 'and AMBER must be publishable, or there is nothing to prove').toBe(
      true,
    );

    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
    });

    const edge = traversal.edges.find((candidate) => candidate.neighbor.id === amberPart.id);
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

  it('does not report how many edges it refused on rights, at any granularity', async () => {
    // The regression this replaces a feature with.
    //
    // An earlier version of this file counted rights refusals into a
    // `withheld_edge_count` and both surfaces published it, on the reasoning
    // that a count says how many without saying which. That reasoning was
    // wrong, and it was wrong in the direction that matters: `predicate` and
    // `direction` are chosen by the CALLER, so the count is a yes/no answer
    // about any triple they care to name. Sweep the predicate list against a
    // subject, then the entity list against the predicate that answered, and
    // you have reconstructed the exact edge the gate refused. It was
    // demonstrated end to end against the REST route.
    //
    // So the assertion is that the refusal leaves NO trace that varies with
    // the query. The serialized payload is compared between a filter that
    // covers a blocked edge and one that does not; a field that differed
    // between them is a channel, whatever it is called.
    const blockedOnly = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      direction: 'out',
    });
    const untouched = await fixtures.qm.relationships({
      entity_id: amberPart.id,
      predicate: 'has_part',
      direction: 'out',
    });

    // The first query really does hide something and the second really does
    // not, or this proves nothing.
    expect(neighbours(blockedOnly)).not.toContain(hiddenPart.canonical_slug);
    expect(blockedOnly.edges.length, 'the blocked-edge query served real edges').toBe(2);
    expect(untouched.edges, 'the control query has nothing to hide').toEqual([]);

    // Every scalar the traversal reports must be a property of what was
    // SERVED, never of what was refused.
    expect(blockedOnly.unevidenced_edge_count).toBe(0);
    expect(untouched.unevidenced_edge_count).toBe(0);
    expect(Object.keys(blockedOnly).sort()).toEqual([
      'depth',
      'edges',
      'root',
      'truncated',
      'unevidenced_edge_count',
    ]);
    expect(JSON.stringify(blockedOnly)).not.toContain(hiddenPart.canonical_slug);
    expect(JSON.stringify(blockedOnly)).not.toContain(BLOCKED_PUBLISHER);
  });

  it('does report an edge nothing asserts at all, which names no source', async () => {
    // Rule 2, and the one refusal it IS safe to count: an edge with no evidence
    // has no source to disclose. The store refuses to write one, so it is made
    // here by deleting the evidence underneath a real edge — an assertion about
    // unevidenced edges is worthless if none can exist.
    const orphan = await entity('Unasserted Bracket', 'unasserted-bracket');
    await relate(fixtures, amberPart, 'has_part', orphan, 'manufacturer');

    const before = await fixtures.qm.relationships({
      entity_id: amberPart.id,
      predicate: 'has_part',
      direction: 'out',
    });
    // The zero control runs with the gate ON and real edges served, so a
    // constant — or a value that merely tracks the flag — cannot satisfy it.
    expect(before.edges, 'the control must serve a real edge').toHaveLength(1);
    expect(before.edges[0]?.evidence_count).toBeGreaterThan(0);
    expect(before.unevidenced_edge_count).toBe(0);

    const edgeId = before.edges[0]?.relationship.id ?? '';
    await fixtures.driver.query('DELETE FROM relationship_evidence WHERE relationship_id = $1', [
      edgeId,
    ]);

    const after = await fixtures.qm.relationships({
      entity_id: amberPart.id,
      predicate: 'has_part',
      direction: 'out',
    });
    expect(after.edges).toEqual([]);
    expect(after.unevidenced_edge_count).toBe(1);

    // Two, not "some": a hard-coded 1 satisfies the assertion above.
    const second = await entity('Second Unasserted Bracket', 'second-unasserted-bracket');
    await relate(fixtures, amberPart, 'has_part', second, 'manufacturer');
    const secondId = (
      await fixtures.driver.query<{ id: string }>(
        'SELECT id FROM relationships WHERE object_entity_id = $1',
        [second.id],
      )
    )[0]?.id;
    await fixtures.driver.query('DELETE FROM relationship_evidence WHERE relationship_id = $1', [
      secondId ?? '',
    ]);

    const both = await fixtures.qm.relationships({
      entity_id: amberPart.id,
      predicate: 'has_part',
      direction: 'out',
    });
    expect(both.unevidenced_edge_count, 'two refused, not "some"').toBe(2);
  });

  it('counts an unevidenced edge found deeper than the first hop', async () => {
    // Nothing else in the repo exercises a refusal at level 2, so `withheld +=
    // 1` could have been guarded on `level === 1` and no test would have said
    // so. Verified: that mutation used to survive every suite.
    const deepRoot = await entity('Deep Root', 'deep-root');
    const deepMiddle = await entity('Deep Middle', 'deep-middle');
    const deepOrphan = await entity('Deep Orphan', 'deep-orphan');
    await relate(fixtures, deepRoot, 'deep_link', deepMiddle, 'manufacturer');
    await relate(fixtures, deepMiddle, 'deep_link', deepOrphan, 'manufacturer');
    const deepId = (
      await fixtures.driver.query<{ id: string }>(
        'SELECT id FROM relationships WHERE object_entity_id = $1',
        [deepOrphan.id],
      )
    )[0]?.id;
    await fixtures.driver.query('DELETE FROM relationship_evidence WHERE relationship_id = $1', [
      deepId ?? '',
    ]);

    const traversal = await fixtures.qm.relationships({
      entity_id: deepRoot.id,
      predicate: 'deep_link',
      direction: 'out',
      depth: 2,
    });
    expect(traversal.edges, 'the walk did reach depth 2').toHaveLength(1);
    expect(traversal.unevidenced_edge_count, 'a refusal at level 2 counts too').toBe(1);
  });

  it('does not let the caller\u2019s limit change how much it says was refused', async () => {
    const limitRoot = await entity('Limit Root', 'limit-root');
    const served = await Promise.all(
      ['lim-a', 'lim-b', 'lim-c'].map((slug) => entity(slug, slug)),
    );
    const orphan = await entity('Limit Orphan', 'limit-orphan');
    for (const object of served) await relate(fixtures, limitRoot, 'lim', object, 'manufacturer');
    await relate(fixtures, limitRoot, 'lim', orphan, 'manufacturer');
    const orphanEdge = (
      await fixtures.driver.query<{ id: string }>(
        'SELECT id FROM relationships WHERE object_entity_id = $1',
        [orphan.id],
      )
    )[0]?.id;
    await fixtures.driver.query('DELETE FROM relationship_evidence WHERE relationship_id = $1', [
      orphanEdge ?? '',
    ]);

    const full = await fixtures.qm.relationships({
      entity_id: limitRoot.id,
      predicate: 'lim',
      direction: 'out',
    });
    expect(full.edges).toHaveLength(3);
    expect(full.unevidenced_edge_count).toBe(1);
    expect(full.truncated, 'nothing stopped this walk').toBe(false);
  });

  it('does not claim it stopped short when it served everything', async () => {
    // `edges.length >= limit` was checked AFTER the push, so a walk with
    // exactly `limit` publishable edges tripped the flag on its last
    // successful push. REST publishes that as `boundReached`, documented as
    // "more edges exist" — so the surface said more existed when none did.
    const exact = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      direction: 'out',
      limit: 2,
    });
    expect(exact.edges, 'exactly two publishable edges exist here').toHaveLength(2);
    expect(exact.truncated).toBe(false);

    const bounded = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      predicate: 'has_part',
      direction: 'out',
      limit: 1,
    });
    expect(bounded.edges).toHaveLength(1);
    expect(bounded.truncated, 'this one really did stop short').toBe(true);
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
    expect(refrigerant?.sources).toEqual(['Ratings Directory']);
    expect(refrigerant?.sources).not.toContain(BLOCKED_PUBLISHER);
  });

  it('names both when requirePublishableRights is off', async () => {
    const rows = await fixtures.qm.canonicalFacts(mixedPart.id, {
      at: AT,
      requirePublishableRights: false,
    });
    const refrigerant = rows.find((row) => row.property === 'refrigerant');

    expect([...(refrigerant?.sources ?? [])].sort()).toEqual(
      ['Ratings Directory', BLOCKED_PUBLISHER].sort(),
    );
  });
});
