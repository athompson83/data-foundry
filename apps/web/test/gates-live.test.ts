/**
 * Proof that the quality gate measures something real: `computeEntitySignals`
 * against actual stored facts and surface-authorized explanations, not a stub
 * of either. `base.entity` in the shared query-model fixtures carries exactly
 * three claimed properties (`seer2_rating`, `refrigerant`, `tonnage`) plus one
 * deliberate disagreement — a `PROPOSED` rival value for `seer2_rating` — which
 * is precisely the shape needed to prove both the coverage arithmetic and the
 * disputed-critical-property signal against something the database actually
 * disagrees with itself about, not a fixture written to agree with the test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import type { SurfaceQueryModel } from '@data-foundry/query-model';
import { computeEntitySignals, computeVerticalDatasetSignals, evaluateGate } from '../src/gates.js';
import { DEFAULT_CONCURRENCY } from '../src/concurrency.js';
import type { QualityGate } from '../src/seo.js';

let fixtures: QueryFixtures;
let publicQueryModel: SurfaceQueryModel;
const CRITICAL = ['seer2_rating', 'refrigerant', 'tonnage'];

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
  publicQueryModel = fixtures.qm.forSurface('PUBLIC_WEB');
});

afterAll(async () => {
  await fixtures.driver.close();
});

describe('computeEntitySignals against a real entity', () => {
  it('measures full critical coverage when every critical property is published', async () => {
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.equipment.id,
      fixtures.equipment.quality_score,
      fixtures.equipment.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(signals.critical_fact_coverage).toBe(1);
    expect(signals.total_facts).toBeGreaterThanOrEqual(3);
    expect(signals.entity_quality_score).toBe(fixtures.equipment.quality_score);
  });

  it('reports the disputed critical property the fixtures deliberately created', async () => {
    // A PROPOSED rival value for seer2_rating exists alongside the ACTIVE
    // manufacturer claim on `fixtures.equipment` — the query layer's own
    // conflict machinery, not something this test injects.
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.equipment.id,
      fixtures.equipment.quality_score,
      fixtures.equipment.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(signals.disputed_critical_property).toBe(true);
  });

  it('reports zero critical coverage for an entity with no critical properties published', async () => {
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.rival.id,
      fixtures.rival.quality_score,
      fixtures.rival.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(signals.critical_fact_coverage).toBe(0);
    expect(signals.total_facts).toBe(0);
  });

  it('reports full evidence coverage — every claim in these fixtures carries evidence', async () => {
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.equipment.id,
      fixtures.equipment.quality_score,
      fixtures.equipment.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(signals.evidence_coverage).toBe(1);
  });
});

describe('the entity_detail-shaped gate against real data', () => {
  const gate: QualityGate = {
    min_critical_fact_coverage: 0.8,
    min_total_facts: 3,
    min_entity_quality_score: 0.6,
    block_on_disputed_critical_property: true,
  };

  it('a well-covered, undisputed-enough entity can still fail on a real dispute', async () => {
    // fixtures.equipment clears coverage and quality but carries the disputed
    // property this gate blocks on — the honest end-to-end answer is FAIL.
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.equipment.id,
      fixtures.equipment.quality_score,
      fixtures.equipment.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    const verdict = evaluateGate(gate, signals);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes('unresolved conflict'))).toBe(true);
  });

  it('passes for heatPump, which the fixtures never put in dispute', async () => {
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.heatPump.id,
      fixtures.heatPump.quality_score,
      fixtures.heatPump.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(evaluateGate(gate, signals).passed).toBe(true);
  });

  it('fails an entity with nothing published at all', async () => {
    const signals = await computeEntitySignals(
      publicQueryModel,
      fixtures.rival.id,
      fixtures.rival.quality_score,
      fixtures.rival.updated_at,
      CRITICAL,
      {},
      new Date('2026-03-01T00:00:00Z'),
    );
    expect(evaluateGate(gate, signals).passed).toBe(false);
  });
});

describe('computeVerticalDatasetSignals — bounded per-entity fan-out', () => {
  it('computes the same distinct_sources as a manual serial union over the same search results', async () => {
    // The oracle: exactly what the old sequential for-loop computed, done by
    // hand here so this does not depend on which implementation gates.ts
    // currently uses — it proves the bounded-concurrency rewrite did not
    // change what gets counted, only how the awaits are scheduled.
    const result = await publicQueryModel.search({ vertical_id: fixtures.vertical.id, limit: 200, offset: 0 });
    const expectedSources = new Set<string>();
    for (const hit of result.hits.slice(0, 200)) {
      const facts = await publicQueryModel.canonicalFacts(hit.entity.id);
      for (const fact of facts) for (const s of fact.sources) expectedSources.add(s);
    }

    const signals = await computeVerticalDatasetSignals(publicQueryModel, fixtures.vertical.id);
    expect(signals.distinct_sources).toBe(expectedSources.size);
    expect(signals.entities).toBe(result.total);
  });

  it('runs canonicalFacts for more than one entity concurrently, bounded by DEFAULT_CONCURRENCY', async () => {
    // RED under the pre-fix code: this was a plain serial `for` loop, so at
    // most one canonicalFacts call was ever in flight.
    let active = 0;
    let maxActive = 0;
    const spied = {
      ...publicQueryModel,
      canonicalFacts: async (
        entityId: Parameters<typeof publicQueryModel.canonicalFacts>[0],
        policy?: Parameters<typeof publicQueryModel.canonicalFacts>[1],
      ) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          return await publicQueryModel.canonicalFacts(entityId, policy);
        } finally {
          active -= 1;
        }
      },
    };

    await computeVerticalDatasetSignals(spied, fixtures.vertical.id);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
  });
});
