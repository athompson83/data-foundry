import { describe, expect, it } from 'vitest';

const RELEASE_SHA = 'a'.repeat(40);
const REPOSITORY_ROOT = 'C:/worktrees/data-foundry';

type GitRunner = (args: readonly string[]) => Promise<string>;
type AssertRealPostgresSourceIdentity = (
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<{
    repositoryRoot: string;
    runGit: GitRunner;
    additionalSourcePaths?: readonly string[];
  }>,
) => Promise<void>;

type ResolveDirectMigrationDatabaseUrl = (
  env: Readonly<Record<string, string | undefined>>,
) => string | undefined;

type MigrationDatabaseUrlFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
) => string | undefined;

type MigrationFailureMessage = (
  error: unknown,
  env: Readonly<Record<string, string | undefined>>,
) => string;

async function sourceIdentityGuard(): Promise<AssertRealPostgresSourceIdentity> {
  const module = (await import('../scripts/migrate.js')) as Record<string, unknown>;
  const guard = module['assertRealPostgresSourceIdentity'];
  expect(guard).toEqual(expect.any(Function));
  return guard as AssertRealPostgresSourceIdentity;
}

async function directMigrationDatabaseUrl(): Promise<ResolveDirectMigrationDatabaseUrl> {
  const module = (await import('../scripts/migrate.js')) as Record<string, unknown>;
  const resolver = module['resolveDirectMigrationDatabaseUrl'];
  expect(resolver).toEqual(expect.any(Function));
  return resolver as ResolveDirectMigrationDatabaseUrl;
}

async function migrationDatabaseUrlFromEnv(): Promise<MigrationDatabaseUrlFromEnv> {
  const module = (await import('../scripts/migrate.js')) as Record<string, unknown>;
  const resolver = module['migrationDatabaseUrlFromEnv'];
  expect(resolver).toEqual(expect.any(Function));
  return resolver as MigrationDatabaseUrlFromEnv;
}

async function failureMessage(): Promise<MigrationFailureMessage> {
  const module = (await import('../scripts/migrate.js')) as Record<string, unknown>;
  const formatter = module['migrationFailureMessage'];
  expect(formatter).toEqual(expect.any(Function));
  return formatter as MigrationFailureMessage;
}

describe('real PostgreSQL migration source identity', () => {
  it('refuses a missing release SHA before invoking Git', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({}, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return '';
        },
      }),
    ).rejects.toThrow(/DATA_FOUNDRY_RELEASE_SHA/i);

    expect(calls).toEqual([]);
  });

  it('refuses a release SHA that is not the checked-out source before inspecting status', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({ DATA_FOUNDRY_RELEASE_SHA: RELEASE_SHA }, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return `${'b'.repeat(40)}\n`;
        },
      }),
    ).rejects.toThrow(/does not equal Git HEAD/i);

    expect(calls).toEqual([
      ['-C', REPOSITORY_ROOT, 'rev-parse', '--verify', 'HEAD'],
    ]);
  });

  it('refuses dirty migration inputs after the candidate matches HEAD', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({ DATA_FOUNDRY_RELEASE_SHA: RELEASE_SHA }, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return calls.length === 1 ? `${RELEASE_SHA}\n` : ' M db/migrations/0001_verticals_and_sources.sql\n';
        },
      }),
    ).rejects.toThrow(/migration inputs differ from Git HEAD/i);

    expect(calls).toHaveLength(2);
  });

  it('accepts an exact clean migration candidate', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({ DATA_FOUNDRY_RELEASE_SHA: RELEASE_SHA }, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return calls.length === 1 ? `${RELEASE_SHA}\n` : '';
        },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      ['-C', REPOSITORY_ROOT, 'rev-parse', '--verify', 'HEAD'],
      [
        '-C',
        REPOSITORY_ROOT,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        'db/migrations',
        'tooling/scripts/migrate.ts',
      ],
    ]);
  });

  it('includes a narrow operation-specific executable in the clean-input attestation', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({ DATA_FOUNDRY_RELEASE_SHA: RELEASE_SHA }, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return calls.length === 1 ? `${RELEASE_SHA}\n` : '';
        },
        additionalSourcePaths: ['tooling/scripts/private-canary-fixture.ts'],
      }),
    ).resolves.toBeUndefined();

    expect(calls.at(-1)).toEqual([
      '-C',
      REPOSITORY_ROOT,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      'db/migrations',
      'tooling/scripts/migrate.ts',
      'tooling/scripts/private-canary-fixture.ts',
    ]);
  });

  it('refuses unsafe operation-specific source paths before inspecting status', async () => {
    const guard = await sourceIdentityGuard();
    const calls: string[][] = [];

    await expect(
      guard({ DATA_FOUNDRY_RELEASE_SHA: RELEASE_SHA }, {
        repositoryRoot: REPOSITORY_ROOT,
        runGit: async (args) => {
          calls.push([...args]);
          return `${RELEASE_SHA}\n`;
        },
        additionalSourcePaths: ['../outside.ts'],
      }),
    ).rejects.toThrow(/repository-relative/i);

    expect(calls).toEqual([['-C', REPOSITORY_ROOT, 'rev-parse', '--verify', 'HEAD']]);
  });
});

describe('real PostgreSQL migration credential selection', () => {
  const migrationUrl = 'postgres://df_migration:fixture@db.invalid/data_foundry';

  it('accepts only the named migration credential for a direct real migration', async () => {
    const resolveDirect = await directMigrationDatabaseUrl();

    expect(resolveDirect({
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: migrationUrl,
      POSTGRES_URL: 'postgres://df_edge:fixture@db.invalid/data_foundry',
    })).toBe(migrationUrl);
  });

  it('refuses a generic application URL as a direct real migration source', async () => {
    const resolveDirect = await directMigrationDatabaseUrl();

    expect(() => resolveDirect({
      POSTGRES_URL: 'postgres://df_edge:fixture@db.invalid/data_foundry',
    })).toThrow(/DATA_FOUNDRY_MIGRATION_DATABASE_URL.*POSTGRES_URL is not accepted/i);
  });

  it('leaves credential-free local PGlite execution available', async () => {
    const resolveDirect = await directMigrationDatabaseUrl();

    expect(resolveDirect({})).toBeUndefined();
  });

  it('does not treat a generic application connection as the migration credential', async () => {
    const resolveMigration = await migrationDatabaseUrlFromEnv();

    expect(resolveMigration({
      POSTGRES_URL: 'postgres://df_edge:fixture@db.invalid/data_foundry',
    })).toBeUndefined();
  });

  it('does not reflect a direct migration driver error into process output', async () => {
    const formatFailure = await failureMessage();
    const providerError = new Error('connection context must remain private');

    expect(formatFailure(providerError, {
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: migrationUrl,
    })).toBe('Direct PostgreSQL migration failed.');
  });
});
