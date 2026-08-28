import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createPGliteDriver,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

const VERTICAL = '72000000-0000-4000-8000-000000000001';
const TENANT = '72000000-0000-4000-8000-000000000002';
const LEGACY_KEY = '72000000-0000-4000-8000-000000000003';
const LEGACY_CLASSIFY_KEY = '72000000-0000-4000-8000-000000000004';
const LEGACY_USAGE = '72000000-0000-4000-8000-000000000005';

let driver: MigrationDriver;
let migrations: Migration[];

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error === null) throw new Error('expected the statement to fail, but it succeeded');
  return (error as { readonly code?: string }).code;
}

beforeAll(async () => {
  migrations = await loadMigrations();
  expect(migrations.at(-1)?.version).toBe('0016');

  driver = await createPGliteDriver();
  await applyMigrations(
    driver,
    migrations.filter((migration) => migration.version < '0015'),
  );

  await driver.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'access-migration', 'Access migration', '1.0.0', 'ACTIVE', $2::jsonb)`,
    [VERTICAL, JSON.stringify({ cadence: 'MANUAL', max_staleness_hours: 24, priority: 1 })],
  );
  await driver.query(
    `INSERT INTO api_tenants (id, slug, name, status)
     VALUES ($1, 'access-migration', 'Access migration', 'ACTIVE')`,
    [TENANT],
  );
  await driver.query(
    `INSERT INTO api_keys (id, tenant_id, vertical_id, token_hash, token_prefix, label)
     VALUES ($1, $3, $4, $5, 'df_test_legacy01', 'legacy usage key'),
            ($2, $3, $4, $6, 'df_test_legacy02', 'legacy classification key')`,
    [LEGACY_KEY, LEGACY_CLASSIFY_KEY, TENANT, VERTICAL, 'a'.repeat(64), 'b'.repeat(64)],
  );
  await driver.query(
    `INSERT INTO api_usage_events
       (id, tenant_id, api_key_id, vertical_id, route_key, method, status)
     VALUES ($1, $2, $3, $4, 'health', 'GET', 200)`,
    [LEGACY_USAGE, TENANT, LEGACY_KEY, VERTICAL],
  );

  await applyMigrations(driver, migrations);
});

afterAll(async () => {
  await driver.close();
});

describe('0015 API access and billing classification', () => {
  it('does not backfill or default legacy key and usage classifications', async () => {
    const keys = await driver.query<{ access_tier: string | null; billing_source: string | null }>(
      `SELECT access_tier, billing_source FROM api_keys
        WHERE id IN ($1, $2) ORDER BY id`,
      [LEGACY_KEY, LEGACY_CLASSIFY_KEY],
    );
    expect(keys).toEqual([
      { access_tier: null, billing_source: null },
      { access_tier: null, billing_source: null },
    ]);

    const usage = await driver.query<{ access_tier: string | null; billing_source: string | null }>(
      `SELECT access_tier, billing_source FROM api_usage_events WHERE id = $1`,
      [LEGACY_USAGE],
    );
    expect(usage).toEqual([{ access_tier: null, billing_source: null }]);
  });

  it('requires every new key to carry one explicit valid pair', async () => {
    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_keys
             (id, tenant_id, vertical_id, token_hash, token_prefix, label)
           VALUES ('72000000-0000-4000-8000-000000000010', $1, $2, $3,
                   'df_test_missing1', 'missing classification')`,
          [TENANT, VERTICAL, 'c'.repeat(64)],
        ),
      ),
    ).toBe('23502');

    const pairs = [
      ['72000000-0000-4000-8000-000000000011', 'd'.repeat(64), 'API_FREE', 'DIRECT'],
      ['72000000-0000-4000-8000-000000000012', 'e'.repeat(64), 'API_PAID', 'DIRECT'],
      ['72000000-0000-4000-8000-000000000013', 'f'.repeat(64), 'RAPIDAPI', 'RAPIDAPI'],
    ] as const;
    for (const [id, hash, tier, source] of pairs) {
      await expect(
        driver.query(
          `INSERT INTO api_keys
           (id, tenant_id, vertical_id, token_hash, token_prefix, label,
              access_tier, billing_source)
           VALUES ($1, $2, $3, $4, 'df_test_explicit', 'explicit classification', $5, $6)`,
          [id, TENANT, VERTICAL, hash, tier, source],
        ),
      ).resolves.toBeDefined();
    }
  });

  it('rejects crossed, partial and unknown classifications', async () => {
    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_keys
             (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
           VALUES ($1, $2, $3, 'df_test_crossed1', 'crossed', 'API_PAID', 'RAPIDAPI')`,
          [TENANT, VERTICAL, '1'.repeat(64)],
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_keys
             (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
           VALUES ($1, $2, $3, 'df_test_unknown1', 'unknown', 'ENTERPRISE', 'DIRECT')`,
          [TENANT, VERTICAL, '2'.repeat(64)],
        ),
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_keys
             (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier)
           VALUES ($1, $2, $3, 'df_test_partial1', 'partial', 'API_FREE')`,
          [TENANT, VERTICAL, '3'.repeat(64)],
        ),
      ),
    ).toBe('23502');
  });

  it('allows one explicit legacy classification and then makes it immutable', async () => {
    await driver.query(
      `UPDATE api_keys
          SET access_tier = 'API_PAID', billing_source = 'DIRECT'
        WHERE id = $1`,
      [LEGACY_CLASSIFY_KEY],
    );
    await expect(
      driver.query(
        `UPDATE api_keys
            SET access_tier = 'API_PAID', billing_source = 'DIRECT'
          WHERE id = $1`,
        [LEGACY_CLASSIFY_KEY],
      ),
    ).resolves.toBeDefined();
    expect(
      await sqlState(
        driver.query(
          `UPDATE api_keys
              SET access_tier = 'RAPIDAPI', billing_source = 'RAPIDAPI'
            WHERE id = $1`,
          [LEGACY_CLASSIFY_KEY],
        ),
      ),
    ).toBe('55000');
  });

  it('refuses every new unclassified or key-mismatched usage event', async () => {
    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_usage_events
             (id, tenant_id, api_key_id, vertical_id, route_key, method, status)
           VALUES ('72000000-0000-4000-8000-000000000020', $1,
                   '72000000-0000-4000-8000-000000000012', $2, 'health', 'GET', 200)`,
          [TENANT, VERTICAL],
        ),
      ),
    ).toBe('23503');

    expect(
      await sqlState(
        driver.query(
          `INSERT INTO api_usage_events
             (id, tenant_id, api_key_id, vertical_id, route_key, method, status,
              access_tier, billing_source)
           VALUES ('72000000-0000-4000-8000-000000000021', $1,
                   '72000000-0000-4000-8000-000000000012', $2, 'health', 'GET', 200,
                   'RAPIDAPI', 'RAPIDAPI')`,
          [TENANT, VERTICAL],
        ),
      ),
    ).toBe('23503');

    await expect(
      driver.query(
        `INSERT INTO api_usage_events
           (id, tenant_id, api_key_id, vertical_id, route_key, method, status,
            access_tier, billing_source)
         VALUES ('72000000-0000-4000-8000-000000000022', $1,
                 '72000000-0000-4000-8000-000000000013', $2, 'health', 'GET', 200,
                 'RAPIDAPI', 'RAPIDAPI')`,
        [TENANT, VERTICAL],
      ),
    ).resolves.toBeDefined();
  });

  it('remains a migration no-op when applied again', async () => {
    const second = await applyMigrations(driver, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);
  });
});
