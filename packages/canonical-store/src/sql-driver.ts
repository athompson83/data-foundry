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

/**
 * Real Postgres driver. `pg` is imported lazily so that Workers/edge bundles
 * that only ever use PGlite do not pull in a Node-only dependency.
 */
export async function createPostgresDriver(connectionString: string): Promise<SqlDriver> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString });
  const host = safeHost(connectionString);

  return {
    label: `postgres (${host})`,
    dialect: 'postgres',
    async exec(sql) {
      await pool.query(sql);
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      const result = await pool.query(sql, params === undefined ? undefined : [...params]);
      return result.rows as R[];
    },
    async transaction<T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
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
const trigramCache = new WeakMap<SqlDriver, Promise<boolean>>();

export function supportsTrigram(driver: SqlDriver): Promise<boolean> {
  const cached = trigramCache.get(driver);
  if (cached !== undefined) return cached;
  const probe = driver
    .query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS present`,
    )
    .then((rows) => rows[0]?.present === true)
    .catch(() => false);
  trigramCache.set(driver, probe);
  return probe;
}
