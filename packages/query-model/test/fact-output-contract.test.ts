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

    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'recursive_first',
      outputClass: 'DERIVED_METRIC',
      state: 'ALLOW',
    });
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'recursive_second',
      outputClass: 'DERIVED_METRIC',
      state: 'ALLOW',
    });
    const after = await fixtures.qm
      .forSurface('PUBLIC_WEB', { asOf: ts('2026-07-01T00:00:00Z') })
      .canonicalFacts(fixtures.equipment.id, { at: ts('2026-07-01T00:00:00Z') });
    expect(after.map((row) => row.property)).toEqual(
      expect.arrayContaining(['recursive_input', 'recursive_first', 'recursive_second']),
    );
  });

  it('matches DERIVE on the target output field and DERIVED_METRIC tuple, not neighboring tuples', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    await appendDerivedFixture(fixtures, 'scoped_input', 'scoped_output');

    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'scoped_input', outputClass: 'NORMALIZED_FACT', state: 'ALLOW',
    });
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'scoped_output', outputClass: 'NORMALIZED_FACT', state: 'ALLOW',
    });
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'neighbor_output', outputClass: 'DERIVED_METRIC', state: 'ALLOW',
    });
    const before = await surfaceProperties(fixtures, '2026-07-01T00:00:00Z');
    expect(before).toContain('scoped_input');
    expect(before).not.toContain('scoped_output');

    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'scoped_output', outputClass: 'DERIVED_METRIC', state: 'ALLOW',
    });
    expect(await surfaceProperties(fixtures, '2026-07-01T00:00:00Z')).toContain('scoped_output');
  });

  it('honors an exact target-tuple DENY even when the input tuple is allowed', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    await appendDerivedFixture(fixtures, 'denied_input', 'denied_output');
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'denied_input', outputClass: 'NORMALIZED_FACT', state: 'ALLOW',
    });
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'denied_output', outputClass: 'DERIVED_METRIC', state: 'DENY',
    });
    expect(await surfaceProperties(fixtures, '2026-07-01T00:00:00Z')).not.toContain('denied_output');
  });

  it('stops deriving after the exact target grant is superseded, despite an input-tuple neighbor', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    await appendDerivedFixture(fixtures, 'revoked_input', 'revoked_output');
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'revoked_input', outputClass: 'NORMALIZED_FACT', state: 'ALLOW',
    });
    const current = await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'revoked_output', outputClass: 'DERIVED_METRIC', state: 'ALLOW',
    });
    expect(await surfaceProperties(fixtures, '2026-05-01T00:00:00Z')).toContain('revoked_output');
    await seedScopedDeriveDecision(fixtures, {
      fieldKey: 'revoked_output',
      outputClass: 'DERIVED_METRIC',
      state: 'UNKNOWN',
      cellId: current.cellId,
      supersedesDecisionId: current.decisionId,
      occurredAt: '2026-06-01T00:00:00Z',
    });
    expect(await surfaceProperties(fixtures, '2026-07-01T00:00:00Z')).not.toContain('revoked_output');
  });

  it('attributes a derived surface value to sources that contribute only through its inputs', async () => {
    fixtures = await createQueryFixtures({ trigram: false });
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer', 'certifier']);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    const input = await claim(fixtures, 'certifier', {
      entity_id: fixtures.equipment.id,
      property: 'attribution_input',
      value: 12,
      value_type: 'number',
    });
    const outputSource = fixtures.sources.manufacturer;
    await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.equipment.id,
        property: 'attribution_output',
        normalized_value: 6,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-02-01T00:00:00Z'),
        confidence: factConfidence(0.9),
        recorded_at: ts('2026-02-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [{
        artifact_id: outputSource.artifact.id,
        source_record_id: outputSource.record.id,
        source_value: '6',
        locator_type: 'WHOLE_DOCUMENT',
        locator_value: '',
        observed_at: outputSource.artifact.retrieved_at,
      }],
      [{ input_fact_id: input.fact.id, transformation_ref: 'attribution.divide.v1' }],
    );
    await seedScopedDeriveDecision(fixtures, {
      sourceKey: 'certifier',
      fieldKey: 'attribution_output',
      outputClass: 'DERIVED_METRIC',
      state: 'ALLOW',
    });

    const surface = fixtures.qm.forSurface('PUBLIC_WEB', {
      asOf: ts('2026-07-01T00:00:00Z'),
    });
    const view = (await surface.canonicalFacts(fixtures.equipment.id, {
      at: ts('2026-07-01T00:00:00Z'),
    })).find((row) => row.property === 'attribution_output');
    expect(new Set(view?.sources)).toEqual(new Set(['Acme Climate', 'Ratings Directory']));
    const explanation = await surface.explainFact(
      fixtures.equipment.id,
      'attribution_output',
      { at: ts('2026-07-01T00:00:00Z') },
    );
    expect(new Set(explanation?.selected?.attributions.map((row) => row.publisher))).toEqual(
      new Set(['Acme Climate', 'Ratings Directory']),
    );
  });
});

async function appendDerivedFixture(
  current: QueryFixtures,
  inputProperty: string,
  outputProperty: string,
): Promise<void> {
  const source = current.sources.manufacturer;
  const input = await claim(current, 'manufacturer', {
    entity_id: current.equipment.id,
    property: inputProperty as never,
    value: 12,
    value_type: 'number',
  });
  await current.store.appendDerivedFactWithEvidence(
    {
      entity_id: current.equipment.id,
      property: outputProperty as never,
      normalized_value: 6,
      value_type: 'number',
      unit: null,
      valid_from: ts('2026-02-01T00:00:00Z'),
      confidence: factConfidence(0.9),
      recorded_at: ts('2026-02-01T00:00:00Z'),
      status: 'ACTIVE',
    },
    [{
      artifact_id: source.artifact.id,
      source_record_id: source.record.id,
      source_value: '6',
      locator_type: 'WHOLE_DOCUMENT',
      locator_value: '',
      observed_at: source.artifact.retrieved_at,
    }],
    [{ input_fact_id: input.fact.id, transformation_ref: `test.${outputProperty}.v1` }],
  );
}

async function surfaceProperties(current: QueryFixtures, asOf: string): Promise<string[]> {
  return (
    await current.qm
      .forSurface('PUBLIC_WEB', { asOf: ts(asOf) })
      .canonicalFacts(current.equipment.id, { at: ts(asOf) })
  ).map((row) => row.property);
}

interface ScopedDecisionOptions {
  readonly sourceKey?: keyof QueryFixtures['sources'];
  readonly fieldKey: string;
  readonly outputClass: 'NORMALIZED_FACT' | 'DERIVED_METRIC';
  readonly state: 'ALLOW' | 'DENY' | 'UNKNOWN';
  readonly cellId?: string;
  readonly supersedesDecisionId?: string;
  readonly occurredAt?: string;
}

async function seedScopedDeriveDecision(
  current: QueryFixtures,
  options: ScopedDecisionOptions,
): Promise<{ cellId: string; decisionId: string }> {
  const source = current.sources[options.sourceKey ?? 'manufacturer'].source;
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
  const cellId = options.cellId ?? crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const effective = ts('2026-01-01T00:00:00Z');
  const recheck = ts('2027-01-01T00:00:00Z');
  await current.driver.exec('BEGIN');
  try {
    if (options.cellId === undefined) {
      await current.driver.query(
        `INSERT INTO rights_cells
           (id, source_id, acquisition_route, field_key, output_class,
            operation, channel, created_by)
         VALUES ($1, $2, 'DIRECT_HTTP', $3, $4,
                 'DERIVE', 'INTERNAL_PROCESSING', 'test-fixture')`,
        [cellId, source.id, options.fieldKey, options.outputClass],
      );
    }
    await current.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
          rationale, supersedes_decision_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'synthetic fixture only', 'APPROVED', 'HUMAN',
               'test-fixture', $6, $6, $7, 'explicit scoped derive decision', $8, 'test-fixture')`,
      [
        decisionId,
        cellId,
        options.state,
        lineage.terms_version_id,
        lineage.review_evidence_id,
        effective,
        recheck,
        options.supersedesDecisionId ?? null,
      ],
    );
    await current.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'scoped fixture', $2)`,
      [decisionId, ts(options.occurredAt ?? '2026-01-01T00:00:00Z')],
    );
    await current.driver.exec('COMMIT');
  } catch (error) {
    await current.driver.exec('ROLLBACK');
    throw error;
  }
  return { cellId, decisionId };
}
