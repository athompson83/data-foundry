import { afterEach, describe, expect, it } from 'vitest';
import { factConfidence } from '@data-foundry/canonical-schema';
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from './support.js';

let fixtures: QueryFixtures | undefined;

afterEach(async () => {
  await fixtures?.driver.close();
  fixtures = undefined;
});

describe('fact output contract at canonical query boundaries', () => {
  it('refuses an upgraded fact whose output kind is still unknown', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);

    const [fact] = await fixtures.driver.query<{ id: string }>(
      `SELECT id FROM facts
        WHERE entity_id = $1 AND property = 'tonnage'
        ORDER BY recorded_at DESC LIMIT 1`,
      [fixtures.equipment.id],
    );
    expect(fact).toBeDefined();

    // Simulate the preserved row in an upgraded database. Migration 0016
    // deliberately leaves legacy output kinds NULL rather than guessing.
    await fixtures.driver.exec('ALTER TABLE facts DISABLE TRIGGER facts_output_contract_deferred');
    await fixtures.driver.exec('ALTER TABLE facts DISABLE TRIGGER facts_output_kind_immutable');
    await fixtures.driver.query('UPDATE facts SET output_kind = NULL WHERE id = $1', [fact?.id ?? '']);
    await fixtures.driver.exec('ALTER TABLE facts ENABLE TRIGGER facts_output_kind_immutable');
    await fixtures.driver.exec('ALTER TABLE facts ENABLE TRIGGER facts_output_contract_deferred');

    expect(
      (await fixtures.qm.canonicalFacts(fixtures.equipment.id, { at: ts('2026-07-01T00:00:00Z') }))
        .map((row) => row.property),
    ).not.toContain('tonnage');
    expect(
      (
        await fixtures.qm.facts({
          entity_id: fixtures.equipment.id,
          at: ts('2026-07-01T00:00:00Z'),
        })
      ).map((row) => row.fact.property),
    ).not.toContain('tonnage');
    expect(
      (
        await fixtures.qm
          .forSurface('PUBLIC_WEB', { asOf: ts('2026-07-01T00:00:00Z') })
          .canonicalFacts(fixtures.equipment.id, { at: ts('2026-07-01T00:00:00Z') })
      ).map((row) => row.property),
    ).not.toContain('tonnage');
  });

  it('requires DERIVE and recursively authorizes every classified input', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    const source = fixtures.sources.manufacturer;
    const input = await claim(fixtures, 'manufacturer', {
      entity_id: fixtures.equipment.id,
      property: 'recursive_input',
      value: 12,
      value_type: 'number',
    });
    const evidence = [
      {
        artifact_id: source.artifact.id,
        source_record_id: source.record.id,
        source_value: '12',
        locator_type: 'WHOLE_DOCUMENT' as const,
        locator_value: '',
        observed_at: source.artifact.retrieved_at,
      },
    ] as const;
    const first = await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.equipment.id,
        property: 'recursive_first',
        normalized_value: 6,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-02-01T00:00:00Z'),
        confidence: factConfidence(0.9),
        recorded_at: ts('2026-02-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      evidence,
      [{ input_fact_id: input.fact.id, transformation_ref: 'task8.divide.v1' }],
    );
    await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.equipment.id,
        property: 'recursive_second',
        normalized_value: 3,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-02-01T00:00:00Z'),
        confidence: factConfidence(0.9),
        recorded_at: ts('2026-02-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      evidence,
      [{ input_fact_id: first.fact.id, transformation_ref: 'task8.divide.v2' }],
    );

    const before = await fixtures.qm
      .forSurface('PUBLIC_WEB', { asOf: ts('2026-07-01T00:00:00Z') })
      .canonicalFacts(fixtures.equipment.id, { at: ts('2026-07-01T00:00:00Z') });
    expect(before.map((row) => row.property)).toContain('recursive_input');
    expect(before.map((row) => row.property)).not.toContain('recursive_first');
    expect(before.map((row) => row.property)).not.toContain('recursive_second');

    await seedDeriveGrant(fixtures);
    const after = await fixtures.qm
      .forSurface('PUBLIC_WEB', { asOf: ts('2026-07-01T00:00:00Z') })
      .canonicalFacts(fixtures.equipment.id, { at: ts('2026-07-01T00:00:00Z') });
    expect(after.map((row) => row.property)).toEqual(
      expect.arrayContaining(['recursive_input', 'recursive_first', 'recursive_second']),
    );
  });
});

async function seedDeriveGrant(current: QueryFixtures): Promise<void> {
  const source = current.sources.manufacturer.source;
  const [lineage] = await current.driver.query<{
    terms_version_id: string;
    review_evidence_id: string;
  }>(
    `SELECT rtv.id AS terms_version_id,
            s.rights_publisher_mapping_evidence_artifact_id AS review_evidence_id
      FROM sources s
      JOIN rights_terms_cells rtc ON rtc.source_id = s.id
      JOIN rights_terms_versions rtv ON rtv.terms_cell_id = rtc.id
      JOIN rights_terms_activation_events rtae ON rtae.terms_version_id = rtv.id
      WHERE s.id = $1 AND rtae.state = 'ACTIVE'
      ORDER BY rtae.sequence_no DESC LIMIT 1`,
    [source.id],
  );
  if (lineage === undefined) throw new Error('synthetic rights terms not found');
  const cellId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const effective = ts('2026-01-01T00:00:00Z');
  const recheck = ts('2027-01-01T00:00:00Z');
  await current.driver.exec('BEGIN');
  try {
    await current.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', 'DERIVE', 'INTERNAL_PROCESSING', 'test-fixture')`,
      [cellId, source.id],
    );
    await current.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
          rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED', 'HUMAN',
               'test-fixture', $5, $5, $6, 'explicit recursive derive grant', 'test-fixture')`,
      [decisionId, cellId, lineage.terms_version_id, lineage.review_evidence_id, effective, recheck],
    );
    await current.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'recursive fixture', $2)`,
      [decisionId, effective],
    );
    await current.driver.exec('COMMIT');
  } catch (error) {
    await current.driver.exec('ROLLBACK');
    throw error;
  }
}
