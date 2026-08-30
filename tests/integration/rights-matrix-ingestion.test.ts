/** Matrix controls at the two irreversible ingest boundaries. */
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  InMemoryArtifactStore,
  Pipeline,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import { createCanonicalStore, type SqlDriver } from '../../packages/canonical-store/src/index.js';
import {
  REPO_ROOT,
  RUN_1_AT,
  migratedDriver,
  seedSyntheticInternalRights,
} from '../support/harness.js';

const SOURCE = 'acme-hvac-catalog';
const drivers: SqlDriver[] = [];

async function configuredPipeline(options: {
  readonly omit?: readonly string[];
  readonly fieldAllows?: Readonly<Record<string, readonly string[]>>;
}): Promise<{ driver: SqlDriver; pipeline: Pipeline }> {
  const driver = await migratedDriver();
  drivers.push(driver);
  const verticalsDir = join(REPO_ROOT, 'verticals');
  const config = await loadVerticalConfig('hvac', { verticalsDir });
  await seedSyntheticInternalRights(driver, createCanonicalStore(driver), config, {
    ...(options.omit === undefined ? {} : { omit: { [SOURCE]: options.omit } }),
    ...(options.fieldAllows === undefined
      ? {}
      : { fieldAllows: { [SOURCE]: options.fieldAllows } }),
  });
  return {
    driver,
    pipeline: await Pipeline.create({
      driver,
      verticalSlug: 'hvac',
      verticalsDir,
      artifactStore: new InMemoryArtifactStore(),
      now: RUN_1_AT,
      runId: crypto.randomUUID(),
    }),
  };
}

afterAll(async () => {
  await Promise.all(drivers.map((driver) => driver.close()));
});

describe('acquisition authorization', () => {
  it('refuses before transport, policy snapshot, artifact, or source-record storage', async () => {
    const { driver, pipeline } = await configuredPipeline({ omit: ['ACQUIRE'] });
    const run = await pipeline.runVertical({ sources: [SOURCE] });

    expect(run.sources[0]?.error).toMatch(/ACQUIRE\/RAW_RECORD\/\*=NO_GRANT/i);
    for (const table of [
      'acquisition_policy_snapshots',
      'source_artifacts',
      'source_records',
    ]) {
      const rows = await driver.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table}`,
      );
      expect(rows[0]?.n, table).toBe('0');
    }
  });
});

describe('field-scoped normalization authorization', () => {
  it('allows the named field and strong identifiers without implying a neighboring property', async () => {
    const { driver, pipeline } = await configuredPipeline({
      omit: ['NORMALIZE'],
      fieldAllows: {
        NORMALIZE: ['manufacturer_sku', 'model_number', 'voltage'],
      },
    });
    const run = await pipeline.runVertical({ sources: [SOURCE] });

    expect(run.sources[0]?.error).toBeNull();
    const facts = await driver.query<{ property: string }>(
      'SELECT DISTINCT property FROM facts ORDER BY property',
    );
    expect(facts.map((row) => row.property)).toEqual(['voltage']);

    const payloads = await driver.query<{ normalized_payload: unknown }>(
      'SELECT normalized_payload FROM source_records ORDER BY source_record_key',
    );
    const serialized = JSON.stringify(payloads);
    expect(serialized).toContain('voltage');
    expect(serialized).not.toContain('phase');
    expect(serialized).not.toContain('seer2');

    const evidence = await driver.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM entity_evidence',
    );
    expect(Number(evidence[0]?.n ?? '0')).toBeGreaterThan(0);
  });
});
