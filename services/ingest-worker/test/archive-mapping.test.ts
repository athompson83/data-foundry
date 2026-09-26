import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseExtractionSchema } from '@data-foundry/extraction';
import { compileSourcePlans } from '../src/compile.js';
import { loadVerticalConfig, type VerticalConfig } from '../src/config.js';
import { buildOperatorArtifactManifest, OPERATOR_ARTIFACT_DIRECTORY } from '../src/operator-artifacts.js';

let vehicles: VerticalConfig;
let hvac: VerticalConfig;
let work: string;

beforeAll(async () => {
  vehicles = await loadVerticalConfig('vehicles');
  hvac = await loadVerticalConfig('hvac');
  work = await mkdtemp(join(tmpdir(), 'operator-artifacts-'));
});

afterAll(async () => {
  if (work !== undefined) await rm(work, { recursive: true, force: true });
});

const withMapping = (config: VerticalConfig, edit: (sources: any[]) => void): VerticalConfig => {
  const copy = { ...config, sourceMappings: structuredClone(config.sourceMappings) } as VerticalConfig & {
    sourceMappings: any;
  };
  edit(copy.sourceMappings.sources);
  return copy;
};

describe('parsing.archive and parsing.quote compile into the extraction schema', () => {
  it('declares the vehicles bulk files as ZIP members on every stream', () => {
    const plans = compileSourcePlans(vehicles);
    const archives = Object.fromEntries(
      plans.map((plan) => [plan.sourceKey, [...new Set(plan.streams.map((stream) => JSON.stringify(stream.schema.archive)))]]),
    );
    expect(archives['epa-fueleconomy-vehicles']!.map((value) => JSON.parse(value))).toEqual([
      { format: 'zip', member: 'vehicles.csv', accept_unarchived: true, max_members: 8, max_uncompressed_bytes: 268435456, max_compression_ratio: 200 },
    ]);
    expect(JSON.parse(archives['nhtsa-recalls']![0]!).member).toBe('FLAT_RCL*.txt');
    for (const plan of plans) for (const stream of plan.streams) parseExtractionSchema(stream.schema);
  });

  it('leaves sources that declare no archive unchanged', () => {
    for (const plan of compileSourcePlans(hvac)) {
      for (const stream of plan.streams) expect(stream.schema.archive).toBeUndefined();
    }
  });

  it('refuses an invalid archive declaration by path', () => {
    const invalid = withMapping(vehicles, (sources) => {
      sources[0].parsing.archive = { format: 'zip', member: '../vehicles.csv' };
    });
    expect(() => compileSourcePlans(invalid)).toThrow(/parsing\.archive.*member/);
    const oversized = withMapping(vehicles, (sources) => {
      sources[0].parsing.archive.max_uncompressed_bytes = 4 * 1024 * 1024 * 1024;
    });
    expect(() => compileSourcePlans(oversized)).toThrow(/max_uncompressed_bytes/);
  });

  it('passes a declared quote character, and "" or null for an unquoted file', () => {
    for (const [declared, expected] of [['', ''], [null, ''], ["'", "'"]] as const) {
      const config = withMapping(vehicles, (sources) => {
        sources[1].parsing.quote = declared;
      });
      const plan = compileSourcePlans(config).find((candidate) => candidate.sourceKey === 'nhtsa-recalls')!;
      const record = plan.streams[0]!.schema.record;
      expect(record.kind === 'csv_rows' ? record.quote : undefined).toBe(expected);
    }
    // The committed NHTSA mapping declares the real flat file unquoted
    // (verified 2026-09-26); EPA, which does quote, keeps the default.
    const plan = compileSourcePlans(vehicles).find((candidate) => candidate.sourceKey === 'nhtsa-recalls')!;
    const record = plan.streams[0]!.schema.record;
    expect(record.kind === 'csv_rows' ? record.quote : 'n/a').toBe('');
    const epa = compileSourcePlans(vehicles).find((candidate) => candidate.sourceKey === 'epa-fueleconomy-vehicles')!;
    const epaRecord = epa.streams[0]!.schema.record;
    expect(epaRecord.kind === 'csv_rows' ? epaRecord.quote : 'n/a').toBeUndefined();
  });
});

describe('operator artifact manifest', () => {
  it('binds a downloaded file to its source at the robots-allowed URL, served from memory', async () => {
    const path = join(work, 'FLAT_RCL.zip');
    await writeFile(path, new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]));
    const manifest = await buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'nhtsa-recalls', path }]);
    expect(manifest.directory).toBe(OPERATOR_ARTIFACT_DIRECTORY);
    expect(manifest.bindings).toHaveLength(1);
    const [binding] = manifest.bindings;
    expect(binding!.entry.url).toBe('https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.zip');
    expect(binding!.entry.mimeType).toBe('application/zip');
    expect(binding!.entry.headers?.['etag']).toMatch(/^"[0-9a-f]{32}"$/);
    const served = await manifest.fs.readFile(`${manifest.directory}/${binding!.entry.file}`);
    expect(served.byteLength).toBe(22);
    expect(await manifest.fs.exists(`${manifest.directory}/other`)).toBe(false);
  });

  it('refuses undeclared sources, unsupported or empty files, and a ZIP for a source with no archive member', async () => {
    const csv = join(work, 'data.csv');
    await writeFile(csv, 'a,b\n1,2\n');
    await expect(buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'not-a-source', path: csv }])).rejects.toThrow(
      /no registry entry/,
    );
    await expect(buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'nhtsa-vpic', path: csv }])).rejects.toThrow(
      /no mapping/,
    );
    const exe = join(work, 'payload.exe');
    await writeFile(exe, 'x');
    await expect(buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'nhtsa-recalls', path: exe }])).rejects.toThrow(
      /unsupported extension/,
    );
    const empty = join(work, 'empty.csv');
    await writeFile(empty, '');
    await expect(buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'nhtsa-recalls', path: empty }])).rejects.toThrow(
      /non-empty/,
    );
    await expect(
      buildOperatorArtifactManifest(vehicles, [{ sourceKey: 'nhtsa-recalls', path: join(work, 'missing.zip') }]),
    ).rejects.toThrow(/not a readable file/);
    const zip = join(work, 'hvac.zip');
    await writeFile(zip, 'PK');
    const hvacKey = String((hvac.sourceMappings as any).sources[0].source_key);
    await expect(buildOperatorArtifactManifest(hvac, [{ sourceKey: hvacKey, path: zip }])).rejects.toThrow(
      /declares no parsing\.archive/,
    );
    await expect(
      buildOperatorArtifactManifest(vehicles, [
        { sourceKey: 'nhtsa-recalls', path: csv },
        { sourceKey: 'nhtsa-recalls', path: csv },
      ]),
    ).rejects.toThrow(/more than once/);
  });
});
