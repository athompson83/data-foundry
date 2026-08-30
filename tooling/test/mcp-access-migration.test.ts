import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createPGliteDriver,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

const VERTICAL = '81000000-0000-4000-8000-000000000001';
const TENANT = '81000000-0000-4000-8000-000000000002';
const LEGACY_KEY = '81000000-0000-4000-8000-000000000003';
const MCP_KEY = '81000000-0000-4000-8000-000000000010';
const DIRECT_KEY = '81000000-0000-4000-8000-000000000011';

let driver: MigrationDriver;
let migrations: Migration[];

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  if (error === null) throw new Error('expected the statement to fail, but it succeeded');
  return (error as { readonly code?: string }).code;
}

beforeAll(async () => {
  migrations = await loadMigrations();
  expect(migrations.some((migration) => migration.version === '0018')).toBe(true);
  driver = await createPGliteDriver();
  await applyMigrations(driver, migrations.filter((migration) => migration.version < '0018'));
  await driver.query(
    `insert into verticals (id, slug, name, schema_version, status, default_refresh_policy)
     values ($1, 'mcp-access', 'MCP access', '1.0.0', 'ACTIVE', '{}'::jsonb)`,
    [VERTICAL],
  );
  await driver.query(
    `insert into api_tenants (id, slug, name, status)
     values ($1, 'mcp-access', 'MCP access', 'ACTIVE')`,
    [TENANT],
  );
  await driver.query(
    `alter table api_keys disable trigger api_keys_access_classification_guard`,
  );
  await driver.query(
    `insert into api_keys
       (id, tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
     values ($1, $2, $3, $4, 'df_test_legacy00', 'legacy unclassified', null, null)`,
    [LEGACY_KEY, TENANT, VERTICAL, 'a'.repeat(64)],
  );
  await driver.query(
    `alter table api_keys enable trigger api_keys_access_classification_guard`,
  );
  await applyMigrations(driver, migrations);
  await driver.query(
    `insert into api_keys
       (id, tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
     values
       ($1, $3, $4, $5, 'df_test_mcp00001', 'MCP key', 'MCP', 'NONE'),
       ($2, $3, $4, $6, 'df_test_direct01', 'direct key', 'API_PAID', 'DIRECT')`,
    [MCP_KEY, DIRECT_KEY, TENANT, VERTICAL, 'b'.repeat(64), 'd'.repeat(64)],
  );
});

afterAll(async () => {
  await driver.close();
});

describe('0018 MCP access and analytics-only usage classification', () => {
  it('does not backfill or infer a classification for an existing key', async () => {
    const rows = await driver.query<{ access_tier: string | null; billing_source: string | null }>(
      `select access_tier, billing_source from api_keys where id = $1`,
      [LEGACY_KEY],
    );
    expect(rows).toEqual([{ access_tier: null, billing_source: null }]);
  });

  it('admits only the MCP/NONE pair and keeps it immutable', async () => {
    expect(await sqlState(driver.query(
      `insert into api_keys
         (tenant_id, vertical_id, token_hash, token_prefix, label, access_tier, billing_source)
       values ($1, $2, $3, 'df_test_crossed0', 'crossed', 'MCP', 'DIRECT')`,
      [TENANT, VERTICAL, 'c'.repeat(64)],
    ))).toBe('23514');

    expect(await sqlState(driver.query(
      `update api_keys set access_tier = 'API_PAID', billing_source = 'DIRECT'
        where id = $1`,
      [MCP_KEY],
    ))).toBe('55000');
  });

  it('reserves POST, fixed MCP route keys, and zero rows for MCP/NONE analytics', async () => {
    await expect(
      driver.query(
        `insert into api_usage_events
           (id, tenant_id, api_key_id, vertical_id, route_key, method, status,
            rows_served, access_tier, billing_source)
         values ('81000000-0000-4000-8000-000000000020', $1,
                 $2, $3,
                 'mcp.tools_call', 'POST', 200, 0, 'MCP', 'NONE')`,
        [TENANT, MCP_KEY, VERTICAL],
      ),
    ).resolves.toBeDefined();

    expect(await sqlState(driver.query(
      `insert into api_usage_events
         (id, tenant_id, api_key_id, vertical_id, route_key, method, status,
          rows_served, access_tier, billing_source)
       values ('81000000-0000-4000-8000-000000000021', $1,
               $2, $3, 'search', 'POST', 200, 0, 'API_PAID', 'DIRECT')`,
      [TENANT, DIRECT_KEY, VERTICAL],
    ))).toBe('23514');

    for (const [method, routeKey, rowsServed] of [
      ['GET', 'mcp.tools_call', 0],
      ['POST', 'search', 0],
      ['POST', 'mcp.tools_call', 1],
    ] as const) {
      expect(await sqlState(driver.query(
        `insert into api_usage_events
           (tenant_id, api_key_id, vertical_id, route_key, method, status,
            rows_served, access_tier, billing_source)
         values ($1, $2, $3, $4, $5, 200, $6, 'MCP', 'NONE')`,
        [TENANT, MCP_KEY, VERTICAL, routeKey, method, rowsServed],
      )), `${method}/${routeKey}/${rowsServed}`).toBe('23514');
    }
  });

  it('is a migration no-op when applied again', async () => {
    const second = await applyMigrations(driver, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);
  });
});
