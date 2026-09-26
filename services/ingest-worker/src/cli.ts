/**
 * `pnpm ingest --vertical hvac [--source <key>] [--dry-run]`
 * `pnpm ingest --vertical vehicles --artifact <source-key>=<file> [--max-records N] --evidence-dir <dir>`
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
 *
 * `--artifact` is the operator bulk-load path for a source whose published file
 * is too large for any scheduled route: the downloaded file (a ZIP archive when
 * that is what the publisher ships) replaces the fixture set and goes through
 * the same acquisition provider, rights gates and pipeline. It never bypasses a
 * rights or status gate. Unless the database is a throwaway `--memory` one,
 * the run must name `--evidence-dir`, so the raw artifact survives the process
 * (AGENTS.md rule 10).
 */
import { mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { LocalFsArtifactStore, type ArtifactStore } from '@data-foundry/acquisition';
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
import type { OperatorArtifact } from './operator-artifacts.js';
import { Pipeline } from './pipeline.js';

export interface CliArgs {
  readonly vertical: string;
  readonly source: string | null;
  readonly dryRun: boolean;
  readonly memory: boolean;
  readonly runId: string | null;
  /** Operator-supplied files, `--artifact <source-key>=<path>`; replaces the fixture set. */
  readonly artifacts: readonly OperatorArtifact[];
  /** Extracted-record ceiling per source; `null` keeps the pipeline default. */
  readonly maxRecords: number | null;
  /** Durable raw-evidence directory (local-disk artifact store). */
  readonly evidenceDir: string | null;
}

/** Upper bound for `--max-records`; a larger load needs a partitioned design, not a flag. */
export const MAX_CLI_RECORDS = 5_000_000;

export function parseArgs(argv: readonly string[]): CliArgs {
  let vertical = 'hvac';
  let source: string | null = null;
  let dryRun = false;
  let memory = false;
  let runId: string | null = null;
  let maxRecords: number | null = null;
  let evidenceDir: string | null = null;
  const artifacts: OperatorArtifact[] = [];

  const valueOf = (option: string, index: number): string => {
    const value = argv[index];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`${option} requires a value\n${USAGE}`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--vertical') vertical = String(argv[(index += 1)] ?? '');
    else if (arg === '--source') source = String(argv[(index += 1)] ?? '');
    else if (arg === '--run-id') runId = String(argv[(index += 1)] ?? '');
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--memory') memory = true;
    else if (arg === '--artifact') {
      const value = valueOf(arg, (index += 1));
      const separator = value.indexOf('=');
      const sourceKey = separator < 0 ? '' : value.slice(0, separator);
      const path = separator < 0 ? '' : value.slice(separator + 1);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceKey) || path === '') {
        throw new Error(`--artifact expects <source-key>=<path>, got ${JSON.stringify(value)}\n${USAGE}`);
      }
      if (artifacts.some((artifact) => artifact.sourceKey === sourceKey)) {
        throw new Error(`--artifact names source "${sourceKey}" more than once`);
      }
      artifacts.push({ sourceKey, path });
    } else if (arg === '--max-records') {
      const value = valueOf(arg, (index += 1));
      const parsed = /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
      if (!Number.isSafeInteger(parsed) || parsed > MAX_CLI_RECORDS) {
        throw new Error(`--max-records must be an integer from 1 to ${MAX_CLI_RECORDS}, got ${JSON.stringify(value)}`);
      }
      maxRecords = parsed;
    } else if (arg === '--evidence-dir') evidenceDir = valueOf(arg, (index += 1));
    else if (arg === '--') continue;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}\n${USAGE}`);
    } else if (arg !== undefined) {
      throw new Error(`Unexpected argument ${JSON.stringify(arg)}\n${USAGE}`);
    }
  }
  if (vertical === '') throw new Error(`--vertical requires a value\n${USAGE}`);
  if (artifacts.length > 0) {
    if (source !== null && !artifacts.some((artifact) => artifact.sourceKey === source)) {
      throw new Error(`--source ${source} is not one of the --artifact sources`);
    }
    // Rule 10: any run against a persistent database records the operator
    // file as a source artifact (a dry run too), so the bytes must outlive the
    // process. Only a throwaway `--memory` database may use the in-memory store.
    if (!memory && evidenceDir === null) {
      throw new Error(
        '--artifact requires --evidence-dir <dir> unless --memory: ' +
          'the raw artifact is the evidence for every record it produces (AGENTS.md rule 10)',
      );
    }
  }
  return { vertical, source, dryRun, memory, runId, artifacts, maxRecords, evidenceDir };
}

const USAGE = `
Usage: pnpm ingest --vertical <slug> [--source <key>] [--dry-run] [--memory]
       pnpm ingest --vertical <slug> --artifact <source-key>=<path> [...] [--max-records <n>]
                   (--evidence-dir <dir> | --memory) [--dry-run]

  --vertical <slug>        Vertical to ingest (default: hvac)
  --source <key>           Ingest a single declared source instead of all active ones
  --dry-run                Acquire, extract, normalize and resolve; write no claims
  --memory                 Use a throwaway in-memory database
  --run-id <id>            Job idempotency scope; a repeated id rejoins the same jobs
  --artifact <key>=<path>  Load a downloaded bulk file (.zip/.csv/.tsv/.txt/.json) for a
                           source instead of its fixture; repeatable. Rights and status
                           gates apply exactly as for any acquisition.
  --max-records <n>        Extracted-record ceiling per source (default 100000)
  --evidence-dir <dir>     Keep raw artifacts in a local evidence tree (R2 key layout)
`;

/** pnpm runs package scripts in the package directory; resolve against where the operator typed. */
const operatorPath = (path: string, env: Readonly<Record<string, string | undefined>>): string =>
  isAbsolute(path) ? path : resolve(env['INIT_CWD'] ?? process.cwd(), path);

/**
 * Live Postgres ingestion is restricted to Alpha Lab's private schema.
 * Historical public installations require a separately reviewed migration
 * plan; they are not selectable through the live ingestion environment.
 */
export function resolveRealPostgresSchema(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return assertDirectPostgresPrivateSchema(resolveOperationalSchema(env));
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

async function openDriver(
  args: CliArgs,
  realPostgresUrl?: string,
  realPostgresSchema?: string,
): Promise<SqlDriver> {
  if (args.memory) return createPgliteDriver();
  const url = realPostgresUrl;
  if (url !== undefined && url !== '') {
    if (realPostgresSchema === undefined) {
      throw new Error('A validated real Postgres schema is required before opening the ingestion driver.');
    }
    return createPostgresDriver(url, { schema: realPostgresSchema });
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

export interface IngestCliDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam: a vertical tree other than the repository's. */
  readonly verticalsDir?: string;
  /** Test seam: the raw evidence store. */
  readonly artifactStore?: ArtifactStore;
  readonly migrateRealPostgres?: (connectionString: string, schema: string) => Promise<void>;
  readonly openDriver?: (
    args: CliArgs,
    realPostgresUrl?: string,
    realPostgresSchema?: string,
  ) => Promise<SqlDriver>;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: IngestCliDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const args = parseArgs(argv);
  const realPostgresConnections = args.memory
    ? undefined
    : resolveIngestRealPostgresConnections(env);
  const realPostgres = realPostgresConnections === undefined
    ? undefined
    : {
      connections: realPostgresConnections,
      schema: resolveRealPostgresSchema(env),
    };
  if (realPostgres !== undefined) {
    await (dependencies.migrateRealPostgres ?? migrateRealPostgres)(
      realPostgres.connections.migrationConnectionString,
      realPostgres.schema,
    );
  }

  const driver = await (dependencies.openDriver ?? openDriver)(
    args,
    realPostgres?.connections.applicationConnectionString,
    realPostgres?.schema,
  );

  try {
    if (realPostgresConnections === undefined) await migrate(driver);

    const now = new Date().toISOString() as IsoDateTime;
    const artifacts = args.artifacts.map((artifact) => ({
      sourceKey: artifact.sourceKey,
      path: operatorPath(artifact.path, env),
    }));
    const artifactStore =
      dependencies.artifactStore ??
      (args.evidenceDir === null
        ? new InMemoryArtifactStore()
        : new LocalFsArtifactStore({ baseDir: operatorPath(args.evidenceDir, env) }));
    const pipeline = await Pipeline.create({
      driver,
      verticalSlug: args.vertical,
      ...(dependencies.verticalsDir === undefined ? {} : { verticalsDir: dependencies.verticalsDir }),
      artifactStore,
      now,
      ...(args.runId === null ? {} : { runId: args.runId }),
      dryRun: args.dryRun,
      ...(artifacts.length === 0 ? {} : { operatorArtifacts: artifacts }),
      ...(args.maxRecords === null ? {} : { maxRecords: args.maxRecords }),
    });

    // Operator artifacts name their sources explicitly; the rights and status
    // gates inside the pipeline still decide whether each may run.
    const sources =
      args.source !== null
        ? [args.source]
        : artifacts.length > 0
          ? artifacts.map((artifact) => artifact.sourceKey)
          : null;
    const result = await pipeline.runVertical(sources === null ? {} : { sources });

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
