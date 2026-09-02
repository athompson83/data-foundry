/**
 * The one small database abstraction the canonical layer is allowed to have.
 *
 * Everything above this file writes plain, portable Postgres 14+ SQL. The only
 * thing that differs between local dev/tests (PGlite, Postgres compiled to
 * WASM) and production (`pg` against Supabase/RDS/a container) is who executes
 * the string. There is no ORM, no query builder and no dialect switch: if a
 * statement needs a driver-specific branch it is not portable SQL and does not
 * belong in this package.
 *
 * `SqlExecutor` is deliberately narrower than `SqlDriver`. Anything that runs
 * inside `transaction()` receives an executor, which makes it impossible to
 * accidentally issue a second, *non-transactional* statement from inside a
 * transaction body — the mistake that would quietly let a fact commit without
 * its evidence.
 */
import { DriverCapabilityError } from './errors.js';

/** Values that may be bound to a `$n` placeholder. */
export type SqlParam = string | number | boolean | null;

export type SqlRow = Record<string, unknown>;

export interface SqlExecutor {
  query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<R[]>;
}

declare const transactionExecutorBrand: unique symbol;

/** A pinned executor issued only by SqlDriver.transaction(). */
export interface SqlTransactionExecutor extends SqlExecutor {
  readonly [transactionExecutorBrand]: true;
}

export interface SqlDriver extends SqlExecutor {
  /** Human-readable identity for logs and test output. */
  readonly label: string;
  readonly dialect: 'pglite' | 'postgres';
  /** Stable owner for connection-level capability probes across bound views. */
  readonly capabilityCacheKey?: object;
  /** Multi-statement script execution (DDL, extension setup). */
  exec(sql: string): Promise<void>;
  /**
   * Run `fn` inside a single transaction on a single connection. The
   * transaction commits when `fn` resolves and rolls back when it throws —
   * there is no partial-commit path.
   */
  transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The bundled `pg_trgm` contrib extension, imported lazily and optionally. */
type PgTrgmExtension = (typeof import('@electric-sql/pglite/contrib/pg_trgm'))['pg_trgm'];

export interface PgliteDriverOptions {
  /** Omit for an in-memory database (tests). */
  readonly dataDir?: string;
  /**
   * Load the bundled `pg_trgm` contrib extension and create it if possible.
   * Trigram similarity is an *optional* accelerator for fuzzy text ranking;
   * exact identifier lookup never depends on it (AGENTS.md rule 7).
   */
  readonly trigram?: boolean;
}

/** Connection-level controls for a real PostgreSQL pool. */
export interface PostgresDriverOptions {
  /**
   * Bind every physical pool connection to this explicit schema at PostgreSQL
   * startup. This is intentionally a startup setting, not a query-local SET:
   * a pool can open a fresh connection for any later request. Omit this only
   * for the historic unbound compatibility mode.
   */
  readonly schema?: string;
}

/** The only schema Data Foundry Workers may use in Alpha Lab production. */
export const DATA_FOUNDRY_PRIVATE_SCHEMA = 'data_foundry';

export interface PrivateSchemaSession extends SqlRow {
  readonly current_schema: string | null;
  readonly has_target_schema: boolean;
  readonly has_catalog_schema: boolean;
  readonly has_extensions_schema: boolean;
  readonly has_public_schema: boolean;
}

function normalizePostgresSchemaName(value: string): string {
  const schema = value.trim();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('Postgres schema must be a lowercase PostgreSQL identifier.');
  }
  if (schema === 'pg_catalog' || schema === 'information_schema') {
    throw new Error(`Postgres schema may not name the ${schema} system schema.`);
  }
  return schema;
}

/**
 * libpq-compatible startup options for an explicitly bound Data Foundry session.
 *
 * `options` is sent when every physical PostgreSQL connection is created, so
 * it cannot race a first application query on a fresh Pool client.
 */
export function postgresStartupOptionsForSchema(schema: string): string {
  const normalized = normalizePostgresSchemaName(schema);
  return `-csearch_path=${normalized},pg_catalog,extensions`;
}

/** Refuse a pool connection whose effective path could reach shared public data. */
export function assertPrivateSchemaSession(
  schema: string,
  session: PrivateSchemaSession | undefined,
): void {
  const normalized = normalizePostgresSchemaName(schema);
  if (
    session === undefined ||
    session.current_schema !== normalized ||
    session.has_target_schema !== true ||
    session.has_catalog_schema !== true ||
    session.has_extensions_schema !== true ||
    session.has_public_schema !== false
  ) {
    throw new Error(
      `Postgres session is not isolated to ${normalized}; it must include pg_catalog and extensions and exclude public.`,
    );
  }
}

/**
 * PGlite driver — local dev, CI and every test in this repo.
 *
 * PGlite is single-connection, so `transaction()` delegates to PGlite's own
 * transaction support rather than issuing BEGIN/COMMIT by hand.
 */
export async function createPgliteDriver(
  options: PgliteDriverOptions = {},
): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite');

  const wantsTrigram = options.trigram ?? true;
  let trigramExtension: PgTrgmExtension | null = null;
  if (wantsTrigram) {
    try {
      const contrib = await import('@electric-sql/pglite/contrib/pg_trgm');
      trigramExtension = contrib.pg_trgm;
    } catch {
      trigramExtension = null;
    }
  }

  const extensions = trigramExtension === null ? {} : { pg_trgm: trigramExtension };

  const db =
    options.dataDir === undefined
      ? new PGlite({ extensions })
      : new PGlite(options.dataDir, { extensions });
  await db.waitReady;

  if (trigramExtension !== null) {
    // Additive and idempotent. Never a migration: the canonical schema must
    // apply identically on a host where pg_trgm is unavailable.
    try {
      await db.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } catch {
      /* ranking falls back to portable SQL; see query-model/search. */
    }
  }

  return {
    label: options.dataDir === undefined ? 'pglite (memory)' : `pglite (${options.dataDir})`,
    dialect: 'pglite',
    async exec(sql) {
      await db.exec(sql);
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      const result = await db.query<R>(sql, params === undefined ? undefined : [...params]);
      return result.rows;
    },
    async transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      const outcome = await db.transaction(async (tx) => {
        const executor = {
          async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
            const result = await tx.query<R>(sql, params === undefined ? undefined : [...params]);
            return result.rows;
          },
        } as SqlTransactionExecutor;
        return await fn(executor);
      });
      // PGlite types the transaction result as `T | undefined` because the
      // callback may be aborted; an aborted transaction throws, so reaching
      // here with `undefined` can only mean `fn` returned `undefined`.
      return outcome as T;
    },
    async close() {
      await db.close();
    },
  };
}

function hasCallerSuppliedStartupOptions(connectionString: string): boolean {
  try {
    return new URL(connectionString).searchParams.has('options');
  } catch {
    return false;
  }
}

function resolvedPostgresSchema(
  connectionString: string,
  options: PostgresDriverOptions,
): string | undefined {
  const schema = options.schema === undefined
    ? undefined
    : normalizePostgresSchemaName(options.schema);
  if (schema !== undefined && hasCallerSuppliedStartupOptions(connectionString)) {
    throw new Error(
      'A schema-bound Postgres driver refuses a connection string with startup options, because it could override the requested search path.',
    );
  }
  return schema;
}

function postgresConnectionConfig(connectionString: string, schema: string | undefined) {
  return schema === undefined
    ? { connectionString }
    : { connectionString, options: postgresStartupOptionsForSchema(schema) };
}

interface SessionQueryable {
  query<R extends SqlRow = SqlRow>(sql: string): Promise<{ readonly rows: R[] }>;
}

function assertBoundSchemaSession(
  schema: string,
  session: PrivateSchemaSession | undefined,
): void {
  const normalized = normalizePostgresSchemaName(schema);
  if (normalized !== 'public') {
    assertPrivateSchemaSession(normalized, session);
    return;
  }
  if (
    session === undefined ||
    session.current_schema !== normalized ||
    session.has_target_schema !== true ||
    session.has_catalog_schema !== true ||
    session.has_extensions_schema !== true ||
    session.has_public_schema !== true
  ) {
    throw new Error(
      'Postgres session is not bound to public; it must include public, pg_catalog, and extensions.',
    );
  }
}

/** The minimal Client surface needed to pin and verify a Hyperdrive operation. */
export interface PrivateSchemaTransactionClient extends SessionQueryable {
  query<R extends SqlRow = SqlRow>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<{ readonly rows: R[] }>;
}

async function verifyBoundSchemaConnection(
  client: SessionQueryable,
  schema: string,
): Promise<void> {
  const result = await client.query<PrivateSchemaSession>(`
    SELECT current_schema() AS current_schema,
           current_schemas(true) @> ARRAY['${schema}']::name[] AS has_target_schema,
           current_schemas(true) @> ARRAY['pg_catalog']::name[] AS has_catalog_schema,
           current_schemas(true) @> ARRAY['extensions']::name[] AS has_extensions_schema,
           current_schemas(true) @> ARRAY['public']::name[] AS has_public_schema
  `);
  assertBoundSchemaSession(schema, result.rows[0]);
}

/**
 * Pin one schema-bound operation to an origin transaction. Hyperdrive can
 * reuse a different origin connection for a later frontend query, so a
 * connect-time check or ordinary session `SET` is not a durable boundary.
 */
async function withVerifiedSchemaTransaction<T>(
  client: PrivateSchemaTransactionClient,
  schema: string,
  work: () => Promise<T>,
): Promise<T> {
  const normalized = normalizePostgresSchemaName(schema);
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL search_path TO "${normalized}", pg_catalog, extensions`);
    await verifyBoundSchemaConnection(client, normalized);
    const value = await work();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Pin a private Data Foundry operation to a verified transaction. */
export async function withVerifiedPrivateSchemaTransaction<T>(
  client: PrivateSchemaTransactionClient,
  schema: string,
  work: () => Promise<T>,
): Promise<T> {
  const normalized = normalizePostgresSchemaName(schema);
  if (normalized === 'public') {
    throw new Error('withVerifiedPrivateSchemaTransaction requires a non-public schema.');
  }
  return withVerifiedSchemaTransaction(client, normalized, work);
}

const TRUSTED_SURFACE_SNAPSHOT_SETUP =
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';

function isInitialTransactionSetup(sql: string): boolean {
  // Do not accept a prefix, comments, a semicolon, or another transaction
  // mode: node-postgres may execute a multi-statement string verbatim. The one
  // static snapshot setup we support is safe before the verifier because it
  // cannot read or alter application data.
  return sql.trim().replace(/\s+/g, ' ').toUpperCase() === TRUSTED_SURFACE_SNAPSHOT_SETUP;
}

function looksLikeTransactionSetup(sql: string): boolean {
  return /^\s*SET\s+(?:LOCAL\s+)?TRANSACTION\b/i.test(sql);
}

/**
 * Run a caller-controlled transaction without allowing its initial
 * `SET TRANSACTION ...` to be preceded by a verifier read. PostgreSQL requires
 * isolation/read-only setup to occur before the transaction's first query;
 * every later statement is still preceded by transaction-local schema setup
 * and verification.
 */
async function withDeferredSchemaTransaction<T>(
  client: PrivateSchemaTransactionClient,
  schema: string,
  run: (tx: SqlTransactionExecutor) => Promise<T>,
): Promise<T> {
  const normalized = normalizePostgresSchemaName(schema);
  let schemaVerified = false;
  const ensureBoundSchema = async (): Promise<void> => {
    if (schemaVerified) return;
    await client.query(`SET LOCAL search_path TO "${normalized}", pg_catalog, extensions`);
    await verifyBoundSchemaConnection(client, normalized);
    schemaVerified = true;
  };
  const executor = {
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      // The exact snapshot `SET TRANSACTION` cannot read application data and
      // must be first. It is the sole statement allowed before the verifier so
      // snapshot callers can request REPEATABLE READ / READ ONLY safely.
      if (!schemaVerified && isInitialTransactionSetup(sql)) {
        const result = await client.query(sql, params === undefined ? undefined : [...params]);
        return result.rows as R[];
      }
      if (!schemaVerified && looksLikeTransactionSetup(sql)) {
        throw new Error(
          'A schema-bound Hyperdrive transaction permits only the exact trusted snapshot SET TRANSACTION setup before its schema verifier.',
        );
      }
      await ensureBoundSchema();
      const result = await client.query(sql, params === undefined ? undefined : [...params]);
      return result.rows as R[];
    },
  } as SqlTransactionExecutor;

  await client.query('BEGIN');
  try {
    const value = await run(executor);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/**
 * Run a private Data Foundry transaction while allowing its trusted snapshot
 * setup before the schema verifier.
 */
export async function withDeferredPrivateSchemaTransaction<T>(
  client: PrivateSchemaTransactionClient,
  schema: string,
  run: (tx: SqlTransactionExecutor) => Promise<T>,
): Promise<T> {
  const normalized = normalizePostgresSchemaName(schema);
  if (normalized === 'public') {
    throw new Error('withDeferredPrivateSchemaTransaction requires a non-public schema.');
  }
  return withDeferredSchemaTransaction(client, normalized, run);
}

/** Serialize complete transactions on a single node-postgres Client. */
export function createSerialExecutor(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    let release: () => void = () => undefined;
    const previous = tail;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/**
 * One node-postgres Client for exactly one Cloudflare Worker invocation.
 *
 * Hyperdrive supplies the upstream database pool. Cloudflare explicitly
 * forbids retaining a node-postgres Pool or Client across invocations because
 * a socket created in one request cannot perform I/O for another. Callers must
 * close this driver after their fetch, queue batch, or Cron delivery completes.
 */
export async function createHyperdriveDriver(
  connectionString: string,
  options: PostgresDriverOptions = {},
): Promise<SqlDriver> {
  const schema = resolvedPostgresSchema(connectionString, options);
  const pg = await import('pg');
  // Hyperdrive is a transaction pool, not a direct Postgres socket. Do not
  // rely on a libpq startup option surviving a borrowed origin connection.
  // `SET LOCAL` is installed and verified inside every operation below.
  const client = new pg.default.Client({ connectionString });
  const runSerial = createSerialExecutor();

  try {
    await client.connect();
    // This proves the upstream role itself is safely configured before any
    // application query. It is defense in depth; each operation repeats an
    // explicit transaction-local path because Hyperdrive can reset sessions.
    // An explicit public legacy binding is verified inside every operation;
    // it must not require an Alpha Lab role default to be public.
    if (schema !== undefined && schema !== 'public') {
      await verifyBoundSchemaConnection(client, schema);
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  return {
    label: `hyperdrive (${safeHost(connectionString)})`,
    dialect: 'postgres',
    async exec(sql) {
      await runSerial(async () => {
        if (schema === undefined) {
          await client.query(sql);
          return;
        }
        await withVerifiedSchemaTransaction(client, schema, async () => {
          await client.query(sql);
        });
      });
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      return runSerial(async () => {
        if (schema === undefined) {
          const result = await client.query(sql, params === undefined ? undefined : [...params]);
          return result.rows as R[];
        }
        return withVerifiedSchemaTransaction(client, schema, async () => {
          const result = await client.query(sql, params === undefined ? undefined : [...params]);
          return result.rows as R[];
        });
      });
    },
    async transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      return runSerial(async () => {
        if (schema !== undefined) {
          return withDeferredSchemaTransaction(client, schema, fn);
        }
        try {
          await client.query('BEGIN');
          const executor = {
            async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
              const result = await client.query(sql, params === undefined ? undefined : [...params]);
              return result.rows as R[];
            },
          } as SqlTransactionExecutor;
          const value = await fn(executor);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
    },
    async close() {
      await client.end();
    },
  };
}

/**
 * Real Postgres driver. `pg` is imported lazily so that Workers/edge bundles
 * that only ever use PGlite do not pull in a Node-only dependency.
 */
export async function createPostgresDriver(
  connectionString: string,
  options: PostgresDriverOptions = {},
): Promise<SqlDriver> {
  const schema = resolvedPostgresSchema(connectionString, options);

  const pg = await import('pg');
  const pool = new pg.default.Pool(postgresConnectionConfig(connectionString, schema));
  const host = safeHost(connectionString);
  const verifiedClients = new WeakSet<object>();

  const acquire = async () => {
    const client = await pool.connect();
    if (schema === undefined || verifiedClients.has(client)) return client;

    try {
      await verifyBoundSchemaConnection(client, schema);
      verifiedClients.add(client);
      return client;
    } catch (error) {
      // A connection that cannot prove its requested schema path is unsafe to reuse.
      client.release(error instanceof Error ? error : new Error('schema binding verification failed'));
      throw error;
    }
  };

  return {
    label: `postgres (${host})`,
    dialect: 'postgres',
    async exec(sql) {
      const client = await acquire();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      const client = await acquire();
      try {
        const result = await client.query(sql, params === undefined ? undefined : [...params]);
        return result.rows as R[];
      } finally {
        client.release();
      }
    },
    async transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      const client = await acquire();
      try {
        await client.query('BEGIN');
        const executor = {
          async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
            const result = await client.query(sql, params === undefined ? undefined : [...params]);
            return result.rows as R[];
          },
        } as SqlTransactionExecutor;
        const value = await fn(executor);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function safeHost(connectionString: string): string {
  try {
    return new URL(connectionString).host;
  } catch {
    return 'unknown-host';
  }
}

/**
 * Pick a driver from the environment: real Postgres when `POSTGRES_URL` is
 * set, PGlite otherwise. Identical SQL either way.
 */
export async function createDriverFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SqlDriver> {
  const url = env['POSTGRES_URL'];
  if (url !== undefined && url !== '') {
    return createPostgresDriver(url);
  }
  return createPgliteDriver();
}

/** `$1, $2, ... $n`, offset by an existing parameter count. */
export function placeholders(count: number, offset = 0): string {
  if (count <= 0) {
    throw new DriverCapabilityError('placeholders() requires at least one parameter');
  }
  return Array.from({ length: count }, (_, index) => `$${index + offset + 1}`).join(', ');
}

/**
 * Does this database have `pg_trgm` installed?
 *
 * Cached per driver instance. Callers use it to choose a ranking expression,
 * never to decide whether exact matching happens.
 */
const trigramCache = new WeakMap<object, Promise<boolean>>();

export function supportsTrigram(driver: SqlDriver): Promise<boolean> {
  const cacheKey = driver.capabilityCacheKey ?? driver;
  const cached = trigramCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const probe = driver
    .query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS present`,
    )
    .then((rows) => rows[0]?.present === true)
    .catch(() => false);
  trigramCache.set(cacheKey, probe);
  return probe;
}
