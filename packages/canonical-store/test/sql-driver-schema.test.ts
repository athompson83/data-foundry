import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  assertPrivateSchemaSession,
  createSerialExecutor,
  createHyperdriveDriver,
  createPgliteDriver,
  createPostgresDriver,
  postgresStartupOptionsForSchema,
  withDeferredPrivateSchemaTransaction,
  withVerifiedPrivateSchemaTransaction,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
} from '../src/index.js';

let driver: SqlDriver | undefined;

afterAll(async () => {
  await driver?.close();
});

describe('PostgreSQL schema sessions', () => {
  it('uses a startup setting that keeps public out of every new pooled session', () => {
    expect(postgresStartupOptionsForSchema('data_foundry')).toBe(
      '-csearch_path=data_foundry,pg_catalog,extensions',
    );
  });

  it('rejects the shared public default and accepts the Alpha Lab private path', async () => {
    driver = await createPgliteDriver({ trigram: false });
    await driver.exec('CREATE SCHEMA data_foundry; CREATE SCHEMA extensions');

    await driver.exec('SET search_path TO public, pg_catalog');
    const [shared] = await driver.query<{
      current_schema: string | null;
      has_target_schema: boolean;
      has_catalog_schema: boolean;
      has_extensions_schema: boolean;
      has_public_schema: boolean;
    }>(`
      SELECT current_schema() AS current_schema,
             current_schemas(true) @> ARRAY['data_foundry']::name[] AS has_target_schema,
             current_schemas(true) @> ARRAY['pg_catalog']::name[] AS has_catalog_schema,
             current_schemas(true) @> ARRAY['extensions']::name[] AS has_extensions_schema,
             current_schemas(true) @> ARRAY['public']::name[] AS has_public_schema
    `);
    expect(() => assertPrivateSchemaSession('data_foundry', shared)).toThrow(/public/i);

    await driver.exec('SET search_path TO data_foundry, pg_catalog, extensions');
    const [isolated] = await driver.query<{
      current_schema: string | null;
      has_target_schema: boolean;
      has_catalog_schema: boolean;
      has_extensions_schema: boolean;
      has_public_schema: boolean;
    }>(`
      SELECT current_schema() AS current_schema,
             current_schemas(true) @> ARRAY['data_foundry']::name[] AS has_target_schema,
             current_schemas(true) @> ARRAY['pg_catalog']::name[] AS has_catalog_schema,
             current_schemas(true) @> ARRAY['extensions']::name[] AS has_extensions_schema,
             current_schemas(true) @> ARRAY['public']::name[] AS has_public_schema
    `);
    expect(() => assertPrivateSchemaSession('data_foundry', isolated)).not.toThrow();
  });

  it.each([
    ['direct Postgres pool', createPostgresDriver],
    ['Hyperdrive client', createHyperdriveDriver],
  ] as const)('refuses caller-supplied startup options for a schema-bound %s', async (_label, openDriver) => {
    await expect(
      openDriver(
        'postgres://fixture@localhost/data-foundry?options=-csearch_path%3Dpublic',
        { schema: 'data_foundry' },
      ),
    ).rejects.toThrow(/startup options/i);
  });

  it('binds an explicit public schema on a direct pool instead of inheriting its role search_path', async () => {
    const configurations: unknown[] = [];
    const queries: string[] = [];
    let activeSchema = 'data_foundry';
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes('current_schema()')) {
          return {
            rows: [{
              current_schema: activeSchema,
              has_target_schema: activeSchema === 'public',
              has_catalog_schema: true,
              has_extensions_schema: true,
              has_public_schema: activeSchema === 'public',
            }],
          };
        }
        return { rows: [{ ok: true }] };
      },
      release() {},
    };
    class Pool {
      constructor(configuration: unknown) {
        configurations.push(configuration);
        activeSchema =
          (configuration as { readonly options?: string }).options ===
          '-csearch_path=public,pg_catalog,extensions'
            ? 'public'
            : 'data_foundry';
      }
      async connect() {
        return client;
      }
      async end() {}
    }

    vi.doMock('pg', () => ({ default: { Pool } }));
    try {
      const legacy = await createPostgresDriver('postgres://operator@db.invalid/data-foundry', {
        schema: 'public',
      });
      await legacy.query('SELECT 1');
      await legacy.close();

      expect(configurations).toEqual([
        {
          connectionString: 'postgres://operator@db.invalid/data-foundry',
          options: '-csearch_path=public,pg_catalog,extensions',
        },
      ]);
      expect(queries).toEqual([expect.stringContaining('current_schema()'), 'SELECT 1']);
    } finally {
      vi.doUnmock('pg');
      vi.resetModules();
    }
  });

  it('leaves an omitted direct Postgres schema unbound for legacy callers', async () => {
    const configurations: unknown[] = [];
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [{ ok: true }] };
      },
      release() {},
    };
    class Pool {
      constructor(configuration: unknown) {
        configurations.push(configuration);
      }
      async connect() {
        return client;
      }
      async end() {}
    }

    vi.doMock('pg', () => ({ default: { Pool } }));
    try {
      const legacy = await createPostgresDriver('postgres://operator@db.invalid/data-foundry');
      await legacy.query('SELECT 1');
      await legacy.close();

      expect(configurations).toEqual([
        { connectionString: 'postgres://operator@db.invalid/data-foundry' },
      ]);
      expect(queries).toEqual(['SELECT 1']);
    } finally {
      vi.doUnmock('pg');
      vi.resetModules();
    }
  });

  it('binds an explicit public schema inside Hyperdrive operations instead of inheriting its role path', async () => {
    const configurations: unknown[] = [];
    const queries: string[] = [];
    let activeSchema = 'data_foundry';
    class Client {
      constructor(configuration: unknown) {
        configurations.push(configuration);
      }
      async connect() {}
      async query(sql: string) {
        queries.push(sql);
        if (sql.startsWith('SET LOCAL search_path TO')) {
          activeSchema = 'public';
          return { rows: [] };
        }
        if (sql.includes('current_schema()')) {
          return {
            rows: [{
              current_schema: activeSchema,
              has_target_schema: activeSchema === 'public',
              has_catalog_schema: true,
              has_extensions_schema: true,
              has_public_schema: activeSchema === 'public',
            }],
          };
        }
        return { rows: [{ ok: true }] };
      }
      async end() {}
    }

    vi.doMock('pg', () => ({ default: { Client } }));
    try {
      const legacy = await createHyperdriveDriver('postgres://operator@db.invalid/data-foundry', {
        schema: 'public',
      });
      await legacy.query('SELECT 1');
      await legacy.close();

      expect(configurations).toEqual([
        { connectionString: 'postgres://operator@db.invalid/data-foundry' },
      ]);
      expect(queries).toEqual([
        'BEGIN',
        'SET LOCAL search_path TO "public", pg_catalog, extensions',
        expect.stringContaining('current_schema()'),
        'SELECT 1',
        'COMMIT',
      ]);
    } finally {
      vi.doUnmock('pg');
      vi.resetModules();
    }
  });

  it('pins a schema-bound operation to one verified transaction and rolls back on failure', async () => {
    const statements: string[] = [];
    let localSchema = false;
    const client = {
      async query<R extends SqlRow = SqlRow>(sql: string, _params?: readonly SqlParam[]) {
        statements.push(sql);
        if (sql === 'BEGIN') return { rows: [] as R[] };
        if (sql.startsWith('SET LOCAL search_path')) {
          localSchema = true;
          return { rows: [] as R[] };
        }
        if (sql.includes('current_schema()')) {
          return {
            rows: [
              {
                current_schema: localSchema ? 'data_foundry' : 'public',
                has_target_schema: localSchema,
                has_catalog_schema: true,
                has_extensions_schema: true,
                has_public_schema: !localSchema,
              },
            ] as unknown as R[],
          };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          localSchema = false;
          return { rows: [] as R[] };
        }
        return { rows: [{ value: 7 }] as unknown as R[] };
      },
    };

    const value = await withVerifiedPrivateSchemaTransaction(client, 'data_foundry', async () => {
      const result = await client.query<{ value: number }>('SELECT 7 AS value');
      return result.rows[0]?.value;
    });
    expect(value).toBe(7);
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL search_path TO "data_foundry", pg_catalog, extensions',
      expect.stringContaining('current_schema()'),
      'SELECT 7 AS value',
      'COMMIT',
    ]);

    await expect(
      withVerifiedPrivateSchemaTransaction(client, 'data_foundry', async () => {
        throw new Error('expected transaction failure');
      }),
    ).rejects.toThrow('expected transaction failure');
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('allows snapshot isolation setup before its first verifier read', async () => {
    const statements: string[] = [];
    let localSchema = false;
    const client = {
      async query<R extends SqlRow = SqlRow>(sql: string, _params?: readonly SqlParam[]) {
        statements.push(sql);
        if (sql.startsWith('SET LOCAL search_path')) {
          localSchema = true;
          return { rows: [] as R[] };
        }
        if (sql.includes('current_schema()')) {
          return {
            rows: [
              {
                current_schema: localSchema ? 'data_foundry' : 'public',
                has_target_schema: localSchema,
                has_catalog_schema: true,
                has_extensions_schema: true,
                has_public_schema: !localSchema,
              },
            ] as unknown as R[],
          };
        }
        return { rows: [] as R[] };
      },
    };

    await withDeferredPrivateSchemaTransaction(client, 'data_foundry', async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.query('SELECT 1');
    });

    expect(statements).toEqual([
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SET LOCAL search_path TO "data_foundry", pg_catalog, extensions',
      expect.stringContaining('current_schema()'),
      'SELECT 1',
      'COMMIT',
    ]);

    await expect(
      withDeferredPrivateSchemaTransaction(client, 'data_foundry', async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT * FROM public.rise_leads');
      }),
    ).rejects.toThrow(/exact trusted snapshot/i);
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('serializes complete transactions on one Hyperdrive client', async () => {
    const run = createSerialExecutor();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = run(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = run(async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});
