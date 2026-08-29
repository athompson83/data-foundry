import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcquisitionProviderRegistry,
  FixtureAcquisitionProvider,
  InMemoryValidatorCache,
  SqlPolicySnapshotRecorder,
  unlimitedRateLimiter,
} from '@data-foundry/acquisition';
import { createPgliteDriver, type SqlDriver } from '@data-foundry/canonical-store';
import { migrate } from '../../../packages/canonical-store/test/support.js';
import {
  buildFixtureManifest,
  InMemoryArtifactStore,
  loadVerticalConfig,
  Pipeline,
  requireStoredAcquisitionTransportRights,
  type VerticalConfig,
} from '../src/index.js';

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

  it('ingests a reverse-declared multi-level graph with the exact dependency chain', async () => {
    const base = await loadVerticalConfig('hvac');
    const equipment = base.entities['equipment_model'];
    const config: VerticalConfig = {
      ...base,
      entities: {
        ...base.entities,
        equipment_model: {
          ...equipment,
          properties: [
            ...(equipment?.properties ?? []),
            {
              name: 'derived_capacity_index',
              value_type: 'number',
              unit: 'BTU/h',
              critical: false,
            },
          ],
        },
      },
      typedValues: {
        ...base.typedValues,
        // Deliberately reverse-declared: the grandchild precedes its parent.
        derived_properties: [
          {
            property: 'derived_capacity_index',
            from: 'nominal_tonnage',
            only_if_absent: true,
          },
          {
            property: 'nominal_tonnage',
            from: 'cooling_capacity_btu',
            round_to: 1,
            only_if_absent: true,
          },
        ],
      },
    };
    const artifactStore = new InMemoryArtifactStore();
    const overrides = {
      'acme-hvac-catalog': JSON.stringify({
        products: [{
          sku: 'ACS-ROUND350',
          model: 'ROUND350',
          series: 'Rounding proof',
          brand: 'Acme Climate Systems',
          cooling_capacity_btuh: 35_000,
        }],
      }),
    };
    const bootstrap = await pipelineForConfig(
      config,
      artifactStore,
      'task-8-multilevel-bootstrap',
      overrides,
    );
    await bootstrap.runSource('acme-hvac-catalog');
    const [source] = await driver.query<{ id: string; rights_publisher_id: string | null }>(
      `SELECT id, rights_publisher_id FROM sources
        WHERE domain = 'catalog.acme-climate.example.com'`,
    );
    if (source?.rights_publisher_id === null) await seedIngestionRights(source.id);
    const pipeline = await pipelineForConfig(
      config,
      artifactStore,
      'task-8-multilevel',
      overrides,
    );
    const result = await pipeline.runSource('acme-hvac-catalog');
    expect(result.error).toBeNull();

    const rows = await driver.query<{
      id: string;
      entity_id: string;
      property: string;
      output_kind: string;
      normalized_value: unknown;
    }>(
      `SELECT id, entity_id, property, output_kind, normalized_value
         FROM facts
        WHERE property IN ('cooling_capacity_btu', 'nominal_tonnage', 'derived_capacity_index')
          AND valid_to IS NULL
        ORDER BY entity_id, property, output_kind`,
    );
    const grandchildren = rows.filter((row) => row.property === 'derived_capacity_index');
    expect(grandchildren).toHaveLength(1);
    for (const grandchild of grandchildren) {
      expect(grandchild.output_kind).toBe('DERIVED_METRIC');
      // 35,000 BTU/h -> 2.916... ton -> rounded parent 2.9 ton -> 34,800 BTU/h.
      // Recomputing the grandchild from the root bytes would incorrectly yield 35,000.
      expect(grandchild.normalized_value).toBe(34_800);
      const [grandchildEdge] = await driver.query<{
        input_fact_id: string;
        input_property: string;
        transformation_ref: string;
      }>(
        `SELECT dependency.input_fact_id, input.property AS input_property,
                dependency.transformation_ref
           FROM fact_dependencies dependency
           JOIN facts input ON input.id = dependency.input_fact_id
          WHERE dependency.derived_fact_id = $1`,
        [grandchild.id],
      );
      expect(grandchildEdge).toMatchObject({
        input_property: 'nominal_tonnage',
        transformation_ref: 'hvac.derived_capacity_index.from.nominal_tonnage.v1',
      });
      if (grandchildEdge === undefined) throw new Error('grandchild dependency missing');
      const [parentEdge] = await driver.query<{
        input_property: string;
        transformation_ref: string;
      }>(
        `SELECT input.property AS input_property, dependency.transformation_ref
           FROM fact_dependencies dependency
           JOIN facts input ON input.id = dependency.input_fact_id
          WHERE dependency.derived_fact_id = $1`,
        [grandchildEdge.input_fact_id],
      );
      expect(parentEdge).toEqual({
        input_property: 'cooling_capacity_btu',
        transformation_ref: 'hvac.nominal_tonnage.from.cooling_capacity_btu.v1',
      });
      const parent = rows.find((row) => row.id === grandchildEdge?.input_fact_id);
      expect(parent?.normalized_value).toBe(2.9);
    }
  });
});

async function pipelineForConfig(
  config: VerticalConfig,
  artifactStore: InMemoryArtifactStore,
  runId: string,
  overrides?: Readonly<Record<string, string>>,
): Promise<Pipeline> {
  const { directory, bindings } = await buildFixtureManifest(
    config,
    overrides === undefined ? {} : { overrides },
  );
  const validatorCache = new InMemoryValidatorCache();
  const now = '2026-08-15T12:00:00.000Z' as never;
  const clock = {
    now: () => Date.parse(now),
    nowIso: () => now,
    sleep: () => Promise.resolve(),
  };
  const provider = new FixtureAcquisitionProvider({
    deps: {
      registry: config.registry,
      artifactStore,
      policyRecorder: new SqlPolicySnapshotRecorder(driver),
      validatorCache,
      clock,
      rateLimiter: unlimitedRateLimiter,
      beforeTransport: ({ request, entry, asOf }) =>
        requireStoredAcquisitionTransportRights({
          driver,
          sourceId: request.sourceId,
          entry,
          asOf,
        }),
    },
    directory,
    manifest: { version: 1, entries: bindings.map((binding) => binding.entry) },
  });
  return new Pipeline({
    driver,
    config,
    providers: new AcquisitionProviderRegistry([provider]),
    artifactStore,
    fixtures: bindings,
    now,
    runId,
    validatorCache,
  });
}

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
