import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDriver, type SqlDriver, type SqlParam } from '@data-foundry/canonical-store';
import { applyMigrations, loadMigrations, type MigrationDriver } from '../scripts/migrate.js';
import {
  cleanupPrivateCanaryFixture,
  createPrivateCanaryFixture,
  preparePrivateCanaryFixture,
  verifyPrivateCanaryFixture,
} from '../scripts/private-canary-fixture.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

let driver: SqlDriver;

function migrationDriverView(sqlDriver: SqlDriver): MigrationDriver {
  return {
    label: sqlDriver.label,
    exec: (sql) => sqlDriver.exec(sql),
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await sqlDriver.query(sql, params as readonly SqlParam[] | undefined)) as T[],
    close: () => sqlDriver.close(),
  };
}

beforeAll(async () => {
  driver = await createPgliteDriver();
  await driver.exec('CREATE SCHEMA extensions;');
  await applyMigrations(migrationDriverView(driver), await loadMigrations(), { schema: 'data_foundry' });
  await driver.exec('CREATE TABLE public.private_canary_public_guard (id integer primary key);');
  await driver.query('INSERT INTO public.private_canary_public_guard (id) VALUES (1);');
});

afterAll(async () => {
  await driver.close();
});

describe('private canary synthetic database fixture', () => {
  it('creates only deterministic synthetic rows, proves duplicate usage ids collapse, and cleans up without touching public', async () => {
    const fixture = createPrivateCanaryFixture(RUN_ID);

    await preparePrivateCanaryFixture(driver, fixture);
    await preparePrivateCanaryFixture(driver, fixture);

    await driver.query(
      `INSERT INTO data_foundry.api_usage_events
         (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
          rows_served, duration_ms, access_tier, billing_source)
       VALUES ($1, $2, $3, $4, $5, 'health', 'GET', 200, 0, 0, 'API_FREE', 'DIRECT')
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.edgeEventId,
        fixture.tenantId,
        fixture.edgeApiKeyId,
        fixture.verticalId,
        fixture.issuedAt,
      ],
    );
    await driver.query(
      `INSERT INTO data_foundry.api_usage_events
         (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
          rows_served, duration_ms, access_tier, billing_source)
       VALUES ($1, $2, $3, $4, $5, 'health', 'GET', 200, 0, 0, 'API_FREE', 'DIRECT')
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.edgeEventId,
        fixture.tenantId,
        fixture.edgeApiKeyId,
        fixture.verticalId,
        fixture.issuedAt,
      ],
    );
    await driver.query(
      `INSERT INTO data_foundry.api_usage_events
         (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
          rows_served, duration_ms, access_tier, billing_source)
       VALUES ($1, $2, $3, $4, $5, 'mcp.tools_list', 'POST', 200, 0, 0, 'MCP', 'NONE')
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.mcpEventId,
        fixture.tenantId,
        fixture.mcpApiKeyId,
        fixture.verticalId,
        fixture.issuedAt,
      ],
    );
    await driver.query(
      `INSERT INTO data_foundry.api_usage_events
         (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
          rows_served, duration_ms, access_tier, billing_source)
       VALUES ($1, $2, $3, $4, $5, 'mcp.tools_list', 'POST', 200, 0, 0, 'MCP', 'NONE')
       ON CONFLICT (id) DO NOTHING`,
      [
        fixture.mcpEventId,
        fixture.tenantId,
        fixture.mcpApiKeyId,
        fixture.verticalId,
        fixture.issuedAt,
      ],
    );

    await expect(verifyPrivateCanaryFixture(driver, fixture)).resolves.toEqual({
      edgeEvent: 'PRESENT_ONCE',
      mcpEvent: 'PRESENT_ONCE',
    });

    await cleanupPrivateCanaryFixture(driver, fixture);
    await cleanupPrivateCanaryFixture(driver, fixture);

    await expect(verifyPrivateCanaryFixture(driver, fixture)).rejects.toThrow(
      'Private canary fixture verification failed.',
    );
    await expect(
      driver.query<{ count: number }>('SELECT count(*)::int AS count FROM public.private_canary_public_guard'),
    ).resolves.toEqual([{ count: 1 }]);
  });
});
