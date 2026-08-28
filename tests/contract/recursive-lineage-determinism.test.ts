/**
 * Recursive provenance is public data, so its order must be a function of the
 * contributing claims rather than of database-minted UUIDs. This fixture uses
 * the same two inputs in two clean databases but deliberately assigns their
 * fact UUIDs in the opposite order. That makes an `ORDER BY input_fact_id`
 * observably wrong instead of relying on a lucky random permutation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { factConfidence, type FactId, type Identifier } from '@data-foundry/canonical-schema';
import { createApiApp } from '../../apps/api/src/index.js';
import type { RestFact } from '../../packages/query-model/src/index.js';
import {
  buildDatasetExport,
  createMemorySink,
  type DatasetExportResult,
} from '../../services/export-builder/src/index.js';
import {
  baseOptions,
  createExportFixtures,
  ts,
  type ExportFixtures,
} from '../../services/export-builder/test/support.js';

const TARGET = 'semantic_order_output' as Identifier;
const AT = ts('2026-02-01T00:00:00Z');
const LOW_ID = '00000000-0000-4000-8000-000000000011' as FactId;
const HIGH_ID = 'ffffffff-ffff-4fff-bfff-fffffffffff1' as FactId;

interface RebuiltSurfaceBytes {
  readonly query: string;
  readonly rest: string;
  readonly bulk: string;
}

let first: ExportFixtures;
let second: ExportFixtures;
let firstBytes: RebuiltSurfaceBytes;
let secondBytes: RebuiltSurfaceBytes;

beforeAll(async () => {
  first = await createExportFixtures({ surfaceRights: ['API_FREE', 'BULK_EXPORT'] });
  second = await createExportFixtures({ surfaceRights: ['API_FREE', 'BULK_EXPORT'] });
  firstBytes = await buildSurfaceBytes(first, {
    manufacturer: LOW_ID,
    certifier: HIGH_ID,
  });
  secondBytes = await buildSurfaceBytes(second, {
    manufacturer: HIGH_ID,
    certifier: LOW_ID,
  });
}, 180_000);

afterAll(async () => {
  await first?.driver.close();
  await second?.driver.close();
});

describe('recursive lineage ordering across clean rebuilds', () => {
  it('emits byte-equivalent query, REST, and bulk provenance for opposite fact UUID order', () => {
    expect(secondBytes.query).toBe(firstBytes.query);
    expect(secondBytes.rest).toBe(firstBytes.rest);
    expect(secondBytes.bulk).toBe(firstBytes.bulk);
  });

  it('orders every outward publisher and attribution array by stable code-unit semantics', () => {
    const expected = ['Acme Climate', 'Ratings Directory', 'SpecAggregator'];
    expect(JSON.parse(firstBytes.query)).toMatchObject({
      sources: expected,
      attributions: expected,
    });
    expect(JSON.parse(firstBytes.rest)).toMatchObject({ sources: expected });
    expect(JSON.parse(firstBytes.bulk)).toMatchObject({
      sources: expected.join('|'),
      evidencePublishers: expected,
      manifestPublishers: expected,
    });
  });
});

async function buildSurfaceBytes(
  fixtures: ExportFixtures,
  ids: { readonly manufacturer: FactId; readonly certifier: FactId },
): Promise<RebuiltSurfaceBytes> {
  await insertNormalizedInput(fixtures, 'manufacturer', ids.manufacturer, 'alpha_input', 12);
  await insertNormalizedInput(fixtures, 'certifier', ids.certifier, 'zeta_input', 30);

  const outputSource = fixtures.sources.aggregator;
  await fixtures.store.appendDerivedFactWithEvidence(
    {
      entity_id: fixtures.equipment.id,
      property: TARGET,
      normalized_value: 42,
      value_type: 'number',
      unit: null,
      valid_from: AT,
      confidence: factConfidence(0.9),
      recorded_at: AT,
      status: 'ACTIVE',
    },
    [{
      artifact_id: outputSource.artifact.id,
      source_record_id: outputSource.record.id,
      source_value: '42',
      locator_type: 'WHOLE_DOCUMENT',
      locator_value: '',
      observed_at: AT,
    }],
    [
      { input_fact_id: ids.manufacturer, transformation_ref: 'semantic.add.alpha.v1' },
      { input_fact_id: ids.certifier, transformation_ref: 'semantic.add.zeta.v1' },
    ],
  );
  await seedScopedDeriveAllow(fixtures, 'manufacturer', TARGET);
  await seedScopedDeriveAllow(fixtures, 'certifier', TARGET);
  await seedScopedDeriveAllow(fixtures, 'aggregator', TARGET);

  const apiSurface = fixtures.qm.forSurface('API_FREE', { asOf: AT });
  const view = (await apiSurface.canonicalFacts(fixtures.equipment.id, { at: AT }))
    .find((candidate) => candidate.property === TARGET);
  const explanation = await apiSurface.explainFact(fixtures.equipment.id, TARGET, { at: AT });
  if (view === undefined || explanation?.selected === null || explanation === null) {
    throw new Error('derived deterministic-order fixture did not reach the query surface');
  }

  const query = JSON.stringify({
    sources: view.sources,
    attributions: explanation.selected.attributions.map((row) => row.publisher),
  });

  const app = createApiApp({ queryModel: fixtures.qm, verticalId: fixtures.vertical.id });
  const response = await app(
    {
      method: 'GET',
      url: `/v1/entities/${fixtures.equipment.id}/facts?property=${TARGET}`,
    },
    undefined,
    { surface: 'API_FREE' },
  );
  const facts = (response.body as { data: RestFact[] }).data;
  const restFact = facts.find((candidate) => candidate.property === TARGET);
  if (response.status !== 200 || restFact === undefined) {
    throw new Error(`derived deterministic-order fixture API failed with ${response.status}`);
  }
  const rest = JSON.stringify({ sources: restFact.sources });

  const exportResult = await buildDatasetExport({
    ...baseOptions(fixtures),
    sink: createMemorySink(`semantic-order-${ids.manufacturer}`),
    version: '2026-08-14.semantic-order',
    properties: { mode: 'allowlist', include: [TARGET] },
  });
  const bulk = semanticBulkBytes(exportResult);
  return { query, rest, bulk };
}

async function insertNormalizedInput(
  fixtures: ExportFixtures,
  sourceKey: 'manufacturer' | 'certifier',
  id: FactId,
  property: string,
  value: number,
): Promise<void> {
  const source = fixtures.sources[sourceKey];
  await fixtures.driver.exec('BEGIN');
  try {
    await fixtures.driver.query(
      `INSERT INTO facts
         (id, entity_id, property, normalized_value, value_type, output_kind, unit,
          valid_from, valid_to, status, confidence, supersedes_fact_id, recorded_at)
       VALUES ($1, $2, $3, $4::jsonb, 'number', 'NORMALIZED_FACT', NULL,
               $5, NULL, 'ACTIVE', 0.9, NULL, $5)`,
      [id, fixtures.equipment.id, property, JSON.stringify(value), AT],
    );
    await fixtures.driver.query(
      `INSERT INTO fact_evidence
         (fact_id, artifact_id, source_record_id, source_value,
          locator_type, locator_value, observed_at)
       VALUES ($1, $2, $3, $4, 'CSS_SELECTOR', $5, $6)`,
      [id, source.artifact.id, source.record.id, String(value), `[data-field="${property}"]`, AT],
    );
    await fixtures.driver.exec('COMMIT');
  } catch (error) {
    await fixtures.driver.exec('ROLLBACK');
    throw error;
  }
}

async function seedScopedDeriveAllow(
  fixtures: ExportFixtures,
  sourceKey: 'manufacturer' | 'certifier' | 'aggregator',
  fieldKey: Identifier,
): Promise<void> {
  const source = fixtures.sources[sourceKey].source;
  const [lineage] = await fixtures.driver.query<{
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
  const recheck = ts('2027-01-01T00:00:00Z');
  await fixtures.driver.exec('BEGIN');
  try {
    await fixtures.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, field_key, output_class,
          operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', $3, 'DERIVED_METRIC',
               'DERIVE', 'INTERNAL_PROCESSING', 'test-fixture')`,
      [cellId, source.id, fieldKey],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
          clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
          effective_from, recheck_at, rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED',
               'HUMAN', 'test-fixture', $5, $5, $6,
               'explicit derived grant', 'test-fixture')`,
      [decisionId, cellId, lineage.terms_version_id, lineage.review_evidence_id, AT, recheck],
    );
    await fixtures.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'fixture', $2)`,
      [decisionId, AT],
    );
    await fixtures.driver.exec('COMMIT');
  } catch (error) {
    await fixtures.driver.exec('ROLLBACK');
    throw error;
  }
}

function semanticBulkBytes(result: DatasetExportResult): string {
  const row = result.rows.find((candidate) => candidate.property === TARGET);
  if (row === undefined) throw new Error('derived deterministic-order export row missing');
  return JSON.stringify({
    sources: row.sources,
    evidencePublishers: result.evidence.map((evidence) => evidence.source_publisher),
    manifestPublishers: result.manifest.sources.map((source) => source.publisher),
  });
}
