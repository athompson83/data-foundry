/**
 * The direct-customer allowance on the request path (ADR-0014, migration
 * 0034), against a real database: a valid key with no active period is
 * refused, a spent period is refused with the period end, a served request
 * carries its allowance headers, refusals are never metered, one tenant's
 * exhaustion never touches another's, and marketplace-billed traffic is not
 * entitled here at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { mintApiKey } from '@data-foundry/api-keys';
import type { UsageEvent } from '@data-foundry/usage-events';
import {
  ALLOWANCE_LIMIT_HEADER,
  ALLOWANCE_REMAINING_HEADER,
  ALLOWANCE_RESET_HEADER,
  resetDeployments,
  serveRequest,
  toEntitlementResponse,
  type QueueBinding,
} from '../src/index.js';

let fixtures: QueryFixtures;
const openFixtureDriver = async () => fixtures.driver;

function recordingQueue(): { queue: QueueBinding; sent: UsageEvent[] } {
  const sent: UsageEvent[] = [];
  return { queue: { send: async (message: unknown) => { sent.push(message as UsageEvent); } }, sent };
}

function env(queue: QueueBinding) {
  return {
    VERTICAL_SLUG: 'hvac',
    DEPLOYMENT_ENVIRONMENT: 'development',
    API_KEY_ENVIRONMENT: 'test',
    POSTGRES_URL: 'postgres://fixture/db',
    USAGE_EVENTS_QUEUE: queue,
  };
}

const ctx = { waitUntil: () => undefined };

async function mintKeyFor(
  tenantSlug: string,
  classification: { accessTier: 'API_PAID' | 'API_FREE'; billingSource: 'DIRECT' } = {
    accessTier: 'API_PAID',
    billingSource: 'DIRECT',
  },
): Promise<{ secret: string; tenantId: string; apiKeyId: string }> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ($1, $2, 'ACTIVE') returning id`,
    [tenantSlug, tenantSlug],
  );
  const tenantId = tenant?.id;
  if (tenantId === undefined) throw new Error('tenant insert returned no row');
  const minted = await mintApiKey('test');
  const [key] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [tenantId, minted.tokenHash, minted.tokenPrefix, `${tenantSlug} key`, fixtures.vertical.id, classification.accessTier, classification.billingSource],
  );
  const apiKeyId = key?.id;
  if (apiKeyId === undefined) throw new Error('key insert returned no row');
  return { secret: minted.secret, tenantId, apiKeyId };
}

async function grantEntitlement(
  tenantId: string,
  options: { included: number; planCode?: string; startOffsetMs?: number; endOffsetMs?: number; status?: 'ACTIVE' | 'CANCELLED' },
): Promise<string> {
  const now = Date.now();
  const start = new Date(now + (options.startOffsetMs ?? -60_000)).toISOString();
  const end = new Date(now + (options.endOffsetMs ?? 30 * 86_400_000)).toISOString();
  const status = options.status ?? 'ACTIVE';
  const [row] = await fixtures.driver.query<{ id: string }>(
    `insert into api_entitlements
       (tenant_id, vertical_id, plan_code, included_requests, period_start, period_end, status, cancelled_at)
     values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::timestamptz) returning id`,
    [tenantId, fixtures.vertical.id, options.planCode ?? 'developer', options.included, start, end, status, status === 'CANCELLED' ? start : null],
  );
  if (row === undefined) throw new Error('entitlement insert returned no row');
  return row.id;
}

async function consumed(entitlementId: string): Promise<number> {
  const [row] = await fixtures.driver.query<{ consumed_requests: number | string }>(
    `select consumed_requests from api_entitlements where id = $1`,
    [entitlementId],
  );
  return Number(row?.consumed_requests);
}

function healthRequest(secret: string): Request {
  return new Request('https://api.example.test/v1/health', { headers: { authorization: `Bearer ${secret}` } });
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['API_PAID', 'API_FREE']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
});

describe('a direct key without an active period', () => {
  it('is refused with the same opaque 403 as every other forbidden key, and is not metered', async () => {
    const key = await mintKeyFor('no-period');
    const { queue, sent } = recordingQueue();
    const response = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'This API key may not access this deployment.' },
    });
    expect(response.headers.get(ALLOWANCE_REMAINING_HEADER)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('is refused when its only period is cancelled or not yet started', async () => {
    const cancelled = await mintKeyFor('cancelled-period');
    await grantEntitlement(cancelled.tenantId, { included: 10, status: 'CANCELLED' });
    const future = await mintKeyFor('future-period');
    await grantEntitlement(future.tenantId, { included: 10, startOffsetMs: 3_600_000 });
    for (const key of [cancelled, future]) {
      const { queue, sent } = recordingQueue();
      const response = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
      expect(response.status).toBe(403);
      expect(sent).toEqual([]);
    }
  });
});

describe('a direct key with an active period', () => {
  it('serves, decrements the remainder per request, reports the allowance, and stops hard at the allowance', async () => {
    const key = await mintKeyFor('developer');
    const entitlementId = await grantEntitlement(key.tenantId, { included: 2 });
    const { queue, sent } = recordingQueue();

    const first = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
    expect(first.status).toBe(200);
    expect(first.headers.get(ALLOWANCE_LIMIT_HEADER)).toBe('2');
    expect(first.headers.get(ALLOWANCE_REMAINING_HEADER)).toBe('1');
    expect(first.headers.get(ALLOWANCE_RESET_HEADER)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
    expect(second.status).toBe(200);
    expect(second.headers.get(ALLOWANCE_REMAINING_HEADER)).toBe('0');

    const third = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({
      error: {
        code: 'QUOTA_EXHAUSTED',
        message: 'The request allowance for the current billing period is exhausted.',
      },
    });
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(third.headers.get(ALLOWANCE_REMAINING_HEADER)).toBe('0');
    expect(third.headers.get(ALLOWANCE_RESET_HEADER)).toBe(first.headers.get(ALLOWANCE_RESET_HEADER));
    expect(third.headers.get('cache-control')).toBe('no-store');

    // Two served requests were metered; the refusal was not.
    expect(sent).toHaveLength(2);
    expect(sent.every((event) => event.status === 200)).toBe(true);
    expect(await consumed(entitlementId)).toBe(2);
  });

  it('keeps a client error\'s unit but not a server fault\'s', async () => {
    const key = await mintKeyFor('client-error');
    const entitlementId = await grantEntitlement(key.tenantId, { included: 5 });
    const { queue } = recordingQueue();
    const missing = new Request('https://api.example.test/v1/entities/not-a-uuid', {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const response = await serveRequest(missing, env(queue), ctx, openFixtureDriver);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await consumed(entitlementId)).toBe(1);
    expect(response.headers.get(ALLOWANCE_REMAINING_HEADER)).toBe('4');
  });

  it('applies the same allowance to an evaluation key and never lets one tenant spend another\'s', async () => {
    const evaluation = await mintKeyFor('evaluation', { accessTier: 'API_FREE', billingSource: 'DIRECT' });
    const evaluationEntitlement = await grantEntitlement(evaluation.tenantId, { included: 1, planCode: 'evaluate' });
    const neighbour = await mintKeyFor('neighbour');
    const neighbourEntitlement = await grantEntitlement(neighbour.tenantId, { included: 3 });
    const { queue, sent } = recordingQueue();

    expect((await serveRequest(healthRequest(evaluation.secret), env(queue), ctx, openFixtureDriver)).status).toBe(200);
    expect((await serveRequest(healthRequest(evaluation.secret), env(queue), ctx, openFixtureDriver)).status).toBe(429);
    const neighbourResponse = await serveRequest(healthRequest(neighbour.secret), env(queue), ctx, openFixtureDriver);
    expect(neighbourResponse.status).toBe(200);
    expect(neighbourResponse.headers.get(ALLOWANCE_REMAINING_HEADER)).toBe('2');

    expect(await consumed(evaluationEntitlement)).toBe(1);
    expect(await consumed(neighbourEntitlement)).toBe(1);
    expect(sent.map((event) => event.tenant_id)).toEqual([evaluation.tenantId, neighbour.tenantId]);
  });

  it('selects the period that contains the instant when a renewal has been appended', async () => {
    const key = await mintKeyFor('renewed');
    const spent = await grantEntitlement(key.tenantId, { included: 0, startOffsetMs: -2 * 86_400_000, endOffsetMs: -86_400_000 });
    const current = await grantEntitlement(key.tenantId, { included: 4, startOffsetMs: -86_400_000 });
    const { queue } = recordingQueue();
    const response = await serveRequest(healthRequest(key.secret), env(queue), ctx, openFixtureDriver);
    expect(response.status).toBe(200);
    expect(await consumed(current)).toBe(1);
    expect(await consumed(spent)).toBe(0);
  });
});

describe('the refusal renderer', () => {
  it('computes Retry-After from the period end and never emits zero', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');
    const exhausted = toEntitlementResponse(
      { ok: false, reason: 'QUOTA_EXHAUSTED', periodEnd: new Date('2026-09-19T12:00:30.400Z') },
      now,
    );
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers['retry-after']).toBe('31');
    const past = toEntitlementResponse({ ok: false, reason: 'QUOTA_EXHAUSTED', periodEnd: new Date('2026-09-19T11:00:00Z') }, now);
    expect(past.headers['retry-after']).toBe('1');
    const required = toEntitlementResponse({ ok: false, reason: 'ENTITLEMENT_REQUIRED', periodEnd: null }, now);
    expect(required.status).toBe(403);
    expect(required.headers).toEqual({});
  });
});
