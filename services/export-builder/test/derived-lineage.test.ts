import { afterEach, describe, expect, it } from 'vitest';
import { factConfidence } from '@data-foundry/canonical-schema';
import {
  ExportRefusedError,
  buildDatasetExport,
  createMemorySink,
} from '../src/index.js';
import {
  GENERATED_AT,
  baseOptions,
  claim,
  createExportFixtures,
  ts,
  type ExportFixtures,
} from './support.js';

let fixtures: ExportFixtures | undefined;

afterEach(async () => {
  await fixtures?.driver.close();
  fixtures = undefined;
});

describe('derived provenance in bulk artifacts', () => {
  it('carries an input-only attribution obligation into rows, evidence, and manifest sources', async () => {
    fixtures = await createExportFixtures();
    const input = await claim(fixtures, 'certifier', {
      entity_id: fixtures.equipment.id,
      property: 'bulk_lineage_input' as never,
      value: 12,
      value_type: 'number',
    });
    const outputSource = fixtures.sources.manufacturer;
    const output = await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.equipment.id,
        property: 'bulk_lineage_output',
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
      [{ input_fact_id: input.fact.id, transformation_ref: 'bulk.divide.v1' }],
    );
    await seedScopedDeriveAllow(fixtures, 'certifier', 'bulk_lineage_output');
    await seedScopedDeriveAllow(fixtures, 'manufacturer', 'bulk_lineage_output');

    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink: createMemorySink('derived-lineage'),
      version: '2026-08-14.derived-lineage',
      properties: { mode: 'allowlist', include: ['bulk_lineage_output'] as never },
    });
    const row = result.rows.find((candidate) => candidate.fact_id === output.fact.id);
    expect(row?.sources).toBe('Acme Climate|Ratings Directory');
    expect(new Set(result.evidence.map((evidence) => evidence.source_publisher))).toEqual(
      new Set(['Acme Climate', 'Ratings Directory']),
    );
    const certifier = result.manifest.sources.find(
      (source) => source.source_key === 'ratings-directory',
    );
    expect(certifier?.rights.attribution_required).toBe(true);
    expect(certifier?.rights.attribution_text).toBe(
      'Certification data courtesy of the Ratings Directory',
    );
    expect(certifier?.fact_count).toBe(1);
  }, 120_000);

  it('refuses the whole bulk artifact when the direct output source lacks exact DERIVE', async () => {
    fixtures = await createExportFixtures();
    const input = await claim(fixtures, 'manufacturer', {
      entity_id: fixtures.equipment.id,
      property: 'bulk_direct_rights_input' as never,
      value: 12,
      value_type: 'number',
    });
    const outputSource = fixtures.sources.aggregator;
    await fixtures.store.appendDerivedFactWithEvidence(
      {
        entity_id: fixtures.equipment.id,
        property: 'bulk_direct_rights_output' as never,
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
      [{ input_fact_id: input.fact.id, transformation_ref: 'bulk.direct-rights.v1' }],
    );
    await seedScopedDeriveAllow(fixtures, 'manufacturer', 'bulk_direct_rights_output');
    const sink = createMemorySink('derived-direct-rights-refused');
    let failure: unknown;

    try {
      await buildDatasetExport({
        ...baseOptions(fixtures),
        sink,
        version: '2026-08-14.derived-direct-rights-refused',
        properties: {
          mode: 'allowlist',
          include: ['bulk_direct_rights_output'] as never,
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ExportRefusedError);
    expect((failure as ExportRefusedError).refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FACT_RIGHTS_MATRIX_REFUSED' }),
      ]),
    );
    expect(sink.files.size).toBe(0);
  }, 120_000);
});

async function seedScopedDeriveAllow(
  current: ExportFixtures,
  sourceKey: keyof ExportFixtures['sources'],
  fieldKey: string,
): Promise<void> {
  const source = current.sources[sourceKey].source;
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
  if (lineage === undefined) throw new Error('synthetic terms not found');
  const cellId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const effective = ts('2026-01-01T00:00:00Z');
  const recheck = ts('2027-01-01T00:00:00Z');
  await current.driver.exec('BEGIN');
  try {
    await current.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, field_key, output_class,
          operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', $3, 'DERIVED_METRIC',
               'DERIVE', 'INTERNAL_PROCESSING', 'test-fixture')`,
      [cellId, source.id, fieldKey],
    );
    await current.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
          clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
          effective_from, recheck_at, rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED',
               'HUMAN', 'test-fixture', $5, $5, $6,
               'explicit derived export grant', 'test-fixture')`,
      [decisionId, cellId, lineage.terms_version_id, lineage.review_evidence_id, effective, recheck],
    );
    await current.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'fixture', $2)`,
      [decisionId, effective],
    );
    await current.driver.exec('COMMIT');
  } catch (error) {
    await current.driver.exec('ROLLBACK');
    throw error;
  }
}
