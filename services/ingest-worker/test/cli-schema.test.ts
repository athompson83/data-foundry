import { describe, expect, it } from 'vitest';
import {
  assertRealIngestSourceIdentity,
  resolveIngestRealPostgresConnections,
  resolveRealPostgresSchema,
} from '../src/cli.js';

describe('real Postgres ingestion isolation', () => {
  it('defaults live ingestion to Alpha Lab while retaining an explicit legacy opt-in', () => {
    expect(resolveRealPostgresSchema({})).toBe('data_foundry');
    expect(resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'public' })).toBe('public');
  });

  it('requires the migration role only for a real private-schema migration', async () => {
    const module = (await import('../../../tooling/scripts/migrate.js')) as Record<string, unknown>;
    const optionsForRealPostgres = module['realPostgresMigrationOptions'];
    expect(optionsForRealPostgres).toEqual(expect.any(Function));
    if (typeof optionsForRealPostgres !== 'function') return;

    expect(optionsForRealPostgres('data_foundry')).toEqual({
      schema: 'data_foundry',
      requirePrivateMigrationRole: true,
    });
    expect(optionsForRealPostgres('public')).toEqual({ schema: 'public' });
  });

  it('uses a separate migration credential before opening the real ingestion driver', () => {
    expect(resolveIngestRealPostgresConnections({
      POSTGRES_URL: 'postgres://df_acquisition:fixture@db.invalid/data_foundry',
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: 'postgres://df_migration:fixture@db.invalid/data_foundry',
    })).toEqual({
      applicationConnectionString: 'postgres://df_acquisition:fixture@db.invalid/data_foundry',
      migrationConnectionString: 'postgres://df_migration:fixture@db.invalid/data_foundry',
    });
  });

  it('refuses a real ingestion when its migration credential is absent', () => {
    expect(() => resolveIngestRealPostgresConnections({
      POSTGRES_URL: 'postgres://df_acquisition:fixture@db.invalid/data_foundry',
    })).toThrow(/DATA_FOUNDRY_MIGRATION_DATABASE_URL/i);
  });

  it('attests the ingest executable before a direct migration', async () => {
    const calls: Array<{
      readonly env: Readonly<Record<string, string | undefined>> | undefined;
      readonly additionalSourcePaths: readonly string[] | undefined;
    }> = [];

    await assertRealIngestSourceIdentity(
      { DATA_FOUNDRY_RELEASE_SHA: 'a'.repeat(40) },
      async (env, options) => {
        calls.push({ env, additionalSourcePaths: options?.additionalSourcePaths });
      },
    );

    expect(calls).toEqual([
      {
        env: { DATA_FOUNDRY_RELEASE_SHA: 'a'.repeat(40) },
        additionalSourcePaths: ['services/ingest-worker/src/cli.ts'],
      },
    ]);
  });
});
