/**
 * Proof that the quality gate measures something real: `computeEntitySignals`
 * against actual stored facts and actual `provenanceCoverage`, not a stub of
 * either. `base.entity` in the shared query-model fixtures carries exactly
 * three claimed properties (`seer2_rating`, `refrigerant`, `tonnage`) plus one
 * deliberate disagreement — a `PROPOSED` rival value for `seer2_rating` — which
 * is precisely the shape needed to prove both the coverage arithmetic and the
 * disputed-critical-property signal against something the database actually
 * disagrees with itself about, not a fixture written to agree with the test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { computeEntitySignals, evaluateGate } from '../src/gates.js';
import type { QualityGate } from '../src/seo.js';

let fixtures: QueryFixtures;
const CRITICAL = ['seer2_rating', 'refrigerant', 'tonnage'];

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

describe('computeEntitySignals against a real entity', () => {
  it('measures full critical coverage when every critical property is published', async () => {
    const signals = await computeEntitySignals(
      fixtures.qm,
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
      fixtures.qm,
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
      fixtures.qm,
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
      fixtures.qm,
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
      fixtures.qm,
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
      fixtures.qm,
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
      fixtures.qm,
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
