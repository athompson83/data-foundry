import { describe, expect, it, vi } from 'vitest';

const CONNECTION_STRING = 'postgres://operator@db.invalid/data-foundry';
const STOP_AFTER_APPLICATION_DRIVER_OPEN = new Error('stop after schema plumbing');

type CheckModule = {
  readonly run: (env: Readonly<Record<string, string | undefined>>) => Promise<number>;
};

async function expectCheckToUseOneSchema(
  load: () => Promise<CheckModule>,
  schema: 'data_foundry' | 'public',
): Promise<void> {
  const migrationDriver = {
    label: 'migration driver',
    async exec() {},
    async query() {
      return [];
    },
    async close() {},
  };
  const resolveOperationalSchema = vi.fn(
    (env: Readonly<Record<string, string | undefined>>) =>
      env['DATA_FOUNDRY_SCHEMA'] ?? 'data_foundry',
  );
  const openMigrationDriver = vi.fn(async () => migrationDriver);
  const applyMigrations = vi.fn(async () => []);
  const loadMigrations = vi.fn(async () => []);
  let applicationDriverAttempts = 0;
  const openApplicationDriver = vi.fn(async () => {
    applicationDriverAttempts += 1;
    if (applicationDriverAttempts === 4) {
      throw STOP_AFTER_APPLICATION_DRIVER_OPEN;
    }
    return {
      label: 'application driver',
      dialect: 'postgres' as const,
      async exec() {},
      async query() {
        return [];
      },
      async transaction<T>(fn: () => Promise<T>) {
        return fn();
      },
      async close() {},
    };
  });

  vi.resetModules();
  vi.doMock('../scripts/migrate.js', () => ({
    applyMigrations,
    createPostgresDriver: openMigrationDriver,
    loadMigrations,
    resolveOperationalSchema,
  }));
  vi.doMock('@data-foundry/canonical-store', async (importOriginal) => ({
    ...(await importOriginal()),
    createPostgresDriver: openApplicationDriver,
  }));

  const env = {
    POSTGRES_URL: CONNECTION_STRING,
    DATA_FOUNDRY_POSTGRES_CONCURRENCY_TEST: '1',
    ...(schema === 'public' ? { DATA_FOUNDRY_SCHEMA: 'public' } : {}),
  };

  try {
    const { run } = await load();
    await expect(run(env)).rejects.toThrow(STOP_AFTER_APPLICATION_DRIVER_OPEN);

    expect(resolveOperationalSchema).toHaveBeenCalledWith(env);
    expect(openMigrationDriver).toHaveBeenCalledWith(CONNECTION_STRING, schema);
    expect(applyMigrations).toHaveBeenCalledWith(migrationDriver, [], { schema });
    expect(openApplicationDriver).toHaveBeenCalledTimes(4);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(openApplicationDriver).toHaveBeenNthCalledWith(attempt, CONNECTION_STRING, { schema });
    }
  } finally {
    vi.doUnmock('../scripts/migrate.js');
    vi.doUnmock('@data-foundry/canonical-store');
    vi.resetModules();
  }
}

describe('real PostgreSQL check schema plumbing', () => {
  it.each(['data_foundry', 'public'] as const)(
    'uses one resolved %s schema for credential-check migration and application drivers',
    async (schema) => {
      await expectCheckToUseOneSchema(
        () => import('../scripts/check-credential-provisioning-postgres.js'),
        schema,
      );
    },
  );

  it.each(['data_foundry', 'public'] as const)(
    'uses one resolved %s schema for reconciliation-check migration and application drivers',
    async (schema) => {
      await expectCheckToUseOneSchema(
        () => import('../scripts/check-source-record-reconciliation-postgres.js'),
        schema,
      );
    },
  );
});
