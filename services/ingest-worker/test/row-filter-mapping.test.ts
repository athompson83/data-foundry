/**
 * The generic per-stream `where` row filter in `source-mappings.yaml`,
 * compiled to the extraction `csv_rows.where` selector. Tested on the real
 * `vehicles` configuration and its SYNTHETIC NHTSA fixture; the compiler
 * itself names no vertical, source or column.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createExtractionRegistry, type ExtractionArtifact } from '@data-foundry/extraction';
import { sourceArtifactId, sourceId } from '@data-foundry/canonical-schema';
import { compileSourcePlans, type SourcePlan, type StreamPlan } from '../src/compile.js';
import { loadVerticalConfig, type VerticalConfig } from '../src/config.js';
import { MappingCompilationError } from '../src/errors.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let vehicles: VerticalConfig;
let plans: SourcePlan[];

beforeAll(async () => {
  vehicles = await loadVerticalConfig('vehicles');
  plans = compileSourcePlans(vehicles);
});

const nhtsaStreams = (): readonly StreamPlan[] =>
  plans.find((plan) => plan.sourceKey === 'nhtsa-recalls')?.streams ?? [];

function withNhtsaRecord(patch: (record: any, source: any) => any): VerticalConfig {
  const sources = vehicles.sourceMappings.sources.map((source: any) =>
    source.source_key !== 'nhtsa-recalls'
      ? source
      : { ...source, records: source.records.map((record: any) => patch(record, source)) },
  );
  return { ...vehicles, sourceMappings: { ...vehicles.sourceMappings, sources } };
}

describe('stream `where` row filter', () => {
  it('compiles onto every NHTSA stream as a csv_rows filter', () => {
    const streams = nhtsaStreams();
    expect(streams.map((stream) => stream.stream)).toEqual(['affected_model_years', 'campaigns']);
    for (const stream of streams) {
      expect(stream.schema.record).toMatchObject({ kind: 'csv_rows', where: { column: 'RCLTYPECD', in: ['V'] } });
    }
    // A stream without `where` compiles exactly as before.
    const epa = plans.find((plan) => plan.sourceKey === 'epa-fueleconomy-vehicles')!;
    for (const stream of epa.streams) expect(stream.schema.record).not.toHaveProperty('where');
  });

  it('excludes the fixture’s equipment and tire rows during extraction', async () => {
    const body = await readFile(join(REPO_ROOT, 'verticals', 'vehicles', 'fixtures', 'nhtsa-flat-rcl.csv'), 'utf8');
    const skipped = body.split('\n').findIndex((line) => !line.startsWith('#'));
    const artifact: ExtractionArtifact = {
      artifact: {
        id: sourceArtifactId('77777777-7777-4777-8777-777777777777'),
        source_id: sourceId('11111111-1111-4111-8111-111111111111'),
        url: 'https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.txt',
        retrieved_at: '2026-01-15T09:30:00Z',
        content_hash: 'b'.repeat(64),
        mime_type: 'text/tab-separated-values',
        r2_uri: 'r2://data-foundry-raw/vehicles/synthetic',
        http_status: 200,
        extractor_version: 'fixture@1.0.0',
        policy_snapshot_id: null,
        byte_size: body.length,
        acquisition_provider: 'http',
        acquisition_route: 'BULK_FILE',
        account_or_product_plan: null,
        acquisition_jurisdiction: null,
        created_at: '2026-01-15T09:30:05Z',
      },
      body,
    };
    for (const stream of nhtsaStreams()) {
      if (stream.schema.record.kind !== 'csv_rows') throw new Error('expected csv_rows');
      const schema = { ...stream.schema, record: { ...stream.schema.record, from_line: skipped + 1 } };
      const records = await createExtractionRegistry().extract(artifact, schema);
      const keys = records.map((record) => record.source_record_key);
      expect(keys.length, stream.stream).toBe(7);
      expect(keys.some((key) => key.startsWith('9000008') || key.startsWith('9000009')), stream.stream).toBe(false);
    }
  });

  it.each([
    ['a column the headerless source does not declare', { column: 'RECALL_TYPE', in: ['V'] }],
    ['an empty value list', { column: 'RCLTYPECD', in: [] }],
    ['a non-string value (YAML coercion)', { column: 'RCLTYPECD', in: [true] }],
    ['duplicate values', { column: 'RCLTYPECD', in: ['V', 'V'] }],
    ['an unknown key', { column: 'RCLTYPECD', in: ['V'], not_in: ['E'] }],
    ['a bare string', 'RCLTYPECD = V'],
  ])('refuses %s', (_label, where) => {
    expect(() => compileSourcePlans(withNhtsaRecord((record) => ({ ...record, where })))).toThrow(
      MappingCompilationError,
    );
  });

  it('refuses a row filter on a non-CSV source rather than ignoring it', async () => {
    const hvac = await loadVerticalConfig('hvac');
    const [first, ...rest] = hvac.sourceMappings.sources;
    expect(first.format).not.toBe('csv');
    const broken = {
      ...hvac,
      sourceMappings: {
        ...hvac.sourceMappings,
        sources: [
          { ...first, records: [{ ...first.records[0], where: { column: 'kind', in: ['V'] } }, ...first.records.slice(1)] },
          ...rest,
        ],
      },
    };
    expect(() => compileSourcePlans(broken)).toThrow(/only for csv sources/);
  });
});
