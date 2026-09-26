/**
 * OPERATOR BULK-LOAD PROOF for `vehicles`: ZIP archives through `pnpm ingest`.
 *
 * The real EPA and NHTSA bulk files are believed to be ZIP archives larger than
 * any scheduled route accepts, so their initial load is
 * `pnpm ingest --artifact <source-key>=<zip>`. This test packages the synthetic
 * shape fixtures as ZIPs at test time (real deflate streams from `node:zlib`),
 * drives the real CLI entry point against a WASM Postgres, and proves:
 *
 *   - the committed fail-closed declarations are refused (no rights bypass);
 *   - on a test-only activated copy, both archives publish exactly the golden
 *     canonical output that the plain-CSV shape test publishes;
 *   - the ZIP — not the member — is the recorded, durably preserved artifact
 *     (its SHA-256 is the artifact digest), and every locator names the member
 *     as well as the row and column;
 *   - a damaged archive fails its source closed with the ZIP error code.
 *
 * As with shape-ingest.test.ts, the fixtures are synthetic and their column
 * names UNVERIFIED; this proves the archive path, not the real files' mapping.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCanonicalStore, type SqlDriver } from '../../../packages/canonical-store/src/index.js';
import { loadVerticalConfig } from '../../../services/ingest-worker/src/index.js';
import { main } from '../../../services/ingest-worker/src/cli.js';
import { REPO_ROOT, migratedDriver, seedSyntheticInternalRights } from '../../../tests/support/harness.js';
import { buildZip } from '../../../tests/support/zip.js';

const MAPPED_SOURCES = ['epa-fueleconomy-vehicles', 'nhtsa-recalls'] as const;
const TEST_RANKS: Readonly<Record<string, number>> = {
  'epa-fueleconomy-vehicles': 85,
  'nhtsa-recalls': 80,
};
const FIXTURES = join(REPO_ROOT, 'verticals', 'vehicles', 'fixtures');
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function activatedCopy(root: string): Promise<string> {
  await cp(join(REPO_ROOT, 'verticals', 'vehicles'), join(root, 'vehicles'), { recursive: true });
  for (const key of MAPPED_SOURCES) {
    const path = join(root, 'vehicles', 'sources', `${key}.yaml`);
    const source = parseYaml(await readFile(path, 'utf8'));
    source.status = 'ACTIVE';
    source.rights_classification = 'GREEN';
    source.authority_rank = TEST_RANKS[key];
    Object.assign(source.rights_policy, {
      commercial_use_allowed: true,
      redistribution_allowed: true,
      derivative_normalization_allowed: true,
      reviewed_at: '2026-06-01T00:00:00Z',
      reviewed_by: 'synthetic-test-fixture',
      next_review_at: '2027-06-01',
    });
    Object.assign(source.acquisition_policy, {
      approved: true,
      approved_by: 'synthetic-test-fixture',
      approved_at: '2026-06-01T00:00:00Z',
    });
    await writeFile(path, stringifyYaml(source), 'utf8');
  }
  return root;
}

/** The CLI closes its driver; the test keeps inspecting it afterwards. */
const unclosable = (driver: SqlDriver): SqlDriver =>
  new Proxy(driver, {
    get(target, property) {
      if (property === 'close') return async () => undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

async function seededDriver(verticalsDir: string): Promise<SqlDriver> {
  const driver = await migratedDriver();
  const config = await loadVerticalConfig('vehicles', { verticalsDir });
  await seedSyntheticInternalRights(driver, createCanonicalStore(driver), config);
  return driver;
}

async function runCli(argv: readonly string[], driver: SqlDriver, verticalsDir?: string): Promise<{ code: number; output: string }> {
  let output = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  try {
    const code = await main(argv, {
      env: {},
      openDriver: async () => unclosable(driver),
      ...(verticalsDir === undefined ? {} : { verticalsDir }),
    });
    return { code, output };
  } finally {
    spy.mockRestore();
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

let work: string;
let epaZip: string;
let nhtsaZip: string;
let epaBytes: Uint8Array;
let nhtsaBytes: Uint8Array;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'vehicles-zip-'));
  epaBytes = buildZip([{ name: 'vehicles.csv', data: await readFile(join(FIXTURES, 'epa-vehicles.csv')) }]);
  nhtsaBytes = buildZip([
    // A second member proves the glob selects exactly the flat file.
    { name: 'RCL_import_instructions.txt', data: 'synthetic readme' },
    { name: 'FLAT_RCL.txt', data: await readFile(join(FIXTURES, 'nhtsa-flat-rcl.csv')) },
  ]);
  epaZip = join(work, 'vehicles.csv.zip');
  nhtsaZip = join(work, 'FLAT_RCL.zip');
  await writeFile(epaZip, epaBytes);
  await writeFile(nhtsaZip, nhtsaBytes);
});

afterAll(async () => {
  if (work !== undefined) await rm(work, { recursive: true, force: true });
});

const artifactArgs = (): string[] => [
  '--vertical', 'vehicles',
  '--artifact', `epa-fueleconomy-vehicles=${epaZip}`,
  '--artifact', `nhtsa-recalls=${nhtsaZip}`,
  '--max-records', '500000',
];

describe('operator ZIP load of the committed declarations', () => {
  it('is refused by the rights and status gates and publishes nothing', async () => {
    const driver = await seededDriver(join(REPO_ROOT, 'verticals'));
    try {
      const { code, output } = await runCli([...artifactArgs(), '--evidence-dir', join(work, 'refused-evidence')], driver);
      expect(code).toBe(1);
      expect(output).toMatch(/FAIL epa-fueleconomy-vehicles/);
      expect(output).toMatch(/FAIL nhtsa-recalls/);
      // Refused by a governance gate, not by some incidental archive problem.
      expect(output).not.toMatch(/ZIP_/);
      expect(output).toMatch(/UNDER_REVIEW|UNREVIEWED|RIGHTS/);
      const [facts] = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
      const [entities] = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM entities`);
      expect(Number(facts?.n)).toBe(0);
      expect(Number(entities?.n)).toBe(0);
    } finally {
      await driver.close();
    }
  }, 300_000);
});

describe('operator ZIP load on a test-only activated copy', () => {
  let driver: SqlDriver;
  let verticalsDir: string;
  let evidenceDir: string;
  let run: { code: number; output: string };

  beforeAll(async () => {
    verticalsDir = await activatedCopy(await mkdtemp(join(tmpdir(), 'vehicles-zip-verticals-')));
    evidenceDir = join(work, 'evidence');
    driver = await seededDriver(verticalsDir);
    run = await runCli([...artifactArgs(), '--evidence-dir', evidenceDir, '--run-id', 'zip-load-1'], driver, verticalsDir);
  }, 300_000);

  afterAll(async () => {
    await driver?.close();
    if (verticalsDir !== undefined) await rm(verticalsDir, { recursive: true, force: true });
  });

  it('publishes both sources with full provenance coverage', () => {
    expect(run.output).toMatch(/ok {2}epa-fueleconomy-vehicles\s+PUBLISHED/);
    expect(run.output).toMatch(/ok {2}nhtsa-recalls\s+PUBLISHED/);
    expect(run.output).toMatch(/provenance coverage: facts (\d+)\/\1 \(100\.00%\)/);
    expect(run.code).toBe(0);
  });

  it('publishes exactly the golden canonical output of the plain-CSV shape run', async () => {
    const golden = JSON.parse(await readFile(join(FIXTURES, 'golden', 'facts.json'), 'utf8'));
    const entities = JSON.parse(await readFile(join(FIXTURES, 'golden', 'entities.json'), 'utf8'));
    const [facts] = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
    const [entityCount] = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM entities`);
    expect(Number(facts?.n)).toBe(golden.count);
    expect(Number(entityCount?.n)).toBe(entities.entities.length);
  });

  it('records each ZIP, byte for byte, as the source artifact and preserves it on disk', async () => {
    const rows = await driver.query<{ url: string; content_hash: string; mime_type: string; byte_size: string; r2_uri: string }>(
      `SELECT url, content_hash, mime_type, byte_size::text AS byte_size, r2_uri FROM source_artifacts ORDER BY url`,
    );
    expect(rows.map((row) => row.url)).toEqual([
      'https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.zip',
      'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip',
    ]);
    expect(rows.map((row) => row.content_hash)).toEqual([sha256(nhtsaBytes), sha256(epaBytes)]);
    for (const row of rows) {
      expect(row.mime_type).toBe('application/zip');
      expect(row.r2_uri.startsWith('file://')).toBe(true);
    }
    expect(rows.map((row) => Number(row.byte_size))).toEqual([nhtsaBytes.byteLength, epaBytes.byteLength]);

    const preserved = new Set<string>();
    for (const file of await filesUnder(evidenceDir)) {
      if (!file.endsWith('.json')) preserved.add(sha256(new Uint8Array(await readFile(file))));
    }
    expect(preserved).toEqual(new Set([sha256(nhtsaBytes), sha256(epaBytes)]));
  });

  it('cites the archive member, row and column in every fact locator', async () => {
    const locators = await driver.query<{ locator_type: string; locator_value: string }>(
      `SELECT DISTINCT locator_type, locator_value FROM fact_evidence`,
    );
    expect(locators.length).toBeGreaterThan(0);
    for (const locator of locators) {
      expect(locator.locator_type).toBe('TABLE_CELL');
      expect(locator.locator_value).toMatch(/^member=(vehicles\.csv|FLAT_RCL\.txt);row=\d+;column=/);
    }
    const claims = await driver.query<{ locator_value: string }>(
      `SELECT c.locator_value FROM entity_alias_claims c
         JOIN entity_aliases a ON a.id = c.entity_alias_id
        WHERE a.alias_type = 'make_model_year'`,
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.locator_value).toMatch(
        /^member=(vehicles\.csv;row=\d+;columns=make,baseModel,year|FLAT_RCL\.txt;row=\d+;columns=MAKETXT,MODELTXT,YEARTXT);indexes=\d+,\d+,\d+$/,
      );
    }
  });

  it('fails a damaged archive closed with its ZIP error code', async () => {
    const damaged = buildZip([
      { name: 'FLAT_RCL.txt', data: await readFile(join(FIXTURES, 'nhtsa-flat-rcl.csv')), crc32: 0xdeadbeef },
    ]);
    const path = join(work, 'damaged', 'FLAT_RCL.zip');
    await mkdir(join(work, 'damaged'), { recursive: true });
    await writeFile(path, damaged);
    const before = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
    const { code, output } = await runCli(
      ['--vertical', 'vehicles', '--artifact', `nhtsa-recalls=${path}`, '--evidence-dir', evidenceDir, '--run-id', 'zip-load-damaged'],
      driver,
      verticalsDir,
    );
    expect(code).toBe(1);
    expect(output).toMatch(/FAIL nhtsa-recalls/);
    expect(output).toMatch(/ZIP_CRC_MISMATCH/);
    const after = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM facts`);
    expect(after).toEqual(before);
  }, 300_000);
});
