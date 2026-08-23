/**
 * The rest of the canonical query surface: redirect-aware lookups, facts with
 * evidence, the explainable canonical view, traversal and comparison.
 *
 * These are the queries web, REST and MCP share (AGENTS.md rule 5), so what is
 * asserted here is what all three surfaces are guaranteed to agree on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, relate, ts, type QueryFixtures } from './support.js';

let fixtures: QueryFixtures;
const AT = ts('2026-07-01T00:00:00Z');

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await relate(fixtures, fixtures.equipment, 'uses_part', fixtures.motor);
  await relate(fixtures, fixtures.motor, 'replaces', fixtures.rival);
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('entity lookup', () => {
  it('reads an entity by id and by slug', async () => {
    const byId = await fixtures.qm.getEntity(fixtures.equipment.id);
    expect(byId?.entity.canonical_slug).toBe('carrier-infinity-24anb7');
    expect(byId?.redirected_from).toBeNull();

    const bySlug = await fixtures.qm.getEntityBySlug(
      fixtures.vertical.id,
      'equipment',
      'carrier-infinity-24anb7',
    );
    expect(bySlug?.entity.id).toBe(fixtures.equipment.id);
  });

  it('follows entity_redirects after a merge, by id and by retired slug', async () => {
    const duplicate = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Carrier 24ANB7 (duplicate listing)',
      canonical_slug: 'carrier-24anb7-duplicate',
      status: 'ACTIVE',
      quality_score: fixtures.equipment.quality_score,
      first_seen_at: ts('2026-01-02T00:00:00Z'),
      last_verified_at: null,
    });

    await fixtures.store.mergeEntities({
      from_entity_id: duplicate.id,
      to_entity_id: fixtures.equipment.id,
      reason: 'MERGE',
      from_slug: duplicate.canonical_slug,
      judgment_id: null,
    });

    // An id saved before the merge still resolves — and says it redirected.
    const byOldId = await fixtures.qm.getEntity(duplicate.id);
    expect(byOldId?.entity.id).toBe(fixtures.equipment.id);
    expect(byOldId?.redirected_from?.from_entity_id).toBe(duplicate.id);
    expect(byOldId?.redirected_from?.reason).toBe('MERGE');

    // So does a bookmarked URL.
    const byOldSlug = await fixtures.qm.getEntityBySlug(
      fixtures.vertical.id,
      'equipment',
      'carrier-24anb7-duplicate',
    );
    expect(byOldSlug?.entity.id).toBe(fixtures.equipment.id);
    expect(byOldSlug?.redirected_from?.from_slug).toBe('carrier-24anb7-duplicate');
    expect(byOldSlug?.redirected_from?.hops).toHaveLength(1);
  });

  it('resolves an identifier lookup through a redirect', async () => {
    const found = await fixtures.qm.lookupIdentifier({
      vertical_id: fixtures.vertical.id,
      value: 'hk32ea001',
    });
    expect(found.entities.map((view) => view.entity.id)).toEqual([fixtures.motor.id]);
  });

  it('returns null for an unknown slug', async () => {
    const missing = await fixtures.qm.getEntityBySlug(
      fixtures.vertical.id,
      'equipment',
      'does-not-exist',
    );
    expect(missing).toBeNull();
  });
});

describe('facts and the canonical view', () => {
  it('lists facts with their evidence chains', async () => {
    const facts = await fixtures.qm.facts({ entity_id: fixtures.equipment.id, at: AT });
    expect(facts.length).toBeGreaterThanOrEqual(3);
    for (const entry of facts) {
      expect(entry.lineage?.traceable).toBe(true);
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.source_count).toBeGreaterThan(0);
    }
  });

  it('serves one canonical value per property, with the rule that chose it', async () => {
    const view = await fixtures.qm.canonicalFacts(fixtures.equipment.id, { at: AT });
    const byProperty = new Map(view.map((row) => [row.property, row] as const));

    expect(byProperty.get('refrigerant')?.value).toBe('R-454B');
    expect(byProperty.get('tonnage')?.value).toBe(3);

    // seer2_rating is disputed: the manufacturer says 16, an aggregator 15.2.
    const seer = byProperty.get('seer2_rating');
    expect(seer?.value).toBe(16);
    expect(seer?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(seer?.unresolved_conflict).toBe(true);
    expect(seer?.conflicts[0]?.value).toBe(15.2);
    expect(seer?.sources).toContain('Acme Climate');
  });

  it('exposes the same trust surface the provenance package produces', async () => {
    const explanation = await fixtures.qm.explainFact(
      fixtures.equipment.id,
      'seer2_rating',
      { at: AT },
    );
    expect(explanation?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(explanation?.claims).toHaveLength(2);
    expect(explanation?.narrative.some((line) => line.startsWith('Unresolved conflict'))).toBe(true);

    const everything = await fixtures.qm.explainEntity(fixtures.equipment.id, { at: AT });
    expect([...everything.keys()].sort()).toEqual(['refrigerant', 'seer2_rating', 'tonnage']);
  });

  it('reports provenance coverage through the same layer', async () => {
    const report = await fixtures.qm.provenanceCoverage({ vertical_id: fixtures.vertical.id });
    expect(report.facts.coverage).toBe(1);
    expect(report.by_entity.length).toBeGreaterThan(0);
  });
});

describe('relationship traversal', () => {
  it('walks one hop by default', async () => {
    const traversal = await fixtures.qm.relationships({ entity_id: fixtures.equipment.id });
    expect(traversal.edges).toHaveLength(1);
    expect(traversal.edges[0]?.relationship.predicate).toBe('uses_part');
    expect(traversal.edges[0]?.neighbor.id).toBe(fixtures.motor.id);
    expect(traversal.edges[0]?.direction).toBe('out');
    expect(traversal.edges[0]?.evidence_count).toBe(1);
  });

  it('walks further when asked, without revisiting nodes', async () => {
    const traversal = await fixtures.qm.relationships({
      entity_id: fixtures.equipment.id,
      depth: 2,
    });
    expect(traversal.edges.map((edge) => edge.relationship.predicate).sort()).toEqual([
      'replaces',
      'uses_part',
    ]);
    expect(traversal.edges.find((edge) => edge.relationship.predicate === 'replaces')?.depth).toBe(2);
  });

  it('filters by predicate and direction', async () => {
    const incoming = await fixtures.qm.relationships({
      entity_id: fixtures.motor.id,
      direction: 'in',
    });
    expect(incoming.edges).toHaveLength(1);
    expect(incoming.edges[0]?.neighbor.id).toBe(fixtures.equipment.id);

    const byPredicate = await fixtures.qm.relationships({
      entity_id: fixtures.motor.id,
      predicate: 'replaces',
    });
    expect(byPredicate.edges.map((edge) => edge.neighbor.id)).toEqual([fixtures.rival.id]);
  });
});

describe('comparison', () => {
  it('aligns two entities on canonical values in field-metadata order', async () => {
    const comparison = await fixtures.qm.compare({
      entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
    });

    expect(comparison.entities.map((entity) => entity.canonical_slug)).toEqual([
      'carrier-infinity-24anb7',
      'carrier-infinity-25vna4',
    ]);
    // Declaration order from HVAC_FIELDS, not database order.
    expect(comparison.rows.map((row) => row.property)).toEqual([
      'seer2_rating',
      'refrigerant',
      'tonnage',
    ]);

    const seer = comparison.rows.find((row) => row.property === 'seer2_rating');
    expect(seer?.differs).toBe(true);
    expect(seer?.cells.map((cell) => cell.value)).toEqual([16, 18]);
    expect(seer?.label).toBe('SEER2 rating');

    const refrigerant = comparison.rows.find((row) => row.property === 'refrigerant');
    expect(refrigerant?.differs).toBe(false);

    expect(comparison.properties_compared).toBe(3);
    expect(comparison.properties_differing).toBe(2);
  });

  it('carries the selection rule and conflict flag into the comparison table', async () => {
    const comparison = await fixtures.qm.compare({
      entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
      properties: ['seer2_rating'],
    });
    const cells = comparison.rows[0]?.cells ?? [];
    expect(cells[0]?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(cells[0]?.unresolved_conflict).toBe(true);
    expect(cells[1]?.unresolved_conflict).toBe(false);
  });
});
