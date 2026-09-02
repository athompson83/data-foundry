import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  createExtractionRegistry,
  JsonExtractor,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
  type ExtractionProviderRegistry,
  type ExtractionSchema,
} from '@data-foundry/extraction';
import { createQueryModel, traverseRelationships } from '@data-foundry/query-model';
import { migrate } from '../../../packages/canonical-store/test/support.js';
import {
  buildFixtureManifest,
  buildFieldMetadata,
  InMemoryArtifactStore,
  loadVerticalConfig,
  Pipeline,
  requireStoredAcquisitionTransportRights,
  type VerticalConfig,
} from '../src/index.js';

let driver: SqlDriver;

beforeEach(async () => {
  driver = await createPgliteDriver({ trigram: false });
  await migrate(driver);
});

afterEach(async () => {
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

  it('records alias evidence only for identifiers that pass alias validation', async () => {
    await ensureIngestionRights();
    const pipeline = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore: new InMemoryArtifactStore(),
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'validated-alias-evidence',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct('ACS-ALIASPROOF001', 'AB')],
        }),
      },
    });

    const result = await pipeline.runSource('acme-hvac-catalog');

    expect(result.error).toBeNull();
    expect(result.records).toBe(1);
    expect(
      pipeline.diagnostics.some((entry) => entry.includes('alias model_number quarantined')),
    ).toBe(true);
    const rejectedAliases = await driver.query(
      `SELECT entity_id FROM entity_aliases
        WHERE alias_type = 'model_number' AND normalized_value = 'AB'`,
    );
    expect(rejectedAliases).toEqual([]);
    const evidence = await driver.query<{ locator_value: string }>(
      `SELECT evidence.locator_value
         FROM entity_aliases alias
         JOIN entity_evidence evidence ON evidence.entity_id = alias.entity_id
        WHERE alias.alias_type = 'manufacturer_sku'
          AND alias.normalized_value = 'ACS-ALIASPROOF001'
          AND evidence.contribution_role = 'ALIAS'
        ORDER BY evidence.locator_value`,
    );
    expect(evidence.map((row) => row.locator_value)).toEqual([
      '/products/0/series',
      '/products/0/sku',
    ]);
  });

  it('replaces stale evidence for a reused source record without deleting current valid lineage', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const sourceKey = 'ACS-REINGEST001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'reingest-lineage-first',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'REINGEST001')],
        }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const second = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-17T12:00:00.000Z' as never,
      runId: 'reingest-lineage-second',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'AB')],
        }),
      },
    });
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    const [sourceRecord] = await driver.query<{ id: string; artifact_id: string }>(
      `SELECT id, artifact_id FROM source_records WHERE source_record_key = $1 AND is_current`,
      [sourceKey],
    );
    expect(sourceRecord).toBeDefined();

    const aliasEvidence = await driver.query<{
      contribution_role: string;
      locator_value: string;
      artifact_id: string;
    }>(
      `SELECT contribution_role, locator_value, artifact_id
         FROM entity_evidence
        WHERE source_record_id = $1
        ORDER BY contribution_role, locator_value`,
      [sourceRecord?.id ?? 'missing-source-record'],
    );
    expect(aliasEvidence).not.toContainEqual(
      expect.objectContaining({ contribution_role: 'ALIAS', locator_value: '/products/0/model' }),
    );
    expect(aliasEvidence).toContainEqual(
      expect.objectContaining({ contribution_role: 'ALIAS', locator_value: '/products/0/sku' }),
    );

    const survivingEvidence = await driver.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM entity_evidence WHERE source_record_id = $1
       UNION ALL
       SELECT artifact_id FROM fact_evidence WHERE source_record_id = $1
       UNION ALL
       SELECT artifact_id FROM relationship_evidence WHERE source_record_id = $1`,
      [sourceRecord?.id ?? 'missing-source-record'],
    );
    expect(survivingEvidence.length).toBeGreaterThan(0);
    expect(new Set(survivingEvidence.map((row) => row.artifact_id))).toEqual(
      new Set([sourceRecord?.artifact_id]),
    );
  });

  it('retires records omitted by an explicit complete snapshot and preserves omission evidence', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const retainedKey = 'ACS-SNAPSHOT-RETAINED-001';
    const omittedKey = 'ACS-SNAPSHOT-OMITTED-001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-18T12:00:00.000Z' as never,
      runId: 'full-snapshot-first',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [
            catalogProduct(retainedKey, 'SNAPSHOTRETAINED001'),
            catalogProduct(omittedKey, 'SNAPSHOTOMITTED001'),
          ],
        }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const omittedEntityId = await currentResolvedEntityId(omittedKey, 'equipment_model');
    const [omittedRevision] = await currentSourceRecordRows(omittedKey);
    if (omittedRevision === undefined) throw new Error('omitted snapshot revision missing');

    const second = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-19T12:00:00.000Z' as never,
      runId: 'full-snapshot-second',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(retainedKey, 'SNAPSHOTRETAINED001')],
        }),
      },
    });
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    expect(await currentSourceRecordRows(omittedKey)).toEqual([]);
    expect(await driver.query(
      `SELECT id FROM current_entity_aliases WHERE entity_id = $1`,
      [omittedEntityId],
    )).toEqual([]);
    expect(await publicWebEntity(
      second,
      omittedEntityId,
      '2026-08-19T12:00:00.000Z',
    )).toBeNull();
    const retirement = await driver.query<{
      source_record_id: string;
      source_stream: string;
      artifact_count: number;
    }>(
      `SELECT retirement.source_record_id, retirement.source_stream,
              COUNT(retirement.artifact_id)::int AS artifact_count
         FROM source_record_snapshot_retirements retirement
        WHERE retirement.source_record_id = $1
        GROUP BY retirement.source_record_id, retirement.source_stream`,
      [omittedRevision.id],
    );
    expect(retirement).toEqual([{
      source_record_id: omittedRevision.id,
      source_stream: 'products',
      artifact_count: 1,
    }]);
  });

  it('does not let a delayed older complete snapshot supersede newer stream membership', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const retainedKey = 'ACS-SNAPSHOT-WATERMARK-RETAINED-001';
    const removedKey = 'ACS-SNAPSHOT-WATERMARK-REMOVED-001';
    const run = async (
      now: string,
      runId: string,
      products: readonly Record<string, unknown>[],
    ) => {
      const pipeline = await Pipeline.create({
        driver,
        verticalSlug: 'hvac',
        artifactStore,
        now: now as never,
        runId,
        fixtureOverrides: {
          'acme-hvac-catalog': JSON.stringify({ products }),
        },
      });
      expect((await pipeline.runSource('acme-hvac-catalog')).error).toBeNull();
    };

    await run('2026-08-23T12:00:00.000Z', 'snapshot-watermark-baseline', [
      catalogProduct(retainedKey, 'SNAPSHOTWATERMARKRETAINED001'),
      catalogProduct(removedKey, 'SNAPSHOTWATERMARKREMOVED001'),
    ]);
    await run('2026-08-25T12:00:00.000Z', 'snapshot-watermark-newer', [
      catalogProduct(retainedKey, 'SNAPSHOTWATERMARKRETAINED001'),
    ]);
    expect(await currentSourceRecordRows(removedKey)).toEqual([]);

    await run('2026-08-24T12:00:00.000Z', 'snapshot-watermark-delayed-older', [
      catalogProduct(retainedKey, 'SNAPSHOTWATERMARKRETAINED001'),
      catalogProduct(removedKey, 'SNAPSHOTWATERMARKREMOVED001'),
    ]);

    expect(await currentSourceRecordRows(removedKey)).toEqual([]);
    expect(await currentSourceRecordRows(removedKey, false)).toHaveLength(1);
    expect(await driver.query(
      `SELECT acceptance.id FROM source_stream_snapshot_acceptances acceptance
        JOIN sources source ON source.id = acceptance.source_id
       WHERE source.domain = 'catalog.acme-climate.example.com'
         AND acceptance.source_stream = 'products'
         AND acceptance.observed_at = '2026-08-24T12:00:00.000Z'`,
    )).toEqual([]);
  });

  it('uses the snapshot digest as a deterministic equal-time acceptance tie-break', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const firstKey = 'ACS-SNAPSHOT-TIE-FIRST-001';
    const secondKey = 'ACS-SNAPSHOT-TIE-SECOND-001';
    const candidates = [
      { key: firstKey, model: 'SNAPSHOTTIEFIRST001' },
      { key: secondKey, model: 'SNAPSHOTTIESECOND001' },
    ] as const;
    const run = async (now: string, runId: string, candidate: (typeof candidates)[number]) => {
      const pipeline = await Pipeline.create({
        driver,
        verticalSlug: 'hvac',
        artifactStore,
        now: now as never,
        runId,
        fixtureOverrides: {
          'acme-hvac-catalog': JSON.stringify({
            products: [catalogProduct(candidate.key, candidate.model)],
          }),
        },
      });
      expect((await pipeline.runSource('acme-hvac-catalog')).error).toBeNull();
    };
    const digestAt = async (observedAt: string) => {
      const [row] = await driver.query<{ snapshot_digest: string }>(
        `SELECT acceptance.snapshot_digest
           FROM source_stream_snapshot_acceptances acceptance
           JOIN sources source ON source.id = acceptance.source_id
          WHERE source.domain = 'catalog.acme-climate.example.com'
            AND acceptance.source_stream = 'products'
            AND acceptance.observed_at = $1
          ORDER BY acceptance.snapshot_digest COLLATE "C" DESC
          LIMIT 1`,
        [observedAt],
      );
      if (row === undefined) throw new Error(`snapshot acceptance missing at ${observedAt}`);
      return row.snapshot_digest;
    };

    await run('2026-08-26T12:00:00.000Z', 'snapshot-tie-fingerprint-first', candidates[0]);
    const firstDigest = await digestAt('2026-08-26T12:00:00.000Z');
    await run('2026-08-27T12:00:00.000Z', 'snapshot-tie-fingerprint-second', candidates[1]);
    const secondDigest = await digestAt('2026-08-27T12:00:00.000Z');
    expect(firstDigest).not.toBe(secondDigest);
    const [low, high] = firstDigest < secondDigest
      ? [candidates[0], candidates[1]]
      : [candidates[1], candidates[0]];

    await run('2026-08-28T12:00:00.000Z', 'snapshot-tie-high-first', high);
    await run('2026-08-28T12:00:00.000Z', 'snapshot-tie-low-second', low);
    expect(await currentSourceRecordRows(high.key)).toHaveLength(1);
    expect(await currentSourceRecordRows(low.key)).toEqual([]);

    await run('2026-08-29T12:00:00.000Z', 'snapshot-tie-low-first', low);
    await run('2026-08-29T12:00:00.000Z', 'snapshot-tie-high-second', high);
    expect(await currentSourceRecordRows(high.key)).toHaveLength(1);
    expect(await currentSourceRecordRows(low.key)).toEqual([]);
  });

  it('ignores a stale full stream while still applying an incremental sibling stream', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const mixed = {
      ...base,
      sourceMappings: structuredClone(base.sourceMappings),
    } as VerticalConfig & { sourceMappings: any };
    const mapping = mixed.sourceMappings.sources.find(
      (candidate: any) => candidate.source_key === 'acme-hvac-catalog',
    );
    const incremental = structuredClone(mapping.records[0]);
    incremental.stream = 'updates';
    incremental.refresh_mode = 'incremental';
    incremental.record_path = '/updates';
    mapping.records.push(incremental);

    const artifactStore = new InMemoryArtifactStore();
    const retainedKey = 'ACS-MIXED-FULL-RETAINED-001';
    const removedKey = 'ACS-MIXED-FULL-REMOVED-001';
    const incrementalKey = 'ACS-MIXED-INCREMENTAL-001';
    const run = async (
      now: string,
      runId: string,
      products: readonly Record<string, unknown>[],
      updateModel: string,
    ) => {
      const pipeline = await pipelineForConfig(
        mixed,
        artifactStore,
        runId,
        { 'acme-hvac-catalog': JSON.stringify({
          products,
          updates: [catalogProduct(incrementalKey, updateModel)],
        }) },
        undefined,
        now,
      );
      expect((await pipeline.runSource('acme-hvac-catalog')).error).toBeNull();
    };

    await run('2026-09-01T12:00:00.000Z', 'mixed-stream-baseline', [
      catalogProduct(retainedKey, 'MIXEDFULLRETAINED001'),
      catalogProduct(removedKey, 'MIXEDFULLREMOVED001'),
    ], 'MIXEDINCREMENTAL001');
    await run('2026-09-03T12:00:00.000Z', 'mixed-stream-newer', [
      catalogProduct(retainedKey, 'MIXEDFULLRETAINED001'),
    ], 'MIXEDINCREMENTAL001');
    expect(await currentSourceRecordRows(removedKey)).toEqual([]);
    const [incrementalBeforeDelay] = await currentSourceRecordRows(incrementalKey);
    if (incrementalBeforeDelay === undefined) throw new Error('incremental control record missing');

    await run('2026-09-02T12:00:00.000Z', 'mixed-stream-delayed', [
      catalogProduct(retainedKey, 'MIXEDFULLRETAINED001'),
      catalogProduct(removedKey, 'MIXEDFULLREMOVED001'),
    ], 'MIXEDINCREMENTAL002');

    expect(await currentSourceRecordRows(removedKey)).toEqual([]);
    const [incrementalAfterDelay] = await currentSourceRecordRows(incrementalKey);
    expect(incrementalAfterDelay?.id).not.toBe(incrementalBeforeDelay.id);
  });

  it('does not treat a missing record selector as an authoritative empty snapshot', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const firstKey = 'ACS-SNAPSHOT-SHAPE-A-001';
    const secondKey = 'ACS-SNAPSHOT-SHAPE-B-001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-18T12:00:00.000Z' as never,
      runId: 'full-snapshot-shape-first',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({ products: [
          catalogProduct(firstKey, 'SNAPSHOTSHAPEA001'),
          catalogProduct(secondKey, 'SNAPSHOTSHAPEB001'),
        ] }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const malformed = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-19T12:00:00.000Z' as never,
      runId: 'full-snapshot-shape-malformed',
      fixtureOverrides: { 'acme-hvac-catalog': JSON.stringify({ unexpected: [] }) },
    });
    const malformedResult = await malformed.runSource('acme-hvac-catalog');
    expect(malformedResult.error).not.toBeNull();
    expect(String(malformedResult.error))
      .toMatch(/record selector.*not found|not found.*record selector/i);
    expect(await currentSourceRecordRows(firstKey)).toHaveLength(1);
    expect(await currentSourceRecordRows(secondKey)).toHaveLength(1);

    const explicitEmpty = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-20T12:00:00.000Z' as never,
      runId: 'full-snapshot-shape-explicit-empty',
      fixtureOverrides: { 'acme-hvac-catalog': JSON.stringify({ products: [] }) },
    });
    expect((await explicitEmpty.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await currentSourceRecordRows(firstKey)).toEqual([]);
    expect(await currentSourceRecordRows(secondKey)).toEqual([]);
  });

  it('does not let a partially rejected record set authorize snapshot omissions', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const firstKey = 'ACS-SNAPSHOT-KEY-A-001';
    const secondKey = 'ACS-SNAPSHOT-KEY-B-001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-21T12:00:00.000Z' as never,
      runId: 'full-snapshot-key-first',
      fixtureOverrides: { 'acme-hvac-catalog': JSON.stringify({ products: [
        catalogProduct(firstKey, 'SNAPSHOTKEYA001'),
        catalogProduct(secondKey, 'SNAPSHOTKEYB001'),
      ] }) },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const partial = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-22T12:00:00.000Z' as never,
      runId: 'full-snapshot-key-partial',
      fixtureOverrides: { 'acme-hvac-catalog': JSON.stringify({ products: [
        catalogProduct(firstKey, 'SNAPSHOTKEYA001'),
        { unexpected: true },
      ] }) },
    });
    const partialResult = await partial.runSource('acme-hvac-catalog');
    expect(partialResult.error).not.toBeNull();
    expect(String(partialResult.error)).toMatch(/record key.*incomplete|incomplete.*record key/i);
    expect(await currentSourceRecordRows(firstKey)).toHaveLength(1);
    expect(await currentSourceRecordRows(secondKey)).toHaveLength(1);
  });

  it('refuses a mapping stream rename while the old stream still owns current membership', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const artifactStore = new InMemoryArtifactStore();
    const firstKey = 'ACS-STREAM-RENAME-A-001';
    const secondKey = 'ACS-STREAM-RENAME-B-001';
    const first = await pipelineForConfig(
      base,
      artifactStore,
      'stream-rename-first',
      { 'acme-hvac-catalog': JSON.stringify({ products: [
        catalogProduct(firstKey, 'STREAMRENAMEA001'),
        catalogProduct(secondKey, 'STREAMRENAMEB001'),
      ] }) },
    );
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const renamed = {
      ...base,
      sourceMappings: structuredClone(base.sourceMappings),
    } as VerticalConfig & { sourceMappings: any };
    const mapping = renamed.sourceMappings.sources.find(
      (candidate: any) => candidate.source_key === 'acme-hvac-catalog',
    );
    mapping.records[0].stream = 'products_v2';
    const second = await pipelineForConfig(
      renamed,
      artifactStore,
      'stream-rename-second',
      { 'acme-hvac-catalog': JSON.stringify({
        products: [catalogProduct(firstKey, 'STREAMRENAMEA001')],
      }) },
    );
    const renamedResult = await second.runSource('acme-hvac-catalog');
    expect(renamedResult.error).not.toBeNull();
    expect(String(renamedResult.error)).toMatch(/stream.*transition|required.*stream/i);
    expect(await driver.query<{ source_stream: string }>(
      `SELECT source_stream FROM source_records
        WHERE source_record_key IN ($1, $2) AND is_current
        ORDER BY source_record_key`,
      [firstKey, secondKey],
    )).toEqual([{ source_stream: 'products' }, { source_stream: 'products' }]);
  });

  it('does not retire absent records from a stream declared incremental', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const incremental = {
      ...base,
      sourceMappings: structuredClone(base.sourceMappings),
    } as VerticalConfig & { sourceMappings: any };
    const mapping = incremental.sourceMappings.sources.find(
      (candidate: any) => candidate.source_key === 'acme-hvac-catalog',
    );
    mapping.records[0].refresh_mode = 'incremental';
    const artifactStore = new InMemoryArtifactStore();
    const retainedKey = 'ACS-INCREMENTAL-RETAINED-001';
    const absentKey = 'ACS-INCREMENTAL-ABSENT-001';
    const first = await pipelineForConfig(
      incremental,
      artifactStore,
      'incremental-first',
      {
        'acme-hvac-catalog': JSON.stringify({ products: [
          catalogProduct(retainedKey, 'INCREMENTALRETAINED001'),
          catalogProduct(absentKey, 'INCREMENTALABSENT001'),
        ] }),
      },
    );
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const [original] = await currentSourceRecordRows(absentKey);
    if (original === undefined) throw new Error('incremental control record missing');

    const second = await pipelineForConfig(
      incremental,
      artifactStore,
      'incremental-second',
      {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(retainedKey, 'INCREMENTALRETAINED001')],
        }),
      },
    );
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await currentSourceRecordRows(absentKey)).toEqual([original]);
    expect(await driver.query(
      `SELECT id FROM source_record_snapshot_retirements WHERE source_record_id = $1`,
      [original.id],
    )).toEqual([]);
  });

  it('retires a removed source alias before it can resolve a later record', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const sourceKey = 'ACS-ALIAS-CURRENCY-001';
    const model = 'ALIASCURRENCY001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'alias-currency-valid',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, model)],
        }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const originalEntityId = await currentResolvedEntityId(sourceKey, 'equipment_model');

    const refresh = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'alias-currency-invalid-refresh',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'AB')],
        }),
      },
    });
    const refreshResult = await refresh.runSource('acme-hvac-catalog');
    expect(refreshResult.error).toBeNull();

    const [vertical] = await driver.query<{ id: string }>(
      `SELECT id FROM verticals WHERE slug = 'hvac'`,
    );
    if (vertical === undefined) throw new Error('HVAC vertical missing');
    const historical = await driver.query<{ id: string }>(
      `SELECT id FROM entity_aliases
        WHERE entity_id = $1 AND alias_type = 'model_number' AND normalized_value = $2`,
      [originalEntityId, model],
    );
    const current = await driver.query<{ id: string }>(
      `SELECT id FROM current_entity_aliases
        WHERE entity_id = $1 AND alias_type = 'model_number' AND normalized_value = $2`,
      [originalEntityId, model],
    );
    expect(historical).toHaveLength(1);
    expect(current).toEqual([]);
    expect((await refresh.store.listAliases(originalEntityId as never)).map((alias) => alias.normalized_value))
      .not.toContain(model);
    expect(await refresh.store.lookupByAlias({
      vertical_id: vertical.id as never,
      entity_type: 'equipment_model' as never,
      alias_type: 'model_number' as never,
      values: [model],
    })).toEqual([]);
    const publicEntity = await publicWebEntity(
      refresh,
      originalEntityId,
      '2026-08-16T12:00:00.000Z',
    );
    expect(publicEntity).not.toBeNull();
    expect(publicEntity?.entity.canonical_name).not.toContain(model);

    const laterKey = 'ACS-ALIAS-CURRENCY-LATER-001';
    const later = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-17T12:00:00.000Z' as never,
      runId: 'alias-currency-later-record',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(laterKey, model)],
        }),
      },
    });
    expect((await later.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await currentResolvedEntityId(laterKey, 'equipment_model')).not.toBe(originalEntityId);
  });

  it('supersedes identical bytes when the resolved entity target changes, then keeps the new target replay a no-op', async () => {
    await ensureIngestionRights();
    const model = 'ENTITYTARGETDRIFT001';
    const sourceKey = '--ENTITY-TARGET-DRIFT-001--';
    const firstTarget = await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: model,
      slug: 'entity-target-drift-first',
    });
    const artifactStore = new InMemoryArtifactStore();
    const fixtureBody = JSON.stringify({
      products: [catalogProduct(sourceKey, model)],
    });
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'entity-target-drift-first',
      fixtureOverrides: { 'acme-hvac-catalog': fixtureBody },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await currentResolvedEntityId(sourceKey, 'equipment_model')).toBe(firstTarget.entityId);
    const [firstRevision] = await currentSourceRecordRows(sourceKey);
    if (firstRevision === undefined) throw new Error('first entity-target source record missing');

    await retireAlias(firstTarget.aliasId);
    const secondTarget = await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: model,
      slug: 'entity-target-drift-second',
    });
    const second = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'entity-target-drift-second',
      fixtureOverrides: { 'acme-hvac-catalog': fixtureBody },
    });
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    const afterDrift = await sourceRecordTargetSnapshot(sourceKey, 'equipment_model');
    expect(afterDrift.revisions).toHaveLength(2);
    expect(afterDrift.currentSourceRecordId).not.toBe(firstRevision.id);
    expect(afterDrift.currentEntityIds).toEqual([secondTarget.entityId]);
    expect(afterDrift.historicalTargets).toEqual([
      { entity_id: firstTarget.entityId, is_current: false },
      { entity_id: secondTarget.entityId, is_current: true },
    ]);

    const replay = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-17T12:00:00.000Z' as never,
      runId: 'entity-target-drift-exact-replay',
      fixtureOverrides: { 'acme-hvac-catalog': fixtureBody },
    });
    expect((await replay.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await sourceRecordTargetSnapshot(sourceKey, 'equipment_model')).toEqual(afterDrift);
  });

  it('supersedes identical bytes when publisher aliases resolve the manufacturer to a new target', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const sourceKey = '--MANUFACTURER-TARGET-DRIFT-001--';
    const fixtureBody = JSON.stringify({
      products: [catalogProduct(sourceKey, 'MANUFACTURERTARGET001')],
    });
    const artifactStore = new InMemoryArtifactStore();
    const first = await pipelineForConfig(
      base,
      artifactStore,
      'manufacturer-target-drift-first',
      { 'acme-hvac-catalog': fixtureBody },
    );
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const firstManufacturerId = await currentResolvedEntityId(sourceKey, 'manufacturer');

    const changedConfig: VerticalConfig = {
      ...base,
      publisherAliases: base.publisherAliases.map((publisher) =>
        publisher.key === 'acme-climate-systems'
          ? { ...publisher, canonicalName: 'Acme Target Drift Manufacturing' }
          : publisher,
      ),
    };
    const second = await pipelineForConfig(
      changedConfig,
      artifactStore,
      'manufacturer-target-drift-second',
      { 'acme-hvac-catalog': fixtureBody },
      undefined,
      '2026-08-16T12:00:00.000Z',
    );
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    const snapshot = await sourceRecordTargetSnapshot(sourceKey, 'manufacturer');
    expect(snapshot.revisions).toHaveLength(2);
    expect(snapshot.currentEntityIds).toHaveLength(1);
    expect(snapshot.currentEntityIds[0]).not.toBe(firstManufacturerId);
    expect(snapshot.historicalTargets).toEqual([
      { entity_id: firstManufacturerId, is_current: false },
      { entity_id: snapshot.currentEntityIds[0], is_current: true },
    ]);
  });

  it('supersedes identical bytes when a relationship alias endpoint resolves to a new target', async () => {
    await ensureIngestionRights();
    const endpointAlias = 'RELATIONENDPOINT001';
    const firstTarget = await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: endpointAlias,
      slug: 'relationship-endpoint-first',
    });
    const sourceKey = 'ACS-RELATIONSHIP-TARGET-DRIFT-001';
    const fixtureBody = JSON.stringify({
      products: [{
        ...catalogProduct(sourceKey, 'RELATIONSHIPDRIFT001'),
        lifecycle: {
          status: 'discontinued',
          discontinued_on: '2026-08-01',
          replaced_by: endpointAlias,
        },
      }],
    });
    const artifactStore = new InMemoryArtifactStore();
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'relationship-target-drift-first',
      fixtureOverrides: { 'acme-hvac-catalog': fixtureBody },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    expect(await currentRelationshipTargets(sourceKey, 'supersedes')).toEqual([firstTarget.entityId]);

    await retireAlias(firstTarget.aliasId);
    const secondTarget = await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: endpointAlias,
      slug: 'relationship-endpoint-second',
    });
    const second = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'relationship-target-drift-second',
      fixtureOverrides: { 'acme-hvac-catalog': fixtureBody },
    });
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    const revisions = await currentSourceRecordRows(sourceKey, false);
    expect(revisions).toHaveLength(2);
    expect(await currentRelationshipTargets(sourceKey, 'supersedes')).toEqual([secondTarget.entityId]);
    const selfEntityId = await currentResolvedEntityId(sourceKey, 'equipment_model');
    const history = await driver.query<{
      id: string;
      is_current: boolean;
      status: string;
      subject_entity_id: string;
    }>(
      `SELECT relationship.id, record.is_current, relationship.status, relationship.subject_entity_id
         FROM relationship_evidence evidence
         JOIN source_records record ON record.id = evidence.source_record_id
         JOIN relationships relationship ON relationship.id = evidence.relationship_id
        WHERE record.source_record_key = $1 AND relationship.predicate = 'supersedes'
        ORDER BY record.is_current, relationship.subject_entity_id`,
      [sourceKey],
    );
    expect(history).toEqual([
      expect.objectContaining({
        is_current: false,
        status: 'ACTIVE',
        subject_entity_id: firstTarget.entityId,
      }),
      expect.objectContaining({
        is_current: true,
        status: 'ACTIVE',
        subject_entity_id: secondTarget.entityId,
      }),
    ]);

    const oldRelationshipId = history[0]?.id;
    const newRelationshipId = history[1]?.id;
    if (oldRelationshipId === undefined || newRelationshipId === undefined) {
      throw new Error('relationship drift history missing');
    }
    expect((await second.store.listRelationships(selfEntityId as never, {
      predicate: 'supersedes' as never,
    })).map((relationship) => relationship.id)).toEqual([newRelationshipId]);
    expect((await traverseRelationships(second.store, {
      entity_id: selfEntityId as never,
      predicate: 'supersedes' as never,
      require_publishable_rights: false,
    })).edges.map((edge) => edge.relationship.id)).toEqual([newRelationshipId]);

    // A second, still-current source-record contribution must be sufficient to
    // keep the shared relationship visible after the original record expires.
    const [anchor] = await driver.query<{
      source_id: string;
      artifact_id: string;
      extraction_confidence: number;
      extractor_version: string;
    }>(
      `SELECT source_id, artifact_id, extraction_confidence, extractor_version
         FROM source_records
        WHERE source_record_key = $1 AND is_current`,
      [sourceKey],
    );
    if (anchor === undefined) throw new Error('relationship contribution anchor missing');
    const sharedRecord = await second.store.recordSourceRecord({
      source_id: anchor.source_id as never,
      artifact_id: anchor.artifact_id as never,
      source_record_key: `${sourceKey}:shared-contributor`,
      source_stream: 'products' as never,
      entity_type: 'equipment_model' as never,
      raw_payload: { relationship: 'shared-current-contribution' },
      normalized_payload: null,
      extraction_confidence: anchor.extraction_confidence as never,
      extractor_version: anchor.extractor_version,
    });
    await driver.query(
      `INSERT INTO relationship_evidence
         (relationship_id, artifact_id, source_record_id, source_value,
          locator_type, locator_value, observed_at)
       VALUES ($1, $2, $3, $4, 'JSON_POINTER', '/shared_relationship', $5)`,
      [
        oldRelationshipId,
        anchor.artifact_id,
        sharedRecord.id,
        endpointAlias,
        '2026-08-16T12:00:00.000Z',
      ],
    );
    expect((await second.store.listRelationships(selfEntityId as never, {
      predicate: 'supersedes' as never,
    })).map((relationship) => relationship.id).sort()).toEqual(
      [newRelationshipId, oldRelationshipId].sort(),
    );
    expect((await traverseRelationships(second.store, {
      entity_id: selfEntityId as never,
      predicate: 'supersedes' as never,
      require_publishable_rights: false,
    })).edges.map((edge) => edge.relationship.id).sort()).toEqual(
      [newRelationshipId, oldRelationshipId].sort(),
    );
  });

  it('refuses an ambiguous relationship alias endpoint instead of choosing the oldest entity', async () => {
    await ensureIngestionRights();
    const endpointAlias = 'AMBIGUOUSRELATION001';
    await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: endpointAlias,
      slug: 'ambiguous-relationship-first',
    });
    await seedCuratedEquipmentAlias({
      aliasType: 'model_number',
      aliasValue: endpointAlias,
      slug: 'ambiguous-relationship-second',
    });
    const sourceKey = 'ACS-AMBIGUOUS-RELATIONSHIP-001';
    const pipeline = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore: new InMemoryArtifactStore(),
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'ambiguous-relationship-endpoint',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [{
            ...catalogProduct(sourceKey, 'AMBIGUOUSRELATIONPRODUCT001'),
            lifecycle: {
              status: 'discontinued',
              discontinued_on: '2026-08-01',
              replaced_by: endpointAlias,
            },
          }],
        }),
      },
    });

    const result = await pipeline.runSource('acme-hvac-catalog');
    expect(result.error).toBeNull();
    expect(await currentRelationshipTargets(sourceKey, 'supersedes')).toEqual([]);
    expect(result.diagnostics.join('\n')).toMatch(/ambiguous.*relationship|relationship.*ambiguous/i);
  });

  it('reconciles an identifier-less refresh, retires its old source claims, and rolls back manufacturer creation', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const sourceKey = 'ACS-NO-STRONG-REFRESH-001';
    const model = 'NOSTRONGREFRESH001';
    const rawBrand = 'Refresh Phantom Manufacturer Input';
    const fixtureBody = JSON.stringify({
      products: [{
        ...catalogProduct(sourceKey, model),
        brand: rawBrand,
        invalid_sku: '--',
        invalid_model: 'AB',
      }],
    });
    const artifactStore = new InMemoryArtifactStore();
    const first = await pipelineForConfig(
      base,
      artifactStore,
      'no-strong-refresh-first',
      { 'acme-hvac-catalog': fixtureBody },
    );
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const originalEntityId = await currentResolvedEntityId(sourceKey, 'equipment_model');
    const originalEntity = await first.store.getEntityById(originalEntityId as never);
    if (originalEntity === null) throw new Error('original no-strong entity missing');
    const [originalRecord] = await currentSourceRecordRows(sourceKey);
    if (originalRecord === undefined) throw new Error('original no-strong source record missing');

    const changedConfig: VerticalConfig = {
      ...base,
      publisherAliases: [
        ...base.publisherAliases,
        {
          key: 'refresh-phantom-manufacturer',
          canonicalName: 'Refresh Phantom Manufacturer',
          aliases: [rawBrand],
        },
      ],
      sourceMappings: remapCatalogAliases(base, {
        manufacturer_sku: '/invalid_sku',
        model_number: '/invalid_model',
      }),
    };
    const refresh = await pipelineForConfig(
      changedConfig,
      artifactStore,
      'no-strong-refresh-second',
      { 'acme-hvac-catalog': fixtureBody },
      undefined,
      '2026-08-16T12:00:00.000Z',
    );
    const result = await refresh.runSource('acme-hvac-catalog');
    expect(result.error).toBeNull();
    expect(result.records).toBe(1);
    expect(result.claims).toBe(0);

    const revisions = await currentSourceRecordRows(sourceKey, false);
    expect(revisions).toHaveLength(2);
    expect(revisions.filter((record) => record.is_current)).toEqual([
      expect.objectContaining({ revision_state: 'FINALIZED' }),
    ]);
    expect(revisions.find((record) => record.is_current)?.id).not.toBe(originalRecord.id);
    const currentClaims = await driver.query<{ id: string }>(
      `SELECT claim.id
         FROM entity_alias_claims claim
         JOIN source_records record ON record.id = claim.source_record_id
        WHERE record.source_record_key = $1 AND record.is_current`,
      [sourceKey],
    );
    const historicalClaims = await driver.query<{ id: string }>(
      `SELECT claim.id
         FROM entity_alias_claims claim
         JOIN source_records record ON record.id = claim.source_record_id
        WHERE record.source_record_key = $1`,
      [sourceKey],
    );
    expect(currentClaims).toEqual([]);
    expect(historicalClaims.length).toBeGreaterThanOrEqual(2);
    expect(await driver.query(
      `SELECT id FROM current_entity_aliases
        WHERE entity_id = $1 AND alias_type IN ('manufacturer_sku', 'model_number')`,
      [originalEntityId],
    )).toEqual([]);
    expect(await publicWebEntity(
      refresh,
      originalEntityId,
      '2026-08-15T12:00:00.000Z',
    )).toBeNull();
    expect(await refresh.store.getEntityById(originalEntityId as never)).toEqual(
      expect.objectContaining({
        id: originalEntityId,
        canonical_slug: originalEntity.canonical_slug,
      }),
    );
    expect(await driver.query<{ normalized_value: string }>(
      `SELECT normalized_value FROM entity_aliases
        WHERE entity_id = $1 AND alias_type IN ('manufacturer_sku', 'model_number')
        ORDER BY normalized_value`,
      [originalEntityId],
    )).toEqual(expect.arrayContaining([
      { normalized_value: model },
      { normalized_value: sourceKey },
    ]));
    expect(await driver.query(
      `SELECT id FROM entities
        WHERE entity_type = 'manufacturer' AND canonical_slug = 'refresh-phantom-manufacturer'`,
    )).toEqual([]);
  });

  it('rolls back a successor revision and its alias-currentness change when source claim persistence fails', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const sourceKey = 'ACS-ALIAS-CLAIM-ROLLBACK-001';
    const originalModel = 'ALIASCLAIMROLLBACK001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-15T12:00:00.000Z' as never,
      runId: 'alias-claim-rollback-first',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, originalModel)],
        }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const [beforeRecord] = await currentSourceRecordRows(sourceKey);
    if (beforeRecord === undefined) throw new Error('rollback baseline source record missing');
    const beforeClaims = await currentSourceAliasClaimIds(sourceKey);
    expect(beforeClaims.length).toBeGreaterThanOrEqual(2);

    const failed = await Pipeline.create({
      driver: transactionAffinityGuard(driver, {
        failTransactionSql: /INSERT INTO entity_alias_claims/,
      }),
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-16T12:00:00.000Z' as never,
      runId: 'alias-claim-rollback-second',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'ALIASCLAIMROLLBACKNEW001')],
        }),
      },
    });
    expect((await failed.runSource('acme-hvac-catalog')).error).toContain('injected');

    const records = await currentSourceRecordRows(sourceKey, false);
    expect(records).toEqual([beforeRecord]);
    expect(await currentSourceAliasClaimIds(sourceKey)).toEqual(beforeClaims);
    expect(await driver.query<{ normalized_value: string }>(
      `SELECT normalized_value FROM current_entity_aliases
        WHERE normalized_value IN ($1, $2)
        ORDER BY normalized_value`,
      [originalModel, 'ALIASCLAIMROLLBACKNEW001'],
    )).toEqual([{ normalized_value: originalModel }]);
  });

  it('supersedes a finalized revision when identical bytes are re-extracted differently', async () => {
    await ensureIngestionRights();
    const base = await loadVerticalConfig('hvac');
    const sourceKey = 'ACS-SAMEARTIFACT001';
    const fixtureBody = JSON.stringify({
      products: [{
        ...catalogProduct(sourceKey, 'SAMEARTIFACT001'),
        rejected_model: 'AB',
      }],
    });
    const artifactStore = new InMemoryArtifactStore();
    const first = await pipelineForConfig(
      base,
      artifactStore,
      'same-artifact-first',
      { 'acme-hvac-catalog': fixtureBody },
    );
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const changedConfig: VerticalConfig = {
      ...base,
      sourceMappings: {
        ...base.sourceMappings,
        sources: base.sourceMappings.sources.map((source: Record<string, unknown>) =>
          source['source_key'] !== 'acme-hvac-catalog'
            ? source
            : {
              ...source,
              records: (source['records'] as readonly Record<string, unknown>[]).map((record) => ({
                ...record,
                aliases: (record['aliases'] as readonly Record<string, unknown>[]).map((alias) =>
                  alias['alias_type'] === 'model_number'
                    ? { ...alias, path: '/rejected_model' }
                    : alias,
                ),
              })),
            },
        ),
      },
    };
    const second = await pipelineForConfig(
      changedConfig,
      artifactStore,
      'same-artifact-reextracted',
      { 'acme-hvac-catalog': fixtureBody },
      undefined,
      '2026-08-16T12:00:00.000Z',
    );
    expect((await second.runSource('acme-hvac-catalog')).error).toBeNull();

    const revisions = await driver.query<{
      id: string;
      artifact_id: string;
      is_current: boolean;
      revision_state: string;
    }>(
      `SELECT id, artifact_id, is_current, revision_state
         FROM source_records WHERE source_record_key = $1
         ORDER BY created_at, id`,
      [sourceKey],
    );
    const current = revisions.find((revision) => revision.is_current);
    const evidence = await driver.query<{
      source_record_id: string;
      expected_artifact_id: string;
      artifact_id: string;
      contribution_role: string;
      locator_value: string;
    }>(
      `SELECT source_record_id, expected_artifact_id, artifact_id, contribution_role, locator_value
         FROM (
           SELECT evidence.source_record_id, record.artifact_id AS expected_artifact_id,
                  evidence.artifact_id, evidence.contribution_role, evidence.locator_value
             FROM entity_evidence evidence
             JOIN source_records record ON record.id = evidence.source_record_id
            WHERE record.source_record_key = $1
           UNION ALL
           SELECT evidence.source_record_id, record.artifact_id AS expected_artifact_id,
                  evidence.artifact_id, 'FACT', evidence.locator_value
             FROM fact_evidence evidence
             JOIN source_records record ON record.id = evidence.source_record_id
            WHERE record.source_record_key = $1
           UNION ALL
           SELECT evidence.source_record_id, record.artifact_id AS expected_artifact_id,
                  evidence.artifact_id, 'RELATIONSHIP', evidence.locator_value
             FROM relationship_evidence evidence
             JOIN source_records record ON record.id = evidence.source_record_id
            WHERE record.source_record_key = $1
         ) lineage
         ORDER BY source_record_id, contribution_role, locator_value`,
      [sourceKey],
    );
    const rejectedAliases = await driver.query(
      `SELECT id FROM entity_aliases WHERE alias_type = 'model_number' AND normalized_value = 'AB'`,
    );

    expect(revisions).toHaveLength(2);
    expect(revisions.filter((revision) => revision.is_current)).toEqual([
      expect.objectContaining({ revision_state: 'FINALIZED' }),
    ]);
    expect(new Set(revisions.map((revision) => revision.artifact_id)).size).toBe(1);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((row) => row.artifact_id === row.expected_artifact_id)).toBe(true);
    expect(
      evidence.filter((row) => row.source_record_id === current?.id && row.contribution_role === 'ALIAS')
        .map((row) => row.locator_value),
    ).toContain('/products/0/sku');
    expect(
      evidence.some(
        (row) => row.source_record_id === current?.id && row.locator_value === '/products/0/rejected_model',
      ),
    ).toBe(false);
    expect(rejectedAliases).toEqual([]);
  });

  it('rolls back source-record evidence replacement when the transaction cannot persist current lineage', async () => {
    await ensureIngestionRights();
    const artifactStore = new InMemoryArtifactStore();
    const sourceKey = 'ACS-REINGESTROLLBACK001';
    const first = await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-18T12:00:00.000Z' as never,
      runId: 'reingest-rollback-first',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'REINGESTROLLBACK001')],
        }),
      },
    });
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

    const [before] = await driver.query<{ id: string; artifact_id: string }>(
      `SELECT id, artifact_id FROM source_records WHERE source_record_key = $1 AND is_current`,
      [sourceKey],
    );
    expect(before).toBeDefined();

    const second = await Pipeline.create({
      driver: transactionAffinityGuard(driver, { failTransactionSql: /INSERT INTO entity_evidence/ }),
      verticalSlug: 'hvac',
      artifactStore,
      now: '2026-08-19T12:00:00.000Z' as never,
      runId: 'reingest-rollback-second',
      fixtureOverrides: {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sourceKey, 'AB')],
        }),
      },
    });
    expect((await second.runSource('acme-hvac-catalog')).error).toContain('injected entity-evidence failure');

    const [after] = await driver.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM source_records WHERE source_record_key = $1 AND is_current`,
      [sourceKey],
    );
    expect(after?.artifact_id).toBe(before?.artifact_id);
    const preserved = await driver.query<{ locator_value: string }>(
      `SELECT locator_value FROM entity_evidence
        WHERE source_record_id = $1 AND contribution_role = 'ALIAS'
        ORDER BY locator_value`,
      [before?.id ?? 'missing-source-record'],
    );
    expect(preserved.map((row) => row.locator_value)).toContain('/products/0/model');
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

  it.each([
    ['record locator', 'record', '/products/0#reprocessed-record', 'entity'],
    ['fact locator', 'fact', '/products/0/efficiency/seer2#reprocessed-fact', 'fact'],
    ['relationship locator', 'relationship', '/products/0/brand#reprocessed-relationship', 'relationship'],
  ] as const)(
    'supersedes a same-artifact source-record revision when its persisted %s changes',
    async (_label, mutation, expectedLocator, evidenceKind) => {
      await ensureIngestionRights();
      const config = await loadVerticalConfig('hvac');
      const artifactStore = new InMemoryArtifactStore();
      const sku = `ACS-FINGERPRINT-${mutation.toUpperCase()}-001`;
      const overrides = {
        'acme-hvac-catalog': JSON.stringify({
          products: [catalogProduct(sku, `FINGERPRINT${mutation.toUpperCase()}001`)],
        }),
      };
      const first = await pipelineForConfig(
        config,
        artifactStore,
        `evidence-fingerprint-${mutation}-first`,
        overrides,
      );
      expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();

      const replay = await pipelineForConfig(
        config,
        artifactStore,
        `evidence-fingerprint-${mutation}-replay`,
        overrides,
        relocatingExtraction(mutation),
        '2026-08-16T12:00:00.000Z',
      );
      expect((await replay.runSource('acme-hvac-catalog')).error).toBeNull();

      const revisions = await driver.query<{ id: string; is_current: boolean }>(
        `SELECT id, is_current
           FROM source_records
          WHERE source_record_key = $1
          ORDER BY created_at, id`,
        [sku],
      );
      expect(revisions).toHaveLength(2);
      const current = revisions.filter((revision) => revision.is_current);
      expect(current).toHaveLength(1);
      const currentSourceRecordId = current[0]?.id;
      if (currentSourceRecordId === undefined) throw new Error('current source record revision missing');

      const rows = evidenceKind === 'entity'
        ? await driver.query<{ locator_value: string }>(
            `SELECT locator_value FROM entity_evidence
              WHERE source_record_id = $1
              ORDER BY locator_value`,
            [currentSourceRecordId],
          )
        : evidenceKind === 'fact'
          ? await driver.query<{ locator_value: string }>(
              `SELECT locator_value FROM fact_evidence
                WHERE source_record_id = $1
                ORDER BY locator_value`,
              [currentSourceRecordId],
            )
          : await driver.query<{ locator_value: string }>(
              `SELECT locator_value FROM relationship_evidence
                WHERE source_record_id = $1
                ORDER BY locator_value`,
              [currentSourceRecordId],
            );
      expect(rows.map((row) => row.locator_value)).toContain(expectedLocator);
      expect(rows.map((row) => row.locator_value)).not.toContain(
        expectedLocator.replace('#reprocessed-record', '').replace('#reprocessed-fact', '').replace('#reprocessed-relationship', ''),
      );
    },
  );

  it('keeps an exact full-evidence same-artifact replay a source-record no-op', async () => {
    await ensureIngestionRights();
    const config = await loadVerticalConfig('hvac');
    const artifactStore = new InMemoryArtifactStore();
    const sku = 'ACS-FINGERPRINT-EXACT-001';
    const overrides = {
      'acme-hvac-catalog': JSON.stringify({
        products: [catalogProduct(sku, 'FINGERPRINTEXACT001')],
      }),
    };
    const first = await pipelineForConfig(config, artifactStore, 'evidence-fingerprint-exact-first', overrides);
    expect((await first.runSource('acme-hvac-catalog')).error).toBeNull();
    const [before] = await driver.query<{
      id: string;
      updated_at: string;
      entity_evidence_count: number;
      fact_evidence_count: number;
      relationship_evidence_count: number;
    }>(
      `SELECT record.id, record.updated_at,
              (SELECT count(*)::int FROM entity_evidence WHERE source_record_id = record.id) AS entity_evidence_count,
              (SELECT count(*)::int FROM fact_evidence WHERE source_record_id = record.id) AS fact_evidence_count,
              (SELECT count(*)::int FROM relationship_evidence WHERE source_record_id = record.id) AS relationship_evidence_count
         FROM source_records record
        WHERE record.source_record_key = $1`,
      [sku],
    );
    if (before === undefined) throw new Error('first exact replay revision missing');

    const replay = await pipelineForConfig(config, artifactStore, 'evidence-fingerprint-exact-replay', overrides);
    expect((await replay.runSource('acme-hvac-catalog')).error).toBeNull();
    const after = await driver.query<{
      id: string;
      updated_at: string;
      entity_evidence_count: number;
      fact_evidence_count: number;
      relationship_evidence_count: number;
    }>(
      `SELECT record.id, record.updated_at,
              (SELECT count(*)::int FROM entity_evidence WHERE source_record_id = record.id) AS entity_evidence_count,
              (SELECT count(*)::int FROM fact_evidence WHERE source_record_id = record.id) AS fact_evidence_count,
              (SELECT count(*)::int FROM relationship_evidence WHERE source_record_id = record.id) AS relationship_evidence_count
         FROM source_records record
        WHERE record.source_record_key = $1`,
      [sku],
    );
    expect(after).toEqual([before]);
  });
});

async function currentResolvedEntityId(sourceRecordKey: string, entityType: string): Promise<string> {
  const rows = await driver.query<{ entity_id: string }>(
    `SELECT DISTINCT evidence.entity_id
       FROM entity_evidence evidence
       JOIN source_records record ON record.id = evidence.source_record_id
       JOIN entities entity ON entity.id = evidence.entity_id
      WHERE record.source_record_key = $1
        AND record.is_current
        AND entity.entity_type = $2
        AND evidence.contribution_role = 'EXISTENCE'
      ORDER BY evidence.entity_id`,
    [sourceRecordKey, entityType],
  );
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(
      `expected one current ${entityType} target for ${sourceRecordKey}, found ${rows.length}`,
    );
  }
  return rows[0].entity_id;
}

interface SourceRecordRevisionRow extends SqlRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly is_current: boolean;
  readonly revision_state: string;
}

async function currentSourceRecordRows(
  sourceRecordKey: string,
  currentOnly = true,
): Promise<SourceRecordRevisionRow[]> {
  return driver.query<SourceRecordRevisionRow>(
    `SELECT id, artifact_id, is_current, revision_state
       FROM source_records
      WHERE source_record_key = $1${currentOnly ? ' AND is_current' : ''}
      ORDER BY created_at, id`,
    [sourceRecordKey],
  );
}

async function sourceRecordTargetSnapshot(
  sourceRecordKey: string,
  entityType: string,
): Promise<{
  readonly revisions: readonly SourceRecordRevisionRow[];
  readonly currentSourceRecordId: string;
  readonly currentEntityIds: readonly string[];
  readonly historicalTargets: readonly { readonly entity_id: string; readonly is_current: boolean }[];
}> {
  const revisions = await currentSourceRecordRows(sourceRecordKey, false);
  const current = revisions.filter((record) => record.is_current);
  if (current.length !== 1 || current[0] === undefined) {
    throw new Error(`expected one current source-record revision for ${sourceRecordKey}`);
  }
  const historicalTargets = await driver.query<{ entity_id: string; is_current: boolean }>(
    `SELECT DISTINCT evidence.entity_id, record.is_current
       FROM entity_evidence evidence
       JOIN source_records record ON record.id = evidence.source_record_id
       JOIN entities entity ON entity.id = evidence.entity_id
      WHERE record.source_record_key = $1
        AND entity.entity_type = $2
        AND evidence.contribution_role = 'EXISTENCE'
      ORDER BY record.is_current, evidence.entity_id`,
    [sourceRecordKey, entityType],
  );
  return {
    revisions,
    currentSourceRecordId: current[0].id,
    currentEntityIds: historicalTargets
      .filter((target) => target.is_current)
      .map((target) => target.entity_id),
    historicalTargets,
  };
}

async function seedCuratedEquipmentAlias(input: {
  readonly aliasType: string;
  readonly aliasValue: string;
  readonly slug: string;
}): Promise<{ readonly entityId: string; readonly aliasId: string }> {
  const [vertical] = await driver.query<{ id: string }>(
    `SELECT id FROM verticals WHERE slug = 'hvac'`,
  );
  if (vertical === undefined) throw new Error('HVAC vertical missing');
  const entityId = crypto.randomUUID();
  const aliasId = crypto.randomUUID();
  await driver.query(
    `INSERT INTO entities
       (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
        quality_score, first_seen_at, last_verified_at)
     VALUES ($1, $2, 'equipment_model', $3, $4, 'ACTIVE', 0.5, $5, $5)`,
    [entityId, vertical.id, input.slug, input.slug, '2026-08-01T00:00:00.000Z'],
  );
  await driver.query(
    `INSERT INTO entity_aliases
       (id, entity_id, alias_type, alias_value, normalized_value, source_id,
        identity_confidence, valid_from, valid_to)
     VALUES ($1, $2, $3, $4, $4, NULL, 0.99, $5, NULL)`,
    [aliasId, entityId, input.aliasType, input.aliasValue, '2026-08-01T00:00:00.000Z'],
  );
  await driver.query(
    `INSERT INTO entity_alias_claims
       (entity_alias_id, asserted_alias_value, asserted_normalized_value,
        identity_confidence, claim_kind, source_id, source_record_id, authority_epoch,
        locator_type, locator_value, valid_to)
     VALUES ($1, $2, $2, 0.99, 'CURATED', NULL, NULL, 0, NULL, NULL, NULL)`,
    [aliasId, input.aliasValue],
  );
  return { entityId, aliasId };
}

async function retireAlias(aliasId: string): Promise<void> {
  await driver.query(
    `UPDATE entity_aliases
        SET valid_to = $2, authority_epoch = authority_epoch + 1
      WHERE id = $1`,
    [aliasId, '2026-08-16T00:00:00.000Z'],
  );
}

async function currentRelationshipTargets(
  sourceRecordKey: string,
  predicate: string,
): Promise<string[]> {
  const rows = await driver.query<{ subject_entity_id: string }>(
    `SELECT DISTINCT relationship.subject_entity_id
       FROM relationship_evidence evidence
       JOIN source_records record ON record.id = evidence.source_record_id
       JOIN relationships relationship ON relationship.id = evidence.relationship_id
      WHERE record.source_record_key = $1
        AND record.is_current
        AND relationship.predicate = $2
      ORDER BY relationship.subject_entity_id`,
    [sourceRecordKey, predicate],
  );
  return rows.map((row) => row.subject_entity_id);
}

async function currentSourceAliasClaimIds(sourceRecordKey: string): Promise<string[]> {
  const rows = await driver.query<{ id: string }>(
    `SELECT claim.id
       FROM entity_alias_claims claim
       JOIN source_records record ON record.id = claim.source_record_id
      WHERE record.source_record_key = $1 AND record.is_current
      ORDER BY claim.id`,
    [sourceRecordKey],
  );
  return rows.map((row) => row.id);
}

function remapCatalogAliases(
  config: VerticalConfig,
  paths: Readonly<Record<string, string>>,
): VerticalConfig['sourceMappings'] {
  return {
    ...config.sourceMappings,
    sources: config.sourceMappings.sources.map((source: Record<string, unknown>) =>
      source['source_key'] !== 'acme-hvac-catalog'
        ? source
        : {
          ...source,
          records: (source['records'] as readonly Record<string, unknown>[]).map((record) => ({
            ...record,
            aliases: (record['aliases'] as readonly Record<string, unknown>[]).map((alias) => ({
              ...alias,
              path: paths[String(alias['alias_type'])] ?? alias['path'],
            })),
          })),
        },
    ),
  };
}

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

type LocatorMutation = 'record' | 'fact' | 'relationship';

function relocatingExtraction(mutation: LocatorMutation): ExtractionProviderRegistry {
  const delegate = new JsonExtractor();
  const provider: ExtractionProvider = {
    name: `relocating-json-extractor-${mutation}`,
    format: 'json',
    version: delegate.version,
    supports: (schema: ExtractionSchema) => delegate.supports(schema),
    async extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]> {
      const records = await delegate.extract(artifact, schema);
      return records.map((record) => {
        if (mutation === 'record') {
          return {
            ...record,
            locator: { ...record.locator, value: `${record.locator.value}#reprocessed-record` },
          };
        }
        const field = mutation === 'fact' ? 'prop_seer2' : 'rel_manufactures_subject';
        const suffix = mutation === 'fact' ? 'fact' : 'relationship';
        return {
          ...record,
          values: record.values.map((value) =>
            value.field === field
              ? { ...value, locator: { ...value.locator, value: `${value.locator.value}#reprocessed-${suffix}` } }
              : value,
          ),
        };
      });
    },
  };
  return createExtractionRegistry([delegate, provider]);
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
    async transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      if (transactionActive) {
        throw new Error('nested transaction escaped the active transaction executor');
      }
      return delegate.transaction(async (delegateTx) => {
        transactionActive = true;
        const tx = {
          async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
            if (options.failTransactionSql?.test(sql) === true) {
              throw new Error('injected entity-evidence failure');
            }
            return delegateTx.query<R>(sql, params);
          },
        } as SqlTransactionExecutor;
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
  extraction?: ExtractionProviderRegistry,
  nowOverride?: string,
): Promise<Pipeline> {
  const { directory, bindings } = await buildFixtureManifest(
    config,
    overrides === undefined ? {} : { overrides },
  );
  const validatorCache = new InMemoryValidatorCache();
  const now = (nowOverride ?? '2026-08-15T12:00:00.000Z') as never;
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
    ...(extraction === undefined ? {} : { extraction }),
  });
}

async function publicWebEntity(
  pipeline: Pipeline,
  entityId: string,
  asOf: string,
) {
  const config = await loadVerticalConfig('hvac');
  return createQueryModel(pipeline.store, {
    fields: buildFieldMetadata(config),
  }).forSurface('PUBLIC_WEB', { asOf: asOf as never }).getEntity(entityId as never);
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
  const publicCellId = crypto.randomUUID();
  const publicDecisionId = crypto.randomUUID();
  await driver.query(
    `INSERT INTO rights_cells
       (id, source_id, acquisition_route, operation, channel, created_by)
     VALUES ($1, $2, 'DIRECT_HTTP', 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-fixture')`,
    [publicCellId, sourceId],
  );
  await driver.query(
    `INSERT INTO rights_decisions
       (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
        review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
        rationale, created_by)
     VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED', 'HUMAN',
             'test-fixture', $5, $5, $6, 'explicit task 8 public fixture grant', 'test-fixture')`,
    [publicDecisionId, publicCellId, termsVersionId, reviewEvidenceId, effective, recheck],
  );
  await driver.query(
    `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'task 8 fixture', $2)`,
    [publicDecisionId, effective],
  );
  await driver.exec('COMMIT');
}
