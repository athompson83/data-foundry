import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDriver, type SqlDriver } from '@data-foundry/canonical-store';
import { migrate } from '../../../packages/canonical-store/test/support.js';
import { InMemoryArtifactStore, Pipeline } from '../src/index.js';

let driver: SqlDriver;

beforeAll(async () => {
  driver = await createPgliteDriver({ trigram: false });
  await migrate(driver);
});

afterAll(async () => {
  await driver?.close();
});

describe('real ingestion fact output lineage', () => {
  it('uses normalized and derived writers according to compiled mapping kind', async () => {
    const artifactStore = new InMemoryArtifactStore();
    const initial = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'task-8-rights-bootstrap',
    });
    // The first fail-closed attempt synchronizes the registry source without
    // inventing a permission. This test then records explicit synthetic terms
    // and grants before exercising the ingestion writer.
    expect((await initial.runSource('acme-hvac-catalog')).error).toContain('PUBLISHER_UNMAPPED');
    const sourceRows = await driver.query<{ id: string }>(
      `SELECT id FROM sources WHERE domain = 'catalog.acme-climate.example.com'`,
    );
    await seedIngestionRights(sourceRows[0]?.id ?? '');

    const pipeline = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'task-8-output-kind',
    });
    const result = await pipeline.runSource('acme-hvac-catalog');
    expect(result.error).toBeNull();

    const rows = await driver.query<{ id: string; entity_id: string; property: string; output_kind: string }>(
      `SELECT id, entity_id, property, output_kind FROM facts
        WHERE property IN ('cooling_capacity_btu', 'nominal_tonnage')
        ORDER BY property`,
    );
    expect([...new Set(rows.map(({ property, output_kind }) => `${property}:${output_kind}`))]).toEqual([
      'cooling_capacity_btu:NORMALIZED_FACT',
      'nominal_tonnage:DERIVED_METRIC',
    ]);

    const dependencyRows = await driver.query<{
      derived_fact_id: string;
      input_fact_id: string;
      transformation_ref: string;
    }>(
      `SELECT derived_fact_id, input_fact_id, transformation_ref FROM fact_dependencies
        ORDER BY derived_fact_id`,
    );
    const derivedRows = rows.filter((row) => row.property === 'nominal_tonnage');
    expect(dependencyRows).toHaveLength(derivedRows.length);
    for (const derived of derivedRows) {
      const dependency = dependencyRows.find((row) => row.derived_fact_id === derived.id);
      const input = rows.find(
        (row) => row.entity_id === derived.entity_id && row.property === 'cooling_capacity_btu',
      );
      expect(dependency).toEqual({
        derived_fact_id: derived.id,
        input_fact_id: input?.id,
        transformation_ref: 'hvac.nominal_tonnage.from.cooling_capacity_btu.v1',
      });
    }
  });
});

async function seedIngestionRights(sourceId: string): Promise<void> {
  const publisherId = crypto.randomUUID();
  const termsEvidenceId = crypto.randomUUID();
  const reviewEvidenceId = crypto.randomUUID();
  const termsCellId = crypto.randomUUID();
  const termsVersionId = crypto.randomUUID();
  const effective = '2026-08-01T00:00:00.000Z';
  const recheck = '2027-08-01T00:00:00.000Z';
  await driver.query(
    `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
     VALUES ($1, 'task-8-ingest-publisher', 'Task 8 synthetic ingest publisher', 'ACTIVE')`,
    [publisherId],
  );
  await driver.query(
    `INSERT INTO rights_evidence_artifacts
       (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, 'TERMS', 'fixture://task-8/terms', 'fixture://task-8/terms.txt', $3,
             'text/plain', $5, 'test-fixture'),
            ($2, 'REVIEW_MEMO', 'fixture://task-8/review', 'fixture://task-8/review.txt', $4,
             'text/plain', $5, 'test-fixture')`,
    [termsEvidenceId, reviewEvidenceId, 'a'.repeat(64), 'b'.repeat(64), effective],
  );
  await driver.query(
    `UPDATE sources SET rights_publisher_id = $1,
       rights_publisher_mapping_evidence_artifact_id = $3,
       rights_publisher_mapping_reviewer_type = 'HUMAN',
       rights_publisher_mapping_reviewed_by = 'test-fixture',
       rights_publisher_mapping_reviewed_at = $4
     WHERE id = $2`,
    [publisherId, sourceId, reviewEvidenceId, effective],
  );
  await driver.query(
    `INSERT INTO rights_terms_cells (id, source_id, acquisition_route, created_by)
     VALUES ($1, $2, 'DIRECT_HTTP', 'test-fixture')`,
    [termsCellId, sourceId],
  );
  await driver.query(
    `INSERT INTO rights_terms_versions
       (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
        effective_from, recheck_at, created_by)
     VALUES ($1, $2, $3, $4, 'task-8-v1', $5, $6, 'test-fixture')`,
    [termsVersionId, termsCellId, termsEvidenceId, 'a'.repeat(64), effective, recheck],
  );
  await driver.query(
    `SELECT activate_rights_terms($1, 'HUMAN', 'test-fixture', 'task 8 fixture', $2)`,
    [termsVersionId, effective],
  );
  await driver.exec('BEGIN');
  for (const operation of ['ACQUIRE', 'STORE', 'CACHE', 'NORMALIZE', 'DERIVE']) {
    const cellId = crypto.randomUUID();
    const decisionId = crypto.randomUUID();
    await driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, operation, channel, created_by)
       VALUES ($1, $2, 'DIRECT_HTTP', $3, 'INTERNAL_PROCESSING', 'test-fixture')`,
      [cellId, sourceId, operation],
    );
    await driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
          rationale, created_by)
       VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED', 'HUMAN',
               'test-fixture', $5, $5, $6, 'explicit task 8 test grant', 'test-fixture')`,
      [decisionId, cellId, termsVersionId, reviewEvidenceId, effective, recheck],
    );
    await driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'task 8 fixture', $2)`,
      [decisionId, effective],
    );
  }
  await driver.exec('COMMIT');
}
