/**
 * Migration runner.
 *
 * Applies `db/migrations/*.sql` in filename order against either:
 *   - PGlite (default) — local dev and CI, in-memory or persisted to `.data/pglite`;
 *   - real Postgres — when `POSTGRES_URL` is set (Supabase, RDS, a container).
 *
 * The SQL is identical in both cases. That is the point: if a migration only
 * applies to one of them, it is not portable Postgres and does not belong in
 * `db/migrations`.
 *
 * Usage:
 *   pnpm migrate                     # apply to .data/pglite
 *   pnpm migrate --memory            # apply to a throwaway in-memory database
 *   pnpm migrate:check               # CI gate: apply to a fresh database, verify, discard
 *   POSTGRES_URL=... pnpm migrate    # apply to real Postgres
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'db', 'migrations');

export interface Migration {
  /** Numeric prefix, e.g. `0004`. Ordering key and ledger primary key. */
  readonly version: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

/**
 * Minimal driver surface. Both PGlite and `pg` satisfy it, which keeps the
 * runner free of any database-specific behaviour.
 */
export interface MigrationDriver {
  readonly label: string;
  /** Execute a script that may contain multiple statements. */
  exec(sql: string): Promise<void>;
  /** Execute a single parameterised statement and return rows. */
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      TEXT PRIMARY KEY,
    filename     TEXT        NOT NULL,
    checksum     TEXT        NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_ms INTEGER     NOT NULL
);
`;

const MIGRATION_FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  const seen = new Set<string>();

  for (const filename of entries) {
    const match = MIGRATION_FILENAME.exec(filename);
    if (match === null) {
      throw new Error(
        `Migration "${filename}" does not match NNNN_snake_case_name.sql. Ordering must be unambiguous.`,
      );
    }
    const version = match[1] as string;
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version ${version} (${filename}).`);
    }
    seen.add(version);

    const sql = await readFile(join(dir, filename), 'utf8');
    migrations.push({
      version,
      filename,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${dir}`);
  }
  return migrations;
}

export interface AppliedMigration {
  readonly version: string;
  readonly filename: string;
  readonly skipped: boolean;
  readonly executionMs: number;
}

/**
 * Apply every pending migration in order, each in its own transaction.
 *
 * Re-running is safe: already-applied versions are skipped by the ledger, and a
 * checksum mismatch is a hard error rather than a silent no-op — editing a
 * migration that has shipped is how two environments quietly diverge.
 */
export async function applyMigrations(
  driver: MigrationDriver,
  migrations: readonly Migration[],
): Promise<AppliedMigration[]> {
  await driver.exec(LEDGER_DDL);

  const rows = await driver.query<{ version: string; checksum: string; filename: string }>(
    'SELECT version, checksum, filename FROM schema_migrations',
  );
  const ledger = new Map(rows.map((row) => [row.version, row] as const));
  const results: AppliedMigration[] = [];

  for (const migration of migrations) {
    const existing = ledger.get(migration.version);
    if (existing !== undefined) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} has changed since it was applied ` +
            `(ledger ${existing.checksum.slice(0, 12)}, file ${migration.checksum.slice(0, 12)}). ` +
            `Applied migrations are immutable — add a new migration instead.`,
        );
      }
      results.push({
        version: migration.version,
        filename: migration.filename,
        skipped: true,
        executionMs: 0,
      });
      continue;
    }

    const startedAt = Date.now();
    await driver.exec('BEGIN');
    try {
      await driver.exec(migration.sql);
      const executionMs = Date.now() - startedAt;
      await driver.query(
        'INSERT INTO schema_migrations (version, filename, checksum, execution_ms) VALUES ($1, $2, $3, $4)',
        [migration.version, migration.filename, migration.checksum, executionMs],
      );
      await driver.exec('COMMIT');
      results.push({
        version: migration.version,
        filename: migration.filename,
        skipped: false,
        executionMs,
      });
    } catch (error) {
      await driver.exec('ROLLBACK').catch(() => undefined);
      throw new Error(
        `Migration ${migration.filename} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  return results;
}

/** PGlite driver. `dataDir` of `undefined` means in-memory. */
export async function createPGliteDriver(dataDir?: string): Promise<MigrationDriver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  await db.waitReady;
  return {
    label: dataDir === undefined ? 'pglite (memory)' : `pglite (${dataDir})`,
    async exec(sql) {
      await db.exec(sql);
    },
    async query<T>(sql: string, params?: readonly unknown[]) {
      const result = await db.query<T>(sql, params === undefined ? undefined : [...params]);
      return result.rows;
    },
    async close() {
      await db.close();
    },
  };
}

/** Real Postgres driver. `pg` is only imported when a connection string exists. */
export async function createPostgresDriver(connectionString: string): Promise<MigrationDriver> {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString });
  await client.connect();
  return {
    label: `postgres (${new URL(connectionString).host})`,
    async exec(sql) {
      await client.query(sql);
    },
    async query<T>(sql: string, params?: readonly unknown[]) {
      const result = await client.query(sql, params === undefined ? undefined : [...params]);
      return result.rows as T[];
    },
    async close() {
      await client.end();
    },
  };
}

/** Table names the migrations are expected to create. Used by `--check`. */
export const EXPECTED_TABLES = [
  'verticals',
  'sources',
  'source_artifacts',
  'source_records',
  'entities',
  'entity_aliases',
  'entity_redirects',
  'facts',
  'fact_evidence',
  'relationships',
  'relationship_evidence',
  'resolution_candidates',
  'resolution_judgments',
  'dataset_snapshots',
  'media_assets',
  'ingestion_jobs',
  'ingestion_job_transitions',
] as const;

export async function listPublicTables(driver: MigrationDriver): Promise<string[]> {
  const rows = await driver.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const memory = argv.includes('--memory') || check;
  const postgresUrl = process.env['POSTGRES_URL'];

  const migrations = await loadMigrations();
  const driver =
    postgresUrl !== undefined && postgresUrl !== '' && !check
      ? await createPostgresDriver(postgresUrl)
      : await createPGliteDriver(memory ? undefined : resolve(process.cwd(), '.data', 'pglite'));

  try {
    console.log(`Applying ${migrations.length} migration(s) to ${driver.label}`);
    const results = await applyMigrations(driver, migrations);
    for (const result of results) {
      console.log(
        `  ${result.skipped ? 'skip ' : 'apply'} ${result.filename}` +
          (result.skipped ? ' (already applied)' : ` (${result.executionMs}ms)`),
      );
    }

    if (check) {
      const tables = await listPublicTables(driver);
      const missing = EXPECTED_TABLES.filter((table) => !tables.includes(table));
      if (missing.length > 0) {
        console.error(`Missing expected tables: ${missing.join(', ')}`);
        return 1;
      }

      // Re-applying against the same database must be a clean no-op.
      const second = await applyMigrations(driver, migrations);
      const reapplied = second.filter((result) => !result.skipped);
      if (reapplied.length > 0) {
        console.error(
          `Re-run was not idempotent; re-applied: ${reapplied.map((r) => r.filename).join(', ')}`,
        );
        return 1;
      }
      console.log(`OK: ${tables.length} tables, migrations are ordered and idempotent.`);
    }
    return 0;
  } finally {
    await driver.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
