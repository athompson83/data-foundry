/**
 * Marketplace measurement and direct invoicing are deliberately different
 * projections of the same usage table. This exercises the real migration and
 * query so a future billing caller has one safe aggregation to reuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintApiKey } from '@data-foundry/api-keys';
import {
  createQueryFixtures,
  type QueryFixtures,
} from '../../query-model/test/support.js';
import {
  buildUsageEvent,
  persistUsageEvents,
} from '../src/index.js';

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

async function seedKey(
  slug: string,
  accessTier: 'API_FREE' | 'API_PAID' | 'RAPIDAPI',
  billingSource: 'DIRECT' | 'RAPIDAPI',
): Promise<{ readonly tenantId: string; readonly apiKeyId: string }> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ($1, $2, 'ACTIVE') returning id`,
    [slug, slug],
  );
  if (tenant === undefined) throw new Error('tenant insert returned no row');
  const key = await mintApiKey('test');
  const [stored] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      tenant.id,
      key.tokenHash,
      key.tokenPrefix,
      `${slug} key`,
      fixtures.vertical.id,
      accessTier,
      billingSource,
    ],
  );
  if (stored === undefined) throw new Error('key insert returned no row');
  return { tenantId: tenant.id, apiKeyId: stored.id };
}

describe('direct invoice aggregation', () => {
  it('counts API_PAID/DIRECT usage and excludes metered RapidAPI and free-direct events', async () => {
    const module = await import('../src/index.js') as Record<string, unknown>;
    const aggregate = module['aggregateDirectInvoiceEligibleUsage'];
    expect(
      typeof aggregate,
      'usage-events must expose the one canonical direct-invoice aggregation',
    ).toBe('function');
    if (typeof aggregate !== 'function') return;

    const directPaid = await seedKey('invoice-direct-paid', 'API_PAID', 'DIRECT');
    const marketplace = await seedKey('invoice-rapidapi', 'RAPIDAPI', 'RAPIDAPI');
    const directFree = await seedKey('invoice-direct-free', 'API_FREE', 'DIRECT');
    const occurredAt = new Date('2026-08-28T12:00:00.000Z');
    await persistUsageEvents(fixtures.driver, [
      buildUsageEvent({
        ...directPaid,
        verticalId: fixtures.vertical.id,
        routeKey: 'entities.detail',
        method: 'GET',
        status: 200,
        accessTier: 'API_PAID',
        billingSource: 'DIRECT',
        rowsServed: 3,
        durationMs: 20,
        occurredAt,
      }),
      buildUsageEvent({
        ...marketplace,
        verticalId: fixtures.vertical.id,
        routeKey: 'entities.detail',
        method: 'GET',
        status: 200,
        accessTier: 'RAPIDAPI',
        billingSource: 'RAPIDAPI',
        rowsServed: 100,
        durationMs: 500,
        occurredAt,
      }),
      buildUsageEvent({
        ...directFree,
        verticalId: fixtures.vertical.id,
        routeKey: 'entities.detail',
        method: 'GET',
        status: 200,
        accessTier: 'API_FREE',
        billingSource: 'DIRECT',
        rowsServed: 50,
        durationMs: 300,
        occurredAt,
      }),
    ]);

    const rows = await (aggregate as (
      executor: QueryFixtures['driver'],
      window: { readonly from: string; readonly before: string },
    ) => Promise<unknown[]>)(fixtures.driver, {
      from: '2026-08-28T00:00:00.000Z',
      before: '2026-08-29T00:00:00.000Z',
    });

    expect(rows).toEqual([
      {
        tenant_id: directPaid.tenantId,
        vertical_id: fixtures.vertical.id,
        request_count: 1,
        rows_served: 3,
        duration_ms: 20,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(marketplace.tenantId);
    expect(JSON.stringify(rows)).not.toContain(directFree.tenantId);
  });
});
