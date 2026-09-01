import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDriver, type SqlDriver, type SqlParam } from '@data-foundry/canonical-store';
import { applyMigrations, loadMigrations, type MigrationDriver } from '../scripts/migrate.js';
import {
  cleanupPrivateCanaryFixture,
  createPrivateCanaryFixture,
  parseFixtureArgs,
  preparePrivateCanaryFixture,
  verifyPrivateCanaryFixture,
} from '../scripts/private-canary-fixture.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CYCLE_A = '2026-09-01T10:00:00.000Z';
const CYCLE_B = '2026-09-01T10:05:00.000Z';

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

async function insertMeteredEvents(
  fixture: ReturnType<typeof createPrivateCanaryFixture>,
  options: Readonly<{ edgeDurationMs?: number; edgeRoute?: string; mcpRoute?: string }> = {},
): Promise<void> {
  await driver.query(
    `INSERT INTO data_foundry.api_usage_events
       (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
        rows_served, duration_ms, access_tier, billing_source)
     VALUES ($1, $2, $3, $4, $5, $6, 'GET', 200, 0, $7, 'API_FREE', 'DIRECT')
     ON CONFLICT (id) DO NOTHING`,
    [
      fixture.edgeEventId,
      fixture.tenantId,
      fixture.edgeApiKeyId,
      fixture.verticalId,
      fixture.issuedAt,
      options.edgeRoute ?? 'health',
      options.edgeDurationMs ?? 0,
    ],
  );
  await driver.query(
    `INSERT INTO data_foundry.api_usage_events
       (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
        rows_served, duration_ms, access_tier, billing_source)
     VALUES ($1, $2, $3, $4, $5, $6, 'POST', 200, 0, 0, 'MCP', 'NONE')
     ON CONFLICT (id) DO NOTHING`,
    [
      fixture.mcpEventId,
      fixture.tenantId,
      fixture.mcpApiKeyId,
      fixture.verticalId,
      fixture.issuedAt,
      options.mcpRoute ?? 'mcp.tools_list',
    ],
  );
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
    const fixture = createPrivateCanaryFixture(RUN_ID, CYCLE_A);

    await preparePrivateCanaryFixture(driver, fixture);
    await preparePrivateCanaryFixture(driver, fixture);

    await insertMeteredEvents(fixture);
    await insertMeteredEvents(fixture);

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

  it('does not let an earlier cycle satisfy a later cycle that reuses the same run id', async () => {
    const earlier = createPrivateCanaryFixture(RUN_ID, CYCLE_A);
    const later = createPrivateCanaryFixture(RUN_ID, CYCLE_B);

    expect(later.edgeEventId).not.toBe(earlier.edgeEventId);
    expect(later.mcpEventId).not.toBe(earlier.mcpEventId);
    expect(later.tenantId).not.toBe(earlier.tenantId);

    await preparePrivateCanaryFixture(driver, earlier);
    await insertMeteredEvents(earlier);
    await expect(verifyPrivateCanaryFixture(driver, earlier)).resolves.toEqual({
      edgeEvent: 'PRESENT_ONCE',
      mcpEvent: 'PRESENT_ONCE',
    });

    await preparePrivateCanaryFixture(driver, later);
    await expect(verifyPrivateCanaryFixture(driver, later)).rejects.toThrow(
      'Private canary fixture verification failed.',
    );

    await cleanupPrivateCanaryFixture(driver, later);
    await expect(verifyPrivateCanaryFixture(driver, earlier)).resolves.toEqual({
      edgeEvent: 'PRESENT_ONCE',
      mcpEvent: 'PRESENT_ONCE',
    });
    await cleanupPrivateCanaryFixture(driver, earlier);
  });

  it('rejects a usage event whose closed metering fields do not match the issued cycle', async () => {
    const fixture = createPrivateCanaryFixture(RUN_ID, CYCLE_B);
    await preparePrivateCanaryFixture(driver, fixture);
    await insertMeteredEvents(fixture, { edgeDurationMs: 1 });

    await expect(verifyPrivateCanaryFixture(driver, fixture)).rejects.toThrow(
      'Private canary fixture verification failed.',
    );
    await cleanupPrivateCanaryFixture(driver, fixture);
  });

  it('requires the emitted cycle time to verify or clean a canary fixture', () => {
    expect(() => parseFixtureArgs(['verify', '--run-id', RUN_ID])).toThrow(
      'Private canary fixture configuration is invalid.',
    );
    expect(() => parseFixtureArgs(['cleanup', '--run-id', RUN_ID])).toThrow(
      'Private canary fixture configuration is invalid.',
    );
    expect(parseFixtureArgs(['prepare', '--run-id', RUN_ID])).toEqual({
      mode: 'prepare',
      runId: RUN_ID,
      issuedAt: null,
    });
  });
});
