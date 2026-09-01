/**
 * Migration runner.
 *
 * Applies `db/migrations/*.sql` in filename order against either:
 *   - PGlite (default) — local dev and CI, in-memory or persisted to `.data/pglite`;
 *   - real Postgres — when `DATA_FOUNDRY_MIGRATION_DATABASE_URL` is supplied
 *     through the approved secret interface (Supabase, RDS, a container).
 *
 * The SQL is identical in both cases. That is the point: if a migration only
 * applies to one of them, it is not portable Postgres and does not belong in
 * `db/migrations`.
 *
 * Usage:
 *   pnpm migrate                     # apply to .data/pglite
 *   pnpm migrate --memory            # apply to a throwaway in-memory database
 *   pnpm migrate:check               # CI gate: apply to a fresh database, verify, discard
 *   # supply DATA_FOUNDRY_MIGRATION_DATABASE_URL securely, then pnpm migrate
 *   # DATA_FOUNDRY_SCHEMA=public remains a reviewed legacy install opt-in
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { directPostgresTlsConfig } from '@data-foundry/canonical-store';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');
const execFileAsync = promisify(execFile);
export const MIGRATIONS_DIR = resolve(HERE, '..', '..', 'db', 'migrations');
/** The approved secret-bearing source for a direct real PostgreSQL migration. */
export const DATA_FOUNDRY_MIGRATION_DATABASE_URL_ENV = 'DATA_FOUNDRY_MIGRATION_DATABASE_URL';
const RELEASE_SHA = /^[0-9a-f]{40}$/;

export type GitRunner = (args: readonly string[]) => Promise<string>;

const runGit: GitRunner = async (args) => {
  const { stdout } = await execFileAsync('git', [...args], { encoding: 'utf8' });
  return stdout;
};

/**
 * Read the dedicated migration connection only. It deliberately does not
 * inherit a generic application `POSTGRES_URL`.
 */
export function migrationDatabaseUrlFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const candidate = env[DATA_FOUNDRY_MIGRATION_DATABASE_URL_ENV];
  return candidate !== undefined && candidate.trim() !== '' ? candidate : undefined;
}

/**
 * The direct migration CLI fails closed when a generic application connection
 * is present but the narrow migration credential was not supplied. With neither
 * variable, it retains the normal local/PGlite default.
 */
export function resolveDirectMigrationDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const migrationUrl = migrationDatabaseUrlFromEnv(env);
  if (migrationUrl !== undefined) return migrationUrl;

  const genericApplicationUrl = env['POSTGRES_URL'];
  if (genericApplicationUrl !== undefined && genericApplicationUrl.trim() !== '') {
    throw new Error(
      `${DATA_FOUNDRY_MIGRATION_DATABASE_URL_ENV} is required for real PostgreSQL migrations; POSTGRES_URL is not accepted by this runner.`,
    );
  }
  return undefined;
}

/**
 * Keep the direct secret path from reflecting a provider/driver error that
 * could contain connection context. Local credential-free runs retain useful
 * diagnostics for ordinary development failures.
 */
export function migrationFailureMessage(
  error: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (migrationDatabaseUrlFromEnv(env) !== undefined) {
    return 'Direct PostgreSQL migration failed.';
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export interface Migration {
  /** Numeric prefix, e.g. `0004`. Ordering key and ledger primary key. */
  readonly version: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

/** PostgreSQL's default application schema, retained for existing deployments. */
export const DEFAULT_SCHEMA = 'public';
/** The sole supported private schema for the Alpha Lab Data Foundry deployment. */
export const DATA_FOUNDRY_PRIVATE_SCHEMA = 'data_foundry';
/** The only direct login allowed to create or migrate the private schema. */
export const DATA_FOUNDRY_MIGRATION_ROLE = 'df_migration';

/**
 * The application may share a physical database only through an explicitly
 * named, ordinary PostgreSQL schema. This deliberately excludes quoted,
 * mixed-case, catalog, and punctuation-bearing identifiers so the schema can
 * be embedded safely in the handful of catalog/DDL statements that PostgreSQL
 * does not parameterize.
 */
export function normalizeSchemaName(value: string | undefined): string {
  const schema = value === undefined ? DEFAULT_SCHEMA : value.trim();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(
      `DATA_FOUNDRY_SCHEMA must be a lowercase PostgreSQL identifier, received ${JSON.stringify(value)}`,
    );
  }
  if (schema === 'pg_catalog' || schema === 'information_schema') {
    throw new Error(`DATA_FOUNDRY_SCHEMA may not name the ${schema} system schema`);
  }
  if (schema !== DEFAULT_SCHEMA && schema !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error(
      `DATA_FOUNDRY_SCHEMA must be "${DEFAULT_SCHEMA}" or the Alpha Lab private schema "${DATA_FOUNDRY_PRIVATE_SCHEMA}".`,
    );
  }
  return schema;
}

/**
 * Operational tools default to the Alpha Lab private schema but retain an
 * explicit `DATA_FOUNDRY_SCHEMA=public` opt-in for a reviewed legacy install.
 * Unlike the migration runner's historic public default, a new live utility
 * invocation must never quietly select a shared application's public schema.
 */
export function resolveOperationalSchema(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return normalizeSchemaName(env['DATA_FOUNDRY_SCHEMA'] ?? DATA_FOUNDRY_PRIVATE_SCHEMA);
}

/**
 * This delivery path never mutates a shared schema. Legacy public-schema work
 * remains a separately reviewed maintenance concern and cannot use the direct
 * migration credential or private-canary execution flow.
 */
export function assertDirectPostgresPrivateSchema(schema: string): typeof DATA_FOUNDRY_PRIVATE_SCHEMA {
  const normalized = normalizeSchemaName(schema);
  if (normalized !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error('Direct PostgreSQL execution may target only the data_foundry schema.');
  }
  return DATA_FOUNDRY_PRIVATE_SCHEMA;
}

/**
 * Bind a real database mutation to a reviewed, clean repository candidate.
 * The value is non-secret and is intentionally required only for real
 * PostgreSQL execution; local/PGlite paths remain dependency-free.
 */
export async function assertRealPostgresSourceIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Readonly<{
    repositoryRoot?: string | undefined;
    runGit?: GitRunner | undefined;
    /**
     * Declares an operation-specific executable dependency for call-site
     * clarity. Direct execution still attests the entire worktree so a
     * transitive import cannot escape the frozen candidate check.
     */
    additionalSourcePaths?: readonly string[] | undefined;
  }> = {},
): Promise<void> {
  const releaseSha = env['DATA_FOUNDRY_RELEASE_SHA']?.trim();
  if (releaseSha === undefined || !RELEASE_SHA.test(releaseSha)) {
    throw new Error('DATA_FOUNDRY_RELEASE_SHA must be the lowercase 40-character reviewed Git SHA.');
  }

  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const git = options.runGit ?? runGit;
  const headSha = (await git(['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD'])).trim();
  if (headSha !== releaseSha) {
    throw new Error(`DATA_FOUNDRY_RELEASE_SHA ${releaseSha} does not equal Git HEAD ${headSha}.`);
  }

  const additionalSourcePaths = options.additionalSourcePaths ?? [];
  if (additionalSourcePaths.some((path) => !/^[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..') || path.startsWith('/'))) {
    throw new Error('Executable migration source paths must be repository-relative paths.');
  }
  const relevantChanges = (
    await git([
      '-C',
      repositoryRoot,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
  ).trim();
  if (relevantChanges !== '') {
    throw new Error('The direct PostgreSQL worktree must be clean before execution.');
  }
}

function qualified(schema: string, relation: string): string {
  return `"${schema}"."${relation}"`;
}

/**
 * Initialize the destination before inspecting a ledger or applying DDL.
 * `public` is intentionally absent from a private deployment's search path:
 * an absent Data Foundry object must fail, never resolve to an Alpha Lab one.
 */
export interface PrepareSchemaOptions {
  /**
   * Direct private-role migrations run against a schema provisioned by the
   * owner.  Suppress CREATE SCHEMA there so the narrow migration role never
   * needs database-wide CREATE privilege.
   */
  readonly createPrivateSchema?: boolean | undefined;
}

export async function prepareSchema(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
  options: Readonly<PrepareSchemaOptions> = {},
): Promise<void> {
  const normalized = normalizeSchemaName(schema);
  if (normalized !== DEFAULT_SCHEMA) {
    const [extensions] = await driver.query<{ available: boolean; usable: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') AS available,
              COALESCE(
                (SELECT has_schema_privilege(current_user, n.oid, 'USAGE')
                   FROM pg_namespace n
                  WHERE n.nspname = 'extensions'),
                false
              ) AS usable`,
    );
    if (extensions?.available !== true || extensions.usable !== true) {
      throw new Error(
        'The private Data Foundry schema requires a separately provisioned and USAGE-authorized PostgreSQL "extensions" schema. ' +
          'Create and authorize that schema before migration; refusing a path that would fail only at Worker startup.',
      );
    }
    if (options.createPrivateSchema !== false) {
      await driver.exec(`CREATE SCHEMA IF NOT EXISTS "${normalized}"`);
    }
  }
  // Supabase keeps approved extensions in `extensions`; include it explicitly
  // so a private schema can resolve extension functions without falling back
  // to Alpha Lab's shared public namespace.
  await driver.exec(`SET search_path TO "${normalized}", pg_catalog, extensions`);
}

/**
 * Historical migrations are checksum-immutable. A small number use an
 * explicit public regclass only to scope a catalog probe; remap those probes
 * for a first private-schema install without editing the released SQL bytes.
 */
export function scopeMigrationSql(sql: string, schema: string = DEFAULT_SCHEMA): string {
  const normalized = normalizeSchemaName(schema);
  if (normalized === DEFAULT_SCHEMA) return sql;

  let scoped = sql.replace(
    /'public\.([a-z][a-z0-9_]*)'::regclass/g,
    (_match, relation: string) => `'${normalized}.${relation}'::regclass`,
  );

  // Constraint names are scoped to their relation, not to the database. These
  // historical probes predate shared-schema deployment and asked only whether
  // a name existed anywhere, so scope them while preserving the source SQL and
  // its ledger checksum for existing public installations.
  const constraintOwners: Readonly<Record<string, string>> = {
    sources_rights_publisher_fk: 'sources',
    source_artifacts_acquisition_route_allowed: 'source_artifacts',
    source_artifacts_acquisition_plan_nonempty: 'source_artifacts',
    source_artifacts_acquisition_jurisdiction_nonempty: 'source_artifacts',
    source_artifacts_acquisition_route_required: 'source_artifacts',
    source_artifacts_policy_snapshot_fk: 'source_artifacts',
    facts_output_kind_allowed: 'facts',
  };
  for (const [constraint, relation] of Object.entries(constraintOwners)) {
    // A name-only probe is only safe to rewrite when it is the complete
    // predicate inside the historical IF NOT EXISTS condition. Appending an
    // owner check to a broader predicate (for example `... OR TRUE`) could
    // leave a shared-schema lookup effective through SQL precedence.
    const knownProbe = new RegExp(
      String.raw`\b(?:[a-z_][a-z0-9_]*\.)?conname\s*=\s*'${constraint}'`,
      'gi',
    );
    const safelyScopedProbe = new RegExp(
      String.raw`\bWHERE\s+conname\s*=\s*'${constraint}'\s*(?=\))`,
      'gi',
    );
    const knownProbeCount = [...scoped.matchAll(knownProbe)].length;
    const safelyScopedProbeCount = [...scoped.matchAll(safelyScopedProbe)].length;
    if (knownProbeCount !== safelyScopedProbeCount) {
      throw new Error(
        `Cannot safely scope known constraint probe "${constraint}" for private schema ${normalized}; refusing a shared-schema catalog lookup.`,
      );
    }

    scoped = scoped.replace(
      safelyScopedProbe,
      `WHERE conname = '${constraint}' AND conrelid = '${normalized}.${relation}'::regclass`,
    );
  }

  if (/\bpublic\./i.test(scoped)) {
    throw new Error(
      'A private-schema migration still contains an explicit public relation; refusing to risk a shared schema.',
    );
  }
  return scoped;
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
 * A direct private-schema migration must authenticate as the narrow migration
 * principal. Direct migrations require the pre-provisioned private schema to
 * be owned by that principal before any DDL runs.
 */
export async function assertPrivateMigrationRoleBinding(
  driver: MigrationDriver,
  options: Readonly<{ schema?: string | undefined; requireSchemaOwner?: boolean }> = {},
): Promise<void> {
  const schema = normalizeSchemaName(options.schema ?? DATA_FOUNDRY_PRIVATE_SCHEMA);
  if (schema !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error('The private migration-role guard may be used only with the data_foundry schema.');
  }

  const [binding] = await driver.query<{ current_user: string; schema_owner: string | null }>(
    `SELECT current_user AS current_user,
            (
              SELECT owner.rolname
                FROM pg_namespace namespace
                JOIN pg_roles owner ON owner.oid = namespace.nspowner
               WHERE namespace.nspname = $1
            ) AS schema_owner`,
    [schema],
  );

  if (binding === undefined || binding.current_user !== DATA_FOUNDRY_MIGRATION_ROLE) {
    throw new Error(
      `Direct private-schema migrations must connect as ${DATA_FOUNDRY_MIGRATION_ROLE}; refusing before DDL.`,
    );
  }
  if (
    binding.schema_owner !== null &&
    binding.schema_owner !== DATA_FOUNDRY_MIGRATION_ROLE
  ) {
    throw new Error(
      `The ${schema} schema is owned by ${binding.schema_owner}, not ${DATA_FOUNDRY_MIGRATION_ROLE}; refusing before DDL.`,
    );
  }
  if (options.requireSchemaOwner === true && binding.schema_owner !== DATA_FOUNDRY_MIGRATION_ROLE) {
    throw new Error(
      `The ${schema} schema must be owned by ${DATA_FOUNDRY_MIGRATION_ROLE} after bootstrap.`,
    );
  }
}

/**
 * Written onto the ledger when this runner creates it, so that ownership is
 * something the database records rather than something we infer from a name or
 * a set of column names. Versioned, because a marker that cannot be superseded
 * is a marker that will have to be worked around.
 */
export const LEDGER_MARKER = 'data-foundry:schema_migrations:v1';

function ledgerDdl(schema: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${qualified(schema, LEDGER_TABLE)} (
    version      TEXT PRIMARY KEY,
    filename     TEXT        NOT NULL,
    checksum     TEXT        NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_ms INTEGER     NOT NULL
);
COMMENT ON TABLE ${qualified(schema, LEDGER_TABLE)} IS '${LEDGER_MARKER}';
`;
}

/** The columns `LEDGER_DDL` creates, sorted. */
export const LEDGER_COLUMNS = [
  'applied_at',
  'checksum',
  'execution_ms',
  'filename',
  'version',
] as const;

/** The columns of `schema_migrations` as it exists, sorted. Empty if absent. */
export async function ledgerColumns(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
): Promise<string[]> {
  const rows = await driver.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY column_name`,
    [normalizeSchemaName(schema), LEDGER_TABLE],
  );
  return rows.map((row) => row.column_name);
}

/** The ownership marker on `schema_migrations`, or null if it carries none. */
export async function ledgerMarker(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
): Promise<string | null> {
  const rows = await driver.query<{ marker: string | null }>(
    `SELECT obj_description(c.oid, 'pg_class') AS marker
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [normalizeSchemaName(schema), LEDGER_TABLE],
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
export async function assertLedgerIsOurs(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
): Promise<void> {
  const normalized = normalizeSchemaName(schema);
  const columns = await ledgerColumns(driver, normalized);
  if (columns.length === 0) return;

  const expected = [...LEDGER_COLUMNS];
  const shapeMatches =
    columns.length === expected.length && columns.every((name, i) => name === expected[i]);
  const marker = await ledgerMarker(driver, normalized);
  if (marker === LEDGER_MARKER && shapeMatches) return;

  const reason =
    marker === null
      ? 'it carries no ownership marker, so there is no evidence this project created it'
      : marker !== LEDGER_MARKER
        ? `it is marked as belonging to something else (${marker})`
        : `its marker is ours but its columns are not (${columns.join(', ')}; ` +
          `ours are ${expected.join(', ')})`;

  throw new Error(
      `A table named "${normalized}.${LEDGER_TABLE}" already exists here and is not Data Foundry's ledger: ` +
      `${reason}. Refusing to read or write it. Point the dedicated migration credential at a database of this ` +
      `project's own, or rename the existing table. If you know the table IS this project's ` +
      `— a ledger created before ownership was recorded — adopt it deliberately with: ` +
        `COMMENT ON TABLE ${normalized === DEFAULT_SCHEMA ? LEDGER_TABLE : qualified(normalized, LEDGER_TABLE)} IS '${LEDGER_MARKER}';`,
  );
}

const MIGRATION_FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

function migrationFromSql(filename: string, sql: string, seen: Set<string>): Migration {
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
  return {
    version,
    filename,
    sql,
    checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
  };
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  const seen = new Set<string>();

  for (const filename of entries) {
    const sql = await readFile(join(dir, filename), 'utf8');
    migrations.push(migrationFromSql(filename, sql, seen));
  }

  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${dir}`);
  }
  return migrations;
}

/**
 * Read the real-migration corpus from the immutable reviewed Git object, not
 * from worktree paths that could change after source identity was attested.
 * The SHA is already required to equal HEAD by `assertRealPostgresSourceIdentity`;
 * using the object directly closes the remaining read-after-check race.
 */
export async function loadMigrationsFromGit(
  releaseSha: string,
  options: Readonly<{
    repositoryRoot?: string | undefined;
    runGit?: GitRunner | undefined;
  }> = {},
): Promise<Migration[]> {
  if (!RELEASE_SHA.test(releaseSha)) {
    throw new Error('DATA_FOUNDRY_RELEASE_SHA must be the lowercase 40-character reviewed Git SHA.');
  }
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const git = options.runGit ?? runGit;
  const paths = (await git([
    '-C',
    repositoryRoot,
    'ls-tree',
    '-r',
    '--name-only',
    releaseSha,
    '--',
    'db/migrations',
  ]))
    .split(/\r?\n/u)
    .filter((path) => path.endsWith('.sql'))
    .sort();
  const migrations: Migration[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith('db/migrations/') || path.slice('db/migrations/'.length).includes('/')) {
      throw new Error('Attested migration tree contains an invalid migration path.');
    }
    const filename = path.slice('db/migrations/'.length);
    const sql = await git(['-C', repositoryRoot, 'show', `${releaseSha}:${path}`]);
    migrations.push(migrationFromSql(filename, sql, seen));
  }
  if (migrations.length === 0) {
    throw new Error('No migrations found in the attested Git revision.');
  }
  return migrations;
}

export interface AppliedMigration {
  readonly version: string;
  readonly filename: string;
  readonly skipped: boolean;
  readonly executionMs: number;
}

export interface ApplyMigrationsOptions {
  readonly schema?: string | undefined;
  /** Require the direct live migration role before private-schema DDL. */
  readonly requirePrivateMigrationRole?: boolean | undefined;
}

/**
 * Only direct, real private-schema execution may require the narrow migration
 * principal. The legacy public path remains an explicit reviewed opt-in.
 */
export function realPostgresMigrationOptions(schema: string): ApplyMigrationsOptions {
  const normalized = normalizeSchemaName(schema);
  return normalized === DATA_FOUNDRY_PRIVATE_SCHEMA
    ? { schema: normalized, requirePrivateMigrationRole: true }
    : { schema: normalized };
}

const PRIVATE_SCHEMA_TRANSFORM_VERSION = 'data-foundry-private-schema-v1';

/**
 * The ledger proves the exact SQL a schema received, not merely the immutable
 * historical source file. Public deployments retain their existing file SHA;
 * a private deployment also fingerprints its schema-specific transform so a
 * later transform change fails closed instead of silently skipping old rows.
 */
export function effectiveMigrationChecksum(
  migration: Migration,
  schema: string,
  effectiveSql: string,
): string {
  if (schema === DEFAULT_SCHEMA) return migration.checksum;
  return createHash('sha256')
    .update(`${PRIVATE_SCHEMA_TRANSFORM_VERSION}\u0000${effectiveSql}`, 'utf8')
    .digest('hex');
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
  options: Readonly<ApplyMigrationsOptions> = {},
): Promise<AppliedMigration[]> {
  const schema = normalizeSchemaName(options.schema);
  const requirePrivateMigrationRole = options.requirePrivateMigrationRole === true;
  if (requirePrivateMigrationRole && schema !== DATA_FOUNDRY_PRIVATE_SCHEMA) {
    throw new Error('The direct private migration role is valid only for the data_foundry schema.');
  }
  if (requirePrivateMigrationRole) {
    await assertPrivateMigrationRoleBinding(driver, { schema, requireSchemaOwner: true });
  }
  await assertNoLegacyPublicDataFoundryInstall(driver, schema);
  await prepareSchema(driver, schema, { createPrivateSchema: !requirePrivateMigrationRole });
  if (requirePrivateMigrationRole) {
    await assertPrivateMigrationRoleBinding(driver, { schema, requireSchemaOwner: true });
  }
  // Before anything is created or written, not after.
  await assertLedgerIsOurs(driver, schema);
  await driver.exec(ledgerDdl(schema));

  const rows = await driver.query<{ version: string; checksum: string; filename: string }>(
    `SELECT version, checksum, filename FROM ${qualified(schema, LEDGER_TABLE)}`,
  );
  const ledger = new Map(rows.map((row) => [row.version, row] as const));
  const results: AppliedMigration[] = [];

  for (const migration of migrations) {
    const effectiveSql = scopeMigrationSql(migration.sql, schema);
    const checksum = effectiveMigrationChecksum(migration, schema, effectiveSql);
    const existing = ledger.get(migration.version);
    if (existing !== undefined) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration ${migration.filename} has changed since it was applied ` +
          `(ledger ${existing.checksum.slice(0, 12)}, expected ${checksum.slice(0, 12)}). ` +
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
      await driver.exec(effectiveSql);
      const executionMs = Date.now() - startedAt;
      await driver.query(
        `INSERT INTO ${qualified(schema, LEDGER_TABLE)} (version, filename, checksum, execution_ms) VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.filename, checksum, executionMs],
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
  // PGlite does not model Supabase's extension namespace. Create the empty
  // namespace so private-schema migration tests exercise the same path shape.
  await db.exec('CREATE SCHEMA IF NOT EXISTS extensions');
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
export async function createPostgresDriver(
  connectionString: string,
  schema: string = DEFAULT_SCHEMA,
): Promise<MigrationDriver> {
  const normalized = normalizeSchemaName(schema);
  const pg = await import('pg');
  const tls = directPostgresTlsConfig(connectionString);
  const client = new pg.default.Client(
    normalized === DEFAULT_SCHEMA
      ? tls
      : { ...tls, options: `-csearch_path=${normalized},pg_catalog,extensions` },
  );
  await client.connect();
  return {
    // A direct migration credential is secret-bearing. Do not derive, retain,
    // or print a host component merely to decorate routine progress output.
    label: 'postgres (direct TLS)',
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
 * The dedicated migration credential points the migrator at whatever database
 * an operator names,
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
  'source_record_reconciliations',
  'source_stream_snapshot_acceptances',
  'source_stream_snapshot_acceptance_artifacts',
  'source_record_snapshot_retirements',
  'entities',
  'entity_aliases',
  'entity_alias_claims',
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

export async function listSchemaTables(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
): Promise<string[]> {
  const rows = await driver.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [normalizeSchemaName(schema)],
  );
  return rows.map((row) => row.table_name);
}

/**
 * A `--schema data_foundry` switch is a bootstrap, never an implicit data
 * migration. Refuse to create a second empty installation beside an existing
 * public Data Foundry database; moving historic rows needs an explicit,
 * reviewed migration plan. A private ledger the runner already owns is a
 * normal rerun and remains allowed even if a stale public footprint exists.
 */
export async function assertNoLegacyPublicDataFoundryInstall(
  driver: MigrationDriver,
  schema: string = DEFAULT_SCHEMA,
): Promise<void> {
  const normalized = normalizeSchemaName(schema);
  if (normalized === DEFAULT_SCHEMA) return;

  const targetMarker = await ledgerMarker(driver, normalized);
  if (targetMarker === LEDGER_MARKER) return;

  // Generic relation names such as `sources` and `facts` are not ownership
  // evidence in a shared Alpha Lab schema. Only the ledger marker proves this
  // project created the public installation.
  const publicMarker = await ledgerMarker(driver, DEFAULT_SCHEMA);
  if (publicMarker === LEDGER_MARKER) {
    throw new Error(
      `A public Data Foundry installation is already present; refusing to bootstrap ${normalized} beside it. ` +
        'Plan and review an explicit data migration instead of changing DATA_FOUNDRY_SCHEMA.',
    );
  }
}

/** Backwards-compatible public-schema inventory for existing callers/tests. */
export async function listPublicTables(driver: MigrationDriver): Promise<string[]> {
  return listSchemaTables(driver, DEFAULT_SCHEMA);
}

export function resolveSchema(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  fallbackSchema: string = DEFAULT_SCHEMA,
): string {
  const separateIndexes = argv
    .map((argument, index) => argument === '--schema' ? index : -1)
    .filter((index) => index !== -1);
  const inlineValues = argv
    .filter((argument) => argument.startsWith('--schema='))
    .map((argument) => argument.slice('--schema='.length));
  if (separateIndexes.length + inlineValues.length > 1) {
    throw new Error('--schema may be provided only once');
  }
  if (inlineValues.length === 1) return normalizeSchemaName(inlineValues[0]);
  const index = separateIndexes[0];
  if (index === undefined) return normalizeSchemaName(env['DATA_FOUNDRY_SCHEMA'] ?? fallbackSchema);
  const candidate = argv[index + 1];
  if (candidate === undefined || candidate.startsWith('--')) {
    throw new Error('--schema requires a lowercase PostgreSQL schema name');
  }
  return normalizeSchemaName(candidate);
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const memory = argv.includes('--memory') || check;
  const postgresUrl = check || memory ? undefined : resolveDirectMigrationDatabaseUrl();
  const usesRealPostgres = postgresUrl !== undefined && postgresUrl !== '' && !check;
  // Keep local PGlite/public compatibility, but never let a real database
  // invocation fall through to a shared `public` schema.
  const requestedSchema = resolveSchema(
    argv,
    process.env,
    usesRealPostgres ? DATA_FOUNDRY_PRIVATE_SCHEMA : DEFAULT_SCHEMA,
  );
  const schema = usesRealPostgres
    ? assertDirectPostgresPrivateSchema(requestedSchema)
    : requestedSchema;
  const migrations = usesRealPostgres
    ? await (async () => {
      await assertRealPostgresSourceIdentity();
      return loadMigrationsFromGit(process.env['DATA_FOUNDRY_RELEASE_SHA']?.trim() ?? '');
    })()
    : await loadMigrations();
  const driver =
    usesRealPostgres
      ? await createPostgresDriver(postgresUrl, schema)
      : await createPGliteDriver(memory ? undefined : resolve(process.cwd(), '.data', 'pglite'));

  try {
    console.log(`Applying ${migrations.length} migration(s) to ${driver.label}`);

    // Say so before writing, not after. An operator pointing the dedicated
    // migration credential at a database that already holds someone else's
    // tables should see that we noticed, and that we are adding beside them.
    const before = partitionOwnedTables(await listSchemaTables(driver, schema));
    if (before.unowned.length > 0) {
      console.log(
        `  note: ${before.unowned.length} table(s) in this database are not Data Foundry's ` +
          `(${before.unowned.join(', ')}). No migration references them.`,
      );
    }

    const migrationOptions = usesRealPostgres
      ? realPostgresMigrationOptions(schema)
      : { schema };
    const results = await applyMigrations(driver, migrations, migrationOptions);
    for (const result of results) {
      console.log(
        `  ${result.skipped ? 'skip ' : 'apply'} ${result.filename}` +
          (result.skipped ? ' (already applied)' : ` (${result.executionMs}ms)`),
      );
    }

    if (check) {
      const ownership = partitionOwnedTables(await listSchemaTables(driver, schema));
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
      const second = await applyMigrations(driver, migrations, migrationOptions);
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
      console.error(migrationFailureMessage(error));
      process.exitCode = 1;
    });
}
