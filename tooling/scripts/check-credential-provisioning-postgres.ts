/**
 * Real-PostgreSQL race regression for first-time API credential issuance.
 *
 * Two independent connections deliberately contend on the tenant advisory
 * lock. The checker uses only synthetic rows and in-memory delivery, but still
 * requires an explicit arm because POSTGRES_URL must target a disposable test
 * database.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintApiKey } from '@data-foundry/api-keys';
import {
  createPostgresDriver,
  type SqlDriver,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  parseCredentialProvisioningArgs,
  provisionApiCredential,
  type CredentialFileSystem,
  type CredentialProcessRunner,
} from './provision-api-credential.js';
import {
  applyMigrations,
  createPostgresDriver as createMigrationPostgresDriver,
  loadMigrations,
  resolveOperationalSchema,
} from './migrate.js';
import { isMain } from '../lib/cli-entry.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resume: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resume = resolvePromise;
  });
  return { promise, resolve: () => resume?.() };
}

function pauseAfterTenantLock(
  driver: SqlDriver,
  tenantSlug: string,
  locked: Deferred,
  release: Deferred,
): SqlDriver {
  return {
    label: driver.label,
    dialect: driver.dialect,
    exec: (sql) => driver.exec(sql),
    query: (sql, params) => driver.query(sql, params),
    transaction: <T>(fn: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> =>
      driver.transaction(async (tx) => {
        let paused = false;
        const observed = {
          query: async <R extends Record<string, unknown>>(
            sql: string,
            params?: readonly (string | number | boolean | null)[],
          ): Promise<R[]> => {
            const rows = await tx.query<R>(sql, params);
            if (
              !paused &&
              sql.includes('pg_advisory_xact_lock') &&
              params?.[0] === `data-foundry:tenant:${tenantSlug}`
            ) {
              paused = true;
              locked.resolve();
              await release.promise;
            }
            return rows;
          },
        } as SqlTransactionExecutor;
        return fn(observed);
      }),
    close: () => driver.close(),
  };
}

async function waitForContendedAdvisoryLock(monitor: SqlDriver): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await monitor.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%'
       ) AS waiting`,
    );
    if (rows[0]?.waiting === true) return;
    await new Promise<void>((resume) => setTimeout(resume, 20));
  }
  throw new Error('the second credential issuer did not wait on the PostgreSQL advisory lock');
}

class InMemoryCredentialDelivery implements CredentialFileSystem {
  readonly writes: string[] = [];

  async assertNewOutputPath(): Promise<void> {}

  async createValidatedWranglerConfigSnapshot(): Promise<string> {
    throw new Error('the PostgreSQL credential check must not snapshot Wrangler configuration');
  }

  async removeWranglerConfigSnapshot(): Promise<void> {
    throw new Error('the PostgreSQL credential check must not remove a Wrangler snapshot');
  }

  async writeNewRestrictedFile(_path: string, contents: string, mode: number): Promise<void> {
    assert.equal(mode, 0o600);
    this.writes.push(contents);
  }

  async removeNewFile(): Promise<void> {
    this.writes.pop();
  }
}

const refusingRunner: CredentialProcessRunner = {
  async run(): Promise<{ readonly exitCode: number; readonly stdout: string }> {
    throw new Error('the PostgreSQL credential check must not execute a child process');
  },
};

export async function run(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const connectionString = env['POSTGRES_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error('POSTGRES_URL is required for the real PostgreSQL credential check.');
  }
  if (env['DATA_FOUNDRY_POSTGRES_CONCURRENCY_TEST'] !== '1') {
    throw new Error('Set DATA_FOUNDRY_POSTGRES_CONCURRENCY_TEST=1 for a dedicated synthetic test database.');
  }
  const schema = resolveOperationalSchema(env);

  // Migration must stay on one physical connection; the canonical app driver
  // intentionally uses a pool and is opened only after bootstrap completes.
  const migrationDriver = await createMigrationPostgresDriver(connectionString, schema);
  try {
    await applyMigrations(migrationDriver, await loadMigrations(), { schema });
  } finally {
    await migrationDriver.close();
  }

  const primary = await createPostgresDriver(connectionString, { schema });
  const firstConnection = await createPostgresDriver(connectionString, { schema });
  const second = await createPostgresDriver(connectionString, { schema });
  const monitor = await createPostgresDriver(connectionString, { schema });
  const release = deferred();
  try {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const verticalSlug = `credential-pg-${suffix}`;
    const tenantSlug = `credential-race-${suffix}`;
    await primary.query(
      `INSERT INTO verticals (slug, name, schema_version, status, default_refresh_policy)
       VALUES ($1, 'Synthetic PostgreSQL credential control', '1.0.0', 'DRAFT', $2::jsonb)`,
      [
        verticalSlug,
        JSON.stringify({ cadence: 'MANUAL', max_staleness_hours: 24, priority: 1 }),
      ],
    );
    const outputPath = resolve(REPO_ROOT, '..', `credential-concurrency-${suffix}.json`);
    const options = parseCredentialProvisioningArgs([
      '--environment', 'test',
      '--tenant-slug', tenantSlug,
      '--tenant-name', 'Synthetic PostgreSQL credential tenant',
      '--vertical', verticalSlug,
      '--credential-label', 'concurrent first issuance',
      '--access-tier', 'API_PAID',
      '--billing-source', 'DIRECT',
      '--output', outputPath,
    ]);
    const delivery = new InMemoryCredentialDelivery();
    let mintCount = 0;
    const dependencies = {
      mintApiKey: async () => {
        mintCount += 1;
        return mintApiKey('test');
      },
      fileSystem: delivery,
      runner: refusingRunner,
      wranglerCommand: { executable: process.execPath, argsPrefix: [] },
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    } as const;
    const firstLocked = deferred();
    const first = pauseAfterTenantLock(firstConnection, tenantSlug, firstLocked, release);
    const firstProvision = provisionApiCredential(first, options, dependencies);
    await firstLocked.promise;
    const secondProvision = provisionApiCredential(second, options, dependencies);

    let contentionFailure: unknown = null;
    try {
      await waitForContendedAdvisoryLock(monitor);
    } catch (error) {
      contentionFailure = error;
    } finally {
      release.resolve();
    }
    const results = await Promise.all([firstProvision, secondProvision]);
    if (contentionFailure !== null) throw contentionFailure;

    const rows = await primary.query<{
      id: string;
      token_hash: string;
      token_prefix: string;
      revoked_at: string | null;
    }>(
      `SELECT key.id, key.token_hash, key.token_prefix, key.revoked_at
         FROM api_keys key
         JOIN api_tenants tenant ON tenant.id = key.tenant_id
         JOIN verticals vertical ON vertical.id = key.vertical_id
        WHERE tenant.slug = $1 AND vertical.slug = $2 AND key.label = $3`,
      [tenantSlug, verticalSlug, options.credentialLabel],
    );
    assert.equal(results.filter((result) => result.credentialAction === 'CREATED').length, 1);
    assert.equal(results.filter((result) => result.credentialAction === 'UNCHANGED').length, 1);
    assert.equal(results[0]?.credentialId, results[1]?.credentialId);
    assert.equal(mintCount, 1, 'only the lock winner may mint plaintext credential material');
    assert.equal(delivery.writes.length, 1, 'only the lock winner may cross the delivery boundary');
    assert.equal(rows.length, 1, 'concurrent first issuance must persist exactly one credential');
    assert.equal(rows[0]?.revoked_at, null);
    const deliveredSecret = (JSON.parse(delivery.writes[0]!) as { credential: string }).credential;
    assert.ok(!JSON.stringify(rows).includes(deliveredSecret), 'plaintext must not enter PostgreSQL');

    process.stdout.write(
      'OK: PostgreSQL serialized concurrent first credential issuance and persisted one non-plaintext key row.\n',
    );
    return 0;
  } finally {
    release.resolve();
    await Promise.all([primary.close(), firstConnection.close(), second.close(), monitor.close()]);
  }
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
