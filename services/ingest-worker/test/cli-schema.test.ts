import { describe, expect, it, vi } from 'vitest';
import {
  assertRealIngestSourceIdentity,
  main,
  resolveIngestRealPostgresConnections,
  resolveRealPostgresSchema,
} from '../src/cli.js';

describe('real Postgres ingestion isolation', () => {
  it('allows only the private data_foundry schema for live ingestion', () => {
    expect(resolveRealPostgresSchema({})).toBe('data_foundry');
    expect(resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'data_foundry' })).toBe('data_foundry');
    expect(() => resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'public' })).toThrow(/data_foundry/i);
    expect(() => resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'other_schema' })).toThrow(/data_foundry/i);
  });

  it('rejects a public live schema before migration or application driver setup', async () => {
    const env = {
      POSTGRES_URL: 'postgres://df_acquisition:fixture@db.invalid/data_foundry',
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: 'postgres://df_migration:fixture@db.invalid/data_foundry',
      DATA_FOUNDRY_SCHEMA: 'public',
    };
    const migrateRealPostgres = vi.fn(async (): Promise<void> => {
      throw new Error('migration setup must not run for a public live schema');
    });
    const openDriver = vi.fn(async (): Promise<never> => {
      throw new Error('application driver setup must not run for a public live schema');
    });

    await expect(main([], {
      env,
      migrateRealPostgres,
      openDriver,
    })).rejects.toThrow(/data_foundry/i);

    expect(migrateRealPostgres).not.toHaveBeenCalled();
    expect(openDriver).not.toHaveBeenCalled();
  });

  it('captures the approved live schema once for both migration and application setup', async () => {
    const env = {
      POSTGRES_URL: 'postgres://df_acquisition:fixture@db.invalid/data_foundry',
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: 'postgres://df_migration:fixture@db.invalid/data_foundry',
      DATA_FOUNDRY_SCHEMA: 'data_foundry',
    };
    const migrateRealPostgres = vi.fn(async (): Promise<void> => {
      env.DATA_FOUNDRY_SCHEMA = 'public';
    });
    const stopAfterApplicationDriverSetup = new Error('stop after application driver setup');
    const openDriver = vi.fn(async (): Promise<never> => {
      throw stopAfterApplicationDriverSetup;
    });

    await expect(main(['--dry-run'], {
      env,
      migrateRealPostgres,
      openDriver,
    })).rejects.toThrow(stopAfterApplicationDriverSetup);

    expect(migrateRealPostgres).toHaveBeenCalledWith(
      env.DATA_FOUNDRY_MIGRATION_DATABASE_URL,
      'data_foundry',
    );
    expect(openDriver).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, memory: false }),
      env.POSTGRES_URL,
      'data_foundry',
    );
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
