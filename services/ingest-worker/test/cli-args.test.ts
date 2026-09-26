import { describe, expect, it } from 'vitest';
import { MAX_CLI_RECORDS, parseArgs } from '../src/cli.js';

describe('pnpm ingest argument parsing', () => {
  it('keeps the fixture-run defaults', () => {
    expect(parseArgs([])).toEqual({
      vertical: 'hvac',
      source: null,
      dryRun: false,
      memory: false,
      runId: null,
      artifacts: [],
      maxRecords: null,
      evidenceDir: null,
    });
    expect(parseArgs(['--', '--vertical', 'vehicles', '--dry-run']).vertical).toBe('vehicles');
  });

  it('parses repeated operator artifacts, the record ceiling and the evidence directory', () => {
    const args = parseArgs([
      '--vertical', 'vehicles',
      '--artifact', 'epa-fueleconomy-vehicles=/data/vehicles.csv.zip',
      '--artifact', 'nhtsa-recalls=downloads/FLAT_RCL.zip',
      '--max-records', '500000',
      '--evidence-dir', '/srv/evidence',
      '--run-id', 'vehicles-initial-2026-09',
    ]);
    expect(args.artifacts).toEqual([
      { sourceKey: 'epa-fueleconomy-vehicles', path: '/data/vehicles.csv.zip' },
      { sourceKey: 'nhtsa-recalls', path: 'downloads/FLAT_RCL.zip' },
    ]);
    expect(args.maxRecords).toBe(500_000);
    expect(args.evidenceDir).toBe('/srv/evidence');
    expect(args.runId).toBe('vehicles-initial-2026-09');
  });

  it('keeps an = inside the path', () => {
    expect(parseArgs(['--artifact', 'nhtsa-recalls=/tmp/a=b.zip', '--memory']).artifacts).toEqual([
      { sourceKey: 'nhtsa-recalls', path: '/tmp/a=b.zip' },
    ]);
  });

  it.each([
    [['--artifact'], /requires a value/],
    [['--artifact', 'no-separator', '--memory'], /<source-key>=<path>/],
    [['--artifact', '=/tmp/x.zip', '--memory'], /<source-key>=<path>/],
    [['--artifact', 'nhtsa-recalls=', '--memory'], /<source-key>=<path>/],
    [['--artifact', 'Bad_Key=/tmp/x.zip', '--memory'], /<source-key>=<path>/],
    [['--artifact', 'a=/x.zip', '--artifact', 'a=/y.zip', '--memory'], /more than once/],
    [['--max-records', '0'], /--max-records/],
    [['--max-records', '-5'], /requires a value|--max-records/],
    [['--max-records', '1e6'], /--max-records/],
    [['--max-records', String(MAX_CLI_RECORDS + 1)], /--max-records/],
    [['--evidence-dir'], /requires a value/],
    [['--bogus'], /Unknown option/],
    [['stray'], /Unexpected argument/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('requires durable evidence for any operator load on a persistent database (AGENTS.md rule 10)', () => {
    expect(() => parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip'])).toThrow(/--evidence-dir/);
    // A dry run still records the artifact row in a persistent database.
    expect(() => parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--dry-run'])).toThrow(/--evidence-dir/);
    expect(parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--memory']).memory).toBe(true);
    expect(parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--memory', '--dry-run']).dryRun).toBe(true);
    expect(
      parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--evidence-dir', '.data/evidence']).evidenceDir,
    ).toBe('.data/evidence');
  });

  it('only allows --source to narrow to one of the supplied artifacts', () => {
    expect(() =>
      parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--source', 'nhtsa-vpic', '--memory']),
    ).toThrow(/not one of the --artifact sources/);
    expect(
      parseArgs(['--artifact', 'nhtsa-recalls=/tmp/FLAT_RCL.zip', '--source', 'nhtsa-recalls', '--memory']).source,
    ).toBe('nhtsa-recalls');
  });
});
