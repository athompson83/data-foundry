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

/**
 * Written onto the ledger when this runner creates it, so that ownership is
 * something the database records rather than something we infer from a name or
 * a set of column names. Versioned, because a marker that cannot be superseded
 * is a marker that will have to be worked around.
 */
export const LEDGER_MARKER = 'data-foundry:schema_migrations:v1';

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      TEXT PRIMARY KEY,
    filename     TEXT        NOT NULL,
    checksum     TEXT        NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_ms INTEGER     NOT NULL
);
COMMENT ON TABLE schema_migrations IS '${LEDGER_MARKER}';
`;

/** The columns `LEDGER_DDL` creates, sorted. */
export const LEDGER_COLUMNS = [
  'applied_at',
  'checksum',
  'execution_ms',
  'filename',
  'version',
] as const;

/** The columns of `schema_migrations` as it exists, sorted. Empty if absent. */
export async function ledgerColumns(driver: MigrationDriver): Promise<string[]> {
  const rows = await driver.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY column_name`,
    [LEDGER_TABLE],
  );
  return rows.map((row) => row.column_name);
}

/** The ownership marker on `schema_migrations`, or null if it carries none. */
export async function ledgerMarker(driver: MigrationDriver): Promise<string | null> {
  const rows = await driver.query<{ marker: string | null }>(
    `SELECT obj_description(c.oid, 'pg_class') AS marker
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [LEDGER_TABLE],
  );
  return rows[0]?.marker ?? null;
}

/**
 * Refuse to write to a ledger this project cannot prove it created.
 *
 * `schema_migrations` is what Rails, sqlx and plenty of hand-rolled runners
 * call theirs, so in a shared database `CREATE TABLE IF NOT EXISTS` quietly
 * resolves a collision into an adoption and the next statement writes a row
 * into somebody else's bookkeeping.
 *
 * Matching columns would only narrow that, not close it: shape is evidence that
 * two ledgers are *compatible*, never that they are the same one. So the runner
 * records who made the table, and reads that back before it writes. The marker
 * is written at creation and never onto a table this runner merely found —
 * stamping a table in order to establish permission to write to it is the same
 * circular reasoning performed in two steps.
 *
 * Fail closed in every direction: absent is ours to create, marked-as-ours is
 * ours to append to, and anything else — another project's marker, no marker at
 * all, or our marker on a table of the wrong shape — stops the run before a
 * single write, and says which of those it found.
 */
export async function assertLedgerIsOurs(driver: MigrationDriver): Promise<void> {
  const columns = await ledgerColumns(driver);
  if (columns.length === 0) return;

  const expected = [...LEDGER_COLUMNS];
  const shapeMatches =
    columns.length === expected.length && columns.every((name, i) => name === expected[i]);
  const marker = await ledgerMarker(driver);
  if (marker === LEDGER_MARKER && shapeMatches) return;

  const reason =
    marker === null
      ? 'it carries no ownership marker, so there is no evidence this project created it'
      : marker !== LEDGER_MARKER
        ? `it is marked as belonging to something else (${marker})`
        : `its marker is ours but its columns are not (${columns.join(', ')}; ` +
          `ours are ${expected.join(', ')})`;

  throw new Error(
    `A table named "${LEDGER_TABLE}" already exists here and is not Data Foundry's ledger: ` +
      `${reason}. Refusing to read or write it. Point POSTGRES_URL at a database of this ` +
      `project's own, or rename the existing table. If you know the table IS this project's ` +
      `— a ledger created before ownership was recorded — adopt it deliberately with: ` +
      `COMMENT ON TABLE ${LEDGER_TABLE} IS '${LEDGER_MARKER}';`,
  );
}

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
  // Before anything is created or written, not after.
  await assertLedgerIsOurs(driver);
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

/**
 * The ownership manifest: every table Data Foundry creates, and the complete
 * set it is entitled to speak about.
 *
 * `POSTGRES_URL` points the migrator at whatever database an operator names,
 * and that database may belong to something else. Nothing here will modify a
 * table it did not create — no migration references one, and a test asserts
 * that none ever does — but a certification that counted the whole `public`
 * schema was reporting other people's tables as though they were evidence
 * about ours. Anything absent from this list is out of scope: reported, never
 * counted, never touched.
 *
 * Membership is decided by name, which is safe only because the one name that
 * is not distinctive — the ledger — has to prove itself before any write:
 * `assertLedgerIsOurs` aborts the run rather than let a `schema_migrations`
 * this project cannot show it created be counted here as ours.
 */
export const LEDGER_TABLE = 'schema_migrations';

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
  'fact_verifications',
  'relationships',
  'relationship_evidence',
  'resolution_candidates',
  'resolution_judgments',
  'dataset_snapshots',
  'media_assets',
  'ingestion_jobs',
  'ingestion_job_transitions',
  'api_tenants',
  'api_keys',
  'api_route_keys',
  'api_usage_events',
  'acquisition_policy_snapshots',
  'rights_publishers',
  'rights_evidence_artifacts',
  'rights_terms_cells',
  'rights_terms_versions',
  'rights_terms_activation_events',
  'rights_field_groups',
  'rights_field_group_members',
  'rights_cells',
  'rights_decisions',
  'rights_decision_conditions',
  'rights_decision_activation_events',
  'rights_deny_exceptions',
  'rights_migration_assessments',
  'entity_evidence',
  'fact_dependencies',
  'scheduled_acquisition_runs',
  'scheduled_acquisition_run_artifacts',
] as const;

/** Owned tables present, unowned tables found beside them, and owned tables missing. */
export interface TableOwnership {
  readonly owned: string[];
  readonly unowned: string[];
  readonly missing: string[];
}

/**
 * Split what is actually in the schema against what this project owns.
 *
 * Fail-closed on our side (`missing` is a hard error for `--check`), and merely
 * descriptive on the other (`unowned` is named so an operator can see we found
 * it and left it alone).
 */
export function partitionOwnedTables(tables: readonly string[]): TableOwnership {
  // The ledger belongs to this project too. The runner creates it and inserts a
  // row per applied migration, so calling it "not ours, untouched" was false in
  // both halves at once: we own it, and we write to it on every single run.
  const manifest = new Set<string>([...EXPECTED_TABLES, LEDGER_TABLE]);
  const present = new Set(tables);
  return {
    owned: tables.filter((table) => manifest.has(table)).sort(),
    unowned: tables.filter((table) => !manifest.has(table)).sort(),
    missing: EXPECTED_TABLES.filter((table) => !present.has(table)),
  };
}

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

    // Ask this first: a colliding ledger makes the notice below wrong (it would
    // count the foreign table as ours), and the operator needs the specific
    // error, not a reassuring line followed by one.
    await assertLedgerIsOurs(driver);

    // Say so before writing, not after. An operator pointing POSTGRES_URL at a
    // database that already holds someone else's tables should see that we
    // noticed, and that we are adding beside them rather than to them.
    const before = partitionOwnedTables(await listPublicTables(driver));
    if (before.unowned.length > 0) {
      console.log(
        `  note: ${before.unowned.length} table(s) in this database are not Data Foundry's ` +
          `(${before.unowned.join(', ')}). No migration references them.`,
      );
    }

    const results = await applyMigrations(driver, migrations);
    for (const result of results) {
      console.log(
        `  ${result.skipped ? 'skip ' : 'apply'} ${result.filename}` +
          (result.skipped ? ' (already applied)' : ` (${result.executionMs}ms)`),
      );
    }

    if (check) {
      const ownership = partitionOwnedTables(await listPublicTables(driver));
      if (ownership.missing.length > 0) {
        console.error(`Missing expected tables: ${ownership.missing.join(', ')}`);
        return 1;
      }
      if (ownership.unowned.length > 0) {
        console.log(
          `  out of scope (present, not ours, untouched): ${ownership.unowned.join(', ')}`,
        );
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
      console.log(
        `OK: ${ownership.owned.length} Data Foundry tables, migrations are ordered and idempotent.`,
      );
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
