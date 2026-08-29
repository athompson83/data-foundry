import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcquisitionProviderRegistry,
  FixtureAcquisitionProvider,
  InMemoryValidatorCache,
  SqlPolicySnapshotRecorder,
  unlimitedRateLimiter,
} from '@data-foundry/acquisition';
import {
  createPgliteDriver,
  type SqlDriver,
  type SqlExecutor,
  type SqlParam,
  type SqlRow,
} from '@data-foundry/canonical-store';
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

  it('keeps resolution, aliases, judgments, and entity evidence on the transaction executor', async () => {
    await ensureIngestionRights();
    const guarded = transactionAffinityGuard(driver);
    const artifactStore = new InMemoryArtifactStore();
    const pipeline = await Pipeline.create({
      driver: guarded,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'transaction-affinity-success',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct('ACS-TXAFFINITY001', 'TXAFFINITY001')],
        }),
      },
    });

    const result = await pipeline.runSource('acme-hvac-catalog');

    expect(result.error).toBeNull();
    expect(result.records).toBe(1);
    const [persisted] = await driver.query<{ entity_id: string; evidence_count: number }>(
      `SELECT alias.entity_id, COUNT(evidence.entity_id)::int AS evidence_count
         FROM entity_aliases alias
         JOIN entity_evidence evidence ON evidence.entity_id = alias.entity_id
        WHERE alias.alias_type = 'model_number' AND alias.normalized_value = 'TXAFFINITY001'
        GROUP BY alias.entity_id`,
    );
    expect(persisted?.entity_id).toBeTruthy();
    expect(persisted?.evidence_count).toBeGreaterThan(0);
  });

  it('rolls back every resolution write when entity evidence persistence fails', async () => {
    await ensureIngestionRights();
    const guarded = transactionAffinityGuard(driver, {
      failTransactionSql: /INSERT INTO entity_evidence/,
    });
    const pipeline = await Pipeline.create({
      driver: guarded,
      verticalSlug: 'hvac',
      artifactStore: new InMemoryArtifactStore(),
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'transaction-affinity-rollback',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct('ACS-TXROLLBACK001', 'TXROLLBACK001')],
        }),
      },
    });

    const result = await pipeline.runSource('acme-hvac-catalog');

    expect(result.error).toContain('injected entity-evidence failure');
    const aliases = await driver.query(
      `SELECT entity_id FROM entity_aliases
        WHERE alias_type = 'model_number' AND normalized_value = 'TXROLLBACK001'`,
    );
    const entities = await driver.query(
      `SELECT id FROM entities WHERE canonical_slug = 'acme-climate-systems-txrollback001'`,
    );
    expect(aliases).toEqual([]);
    expect(entities).toEqual([]);
  });

  it('rolls back manufacturer writes when a record has no usable strong identifier', async () => {
    await ensureIngestionRights();
    const guarded = transactionAffinityGuard(driver);
    const pipeline = await Pipeline.create({
      driver: guarded,
      verticalSlug: 'hvac',
      artifactStore: new InMemoryArtifactStore(),
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'transaction-affinity-unresolved',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [
            {
              ...catalogProduct('---', '----'),
              brand: 'Borealis Thermal Works',
            },
          ],
        }),
      },
    });

    const result = await pipeline.runSource('acme-hvac-catalog');

    expect(result.error).toBeNull();
    expect(result.claims).toBe(0);
    const manufacturers = await driver.query(
      `SELECT id FROM entities
        WHERE entity_type = 'manufacturer' AND canonical_slug = 'borealis-thermal-works'`,
    );
    expect(manufacturers).toEqual([]);
  });
});

function catalogProduct(sku: string, model: string): Record<string, unknown> {
  return {
    sku,
    model,
    series: 'Transaction affinity probe',
    brand: 'Acme Climate Systems',
    category: 'Air Conditioner',
    cooling_capacity_btuh: 36_000,
    efficiency: { seer2: 14.5, eer2: 11.7 },
    refrigerant: 'R454B',
    electrical: '208/230-1-60',
    compressor_stages: 1,
    net_weight_lb: 187,
    lifecycle: { status: 'active', discontinued_on: null, replaced_by: null },
  };
}

function transactionAffinityGuard(
  delegate: SqlDriver,
  options: { readonly failTransactionSql?: RegExp } = {},
): SqlDriver {
  let transactionActive = false;
  return {
    label: `${delegate.label} (transaction-affinity guard)`,
    dialect: delegate.dialect,
    async exec(sql) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        throw new Error('raw transaction control bypassed SqlDriver.transaction()');
      }
      if (transactionActive) {
        throw new Error('exec escaped the active transaction executor');
      }
      await delegate.exec(sql);
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      if (transactionActive) {
        throw new Error('query escaped the active transaction executor');
      }
      return delegate.query<R>(sql, params);
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      if (transactionActive) {
        throw new Error('nested transaction escaped the active transaction executor');
      }
      return delegate.transaction(async (delegateTx) => {
        transactionActive = true;
        const tx: SqlExecutor = {
          async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
            if (options.failTransactionSql?.test(sql) === true) {
              throw new Error('injected entity-evidence failure');
            }
            return delegateTx.query<R>(sql, params);
          },
        };
        try {
          return await fn(tx);
        } finally {
          transactionActive = false;
        }
      });
    },
    async close() {
      // The owning test fixture closes the delegate exactly once.
    },
  };
}

async function ensureIngestionRights(): Promise<void> {
  let [source] = await driver.query<{ id: string; rights_publisher_id: string | null }>(
    `SELECT id, rights_publisher_id FROM sources
      WHERE domain = 'catalog.acme-climate.example.com'`,
  );
  if (source === undefined) {
    const bootstrap = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore: new InMemoryArtifactStore(),
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'transaction-affinity-rights-bootstrap',
    });
    await bootstrap.runSource('acme-hvac-catalog');
    [source] = await driver.query<{ id: string; rights_publisher_id: string | null }>(
      `SELECT id, rights_publisher_id FROM sources
        WHERE domain = 'catalog.acme-climate.example.com'`,
    );
  }
  if (source === undefined) throw new Error('bootstrap did not synchronize the synthetic source');
  if (source.rights_publisher_id === null) await seedIngestionRights(source.id);
}

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
      beforePersistence: ({ request, entry, asOf }) =>
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
