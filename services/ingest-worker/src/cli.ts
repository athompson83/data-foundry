/**
 * `pnpm ingest --vertical hvac [--source <key>] [--dry-run]`
 *
 * Runs the whole factory offline: real vertical configuration, real migrations,
 * real extraction and normalization, real canonical storage — and the fixture
 * acquisition provider, so there are no credentials and no network calls. The
 * point is not convenience; it is that the offline path exercises the *same*
 * code as a live crawl, so "it works in CI" means something.
 *
 * Storage defaults to PGlite under `.data/pglite`, or real Postgres when
 * `POSTGRES_URL` is set. A real migration uses the separate approved
 * `DATA_FOUNDRY_MIGRATION_DATABASE_URL` credential. Identical SQL either way.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPgliteDriver,
  createPostgresDriver,
  type SqlDriver,
  type SqlParam,
} from '@data-foundry/canonical-store';
import { provenanceCoverage } from '@data-foundry/provenance';
import type { IsoDateTime } from '@data-foundry/canonical-schema';
import {
  applyMigrations,
  assertDirectPostgresPrivateSchema,
  assertRealPostgresSourceIdentity,
  createPostgresDriver as createMigrationPostgresDriver,
  loadMigrations,
  loadMigrationsFromGit,
  migrationDatabaseUrlFromEnv,
  realPostgresMigrationOptions,
  resolveOperationalSchema,
  type MigrationDriver,
} from '../../../tooling/scripts/migrate.js';
import { InMemoryArtifactStore } from './artifact-store.js';
import { Pipeline } from './pipeline.js';

export interface CliArgs {
  readonly vertical: string;
  readonly source: string | null;
  readonly dryRun: boolean;
  readonly memory: boolean;
  readonly runId: string | null;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let vertical = 'hvac';
  let source: string | null = null;
  let dryRun = false;
  let memory = false;
  let runId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vertical') vertical = String(argv[(index += 1)] ?? '');
    else if (arg === '--source') source = String(argv[(index += 1)] ?? '');
    else if (arg === '--run-id') runId = String(argv[(index += 1)] ?? '');
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--memory') memory = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}\n${USAGE}`);
    }
  }
  if (vertical === '') throw new Error(`--vertical requires a value\n${USAGE}`);
  return { vertical, source, dryRun, memory, runId };
}

const USAGE = `
Usage: pnpm ingest --vertical <slug> [--source <key>] [--dry-run] [--memory]

  --vertical <slug>  Vertical to ingest (default: hvac)
  --source <key>     Ingest a single declared source instead of all active ones
  --dry-run          Acquire, extract, normalize and resolve; write no claims
  --memory           Use a throwaway in-memory database
  --run-id <id>      Job idempotency scope; a repeated id rejoins the same jobs
`;

/**
 * PGlite in memory/on disk, or an explicitly selected real Data Foundry
 * schema. Live operations default to Alpha Lab's private schema; a legacy
 * public install requires an explicit DATA_FOUNDRY_SCHEMA=public opt-in.
 */
export function resolveRealPostgresSchema(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveOperationalSchema(env);
}

export interface RealIngestPostgresConnections {
  /** Least-privilege runtime connection used by the ingest pipeline. */
  readonly applicationConnectionString: string;
  /** Narrow credential used only by the single-client migration runner. */
  readonly migrationConnectionString: string;
}

/**
 * The ingest executable participates in a real database mutation, so attest
 * its checked-in source alongside the migration corpus and runner.
 */
export async function assertRealIngestSourceIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env,
  sourceIdentityGuard: typeof assertRealPostgresSourceIdentity = assertRealPostgresSourceIdentity,
): Promise<void> {
  await sourceIdentityGuard(env, {
    additionalSourcePaths: ['services/ingest-worker/src/cli.ts'],
  });
}

/**
 * A live ingestion uses its runtime identity for application work and a
 * separate dedicated migration identity before it opens the pipeline driver.
 */
export function resolveIngestRealPostgresConnections(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RealIngestPostgresConnections | undefined {
  const applicationConnectionString = env['POSTGRES_URL'];
  if (applicationConnectionString === undefined || applicationConnectionString.trim() === '') {
    return undefined;
  }

  const migrationConnectionString = migrationDatabaseUrlFromEnv(env);
  if (migrationConnectionString === undefined) {
    throw new Error(
      'DATA_FOUNDRY_MIGRATION_DATABASE_URL is required before real Postgres ingestion can run migrations.',
    );
  }
  return { applicationConnectionString, migrationConnectionString };
}

async function openDriver(args: CliArgs, realPostgresUrl?: string): Promise<SqlDriver> {
  if (args.memory) return createPgliteDriver();
  const url = realPostgresUrl;
  if (url !== undefined && url !== '') {
    return createPostgresDriver(url, { schema: resolveRealPostgresSchema() });
  }
  const dataDir = resolve(process.cwd(), '.data', 'pglite');
  await mkdir(dataDir, { recursive: true });
  return createPgliteDriver({ dataDir });
}

async function migrate(
  driver: SqlDriver,
): Promise<void> {
  const adapter: MigrationDriver = {
    label: driver.label,
    exec: (sql) => driver.exec(sql),
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await driver.query(sql, params as readonly SqlParam[] | undefined)) as T[],
    close: async () => undefined,
  };
  await applyMigrations(adapter, await loadMigrations());
}

/**
 * The canonical-store pg driver is a Pool, which is correct for application
 * work but deliberately unsuitable for a migration transaction split across
 * BEGIN, DDL, ledger write, and COMMIT. Use the migrator's single Client here.
 */
async function migrateRealPostgres(connectionString: string, schema: string): Promise<void> {
  const privateSchema = assertDirectPostgresPrivateSchema(schema);
  await assertRealIngestSourceIdentity();
  const driver = await createMigrationPostgresDriver(
    connectionString,
    privateSchema,
  );
  try {
    const releaseSha = process.env['DATA_FOUNDRY_RELEASE_SHA']?.trim() ?? '';
    await applyMigrations(
      driver,
      await loadMigrationsFromGit(releaseSha),
      realPostgresMigrationOptions(privateSchema),
    );
  } finally {
    await driver.close();
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const realPostgresConnections = args.memory
    ? undefined
    : resolveIngestRealPostgresConnections();
  if (realPostgresConnections !== undefined) {
    await migrateRealPostgres(
      realPostgresConnections.migrationConnectionString,
      resolveRealPostgresSchema(),
    );
  }

  const driver = await openDriver(args, realPostgresConnections?.applicationConnectionString);

  try {
    if (realPostgresConnections === undefined) await migrate(driver);

    const now = new Date().toISOString() as IsoDateTime;
    const pipeline = await Pipeline.create({
      driver,
      verticalSlug: args.vertical,
      artifactStore: new InMemoryArtifactStore(),
      now,
      ...(args.runId === null ? {} : { runId: args.runId }),
      dryRun: args.dryRun,
    });

    const result = await pipeline.runVertical(
      args.source === null ? {} : { sources: [args.source] },
    );

    let failed = 0;
    process.stdout.write(`\nvertical ${result.vertical.slug} (${driver.label})\n`);
    for (const source of result.sources) {
      const status = source.error === null ? 'ok ' : 'FAIL';
      process.stdout.write(
        `  ${status} ${source.sourceKey.padEnd(26)} ${source.finalState.padEnd(18)} ` +
          `${source.outcome.padEnd(13)} artifacts=${source.artifacts} records=${source.records} ` +
          `claims=${source.claims} edges=${source.relationships} normalization_failures=${source.normalizationFailures}\n`,
      );
      if (source.error !== null) {
        failed += 1;
        process.stdout.write(`       ${source.error}\n`);
      }
    }
    process.stdout.write(
      `  canonical values promoted: ${result.promoted}; ` +
        `resolution pairs proposed ${result.blocking.proposed}, rejected ${result.blocking.rejected}\n`,
    );

    if (!args.dryRun) {
      const coverage = await provenanceCoverage(driver, { vertical_id: result.vertical.id });
      process.stdout.write(
        `  provenance coverage: facts ${coverage.facts.traceable}/${coverage.facts.total} ` +
          `(${(coverage.facts.coverage * 100).toFixed(2)}%), relationships ` +
          `${coverage.relationships.traceable}/${coverage.relationships.total} ` +
          `(${(coverage.relationships.coverage * 100).toFixed(2)}%)\n`,
      );
      // Rule 2 is a gate, not a metric: a run that published an unevidenced
      // claim exits non-zero even when every source "succeeded".
      if (coverage.facts.coverage < 1 || coverage.relationships.coverage < 1) failed += 1;
    }

    for (const diagnostic of result.diagnostics) {
      process.stdout.write(`  note: ${diagnostic}\n`);
    }
    return failed === 0 ? 0 : 1;
  } finally {
    await driver.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('/src/cli.ts');
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (migrationDatabaseUrlFromEnv() !== undefined) {
        // A real ingest first consumes the dedicated migration credential;
        // avoid reflecting any driver/provider context into a terminal.
        process.stderr.write('Real PostgreSQL ingestion failed.\n');
      } else {
        process.stderr.write(
          `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
      }
      process.exitCode = 1;
    });
}
