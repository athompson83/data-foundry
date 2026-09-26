/**
 * Self-service billing end to end through `serveRequest`: Checkout creation,
 * the one-time key claim, the monthly allowance hard stop, and the signed
 * Stripe webhook lifecycle — against the real migrations in PGlite, with only
 * the Stripe HTTP API replaced.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { computeStripeSignature } from '@data-foundry/billing';
import { serveRequest, resetDeployments, type QueueBinding } from '../src/index.js';

let fixtures: QueryFixtures;

const PRICE_IDS = {
  developer: 'price_Developer0001',
  growth: 'price_Growth000001',
  scale: 'price_Scale0000001',
};
const WEBHOOK_SECRET = 'whsec_edge_test_secret';

const queue: QueueBinding = { send: async () => undefined };
const ctx = { waitUntil: () => undefined };

function billingEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    POSTGRES_URL: 'postgres://fixture/db',
    VERTICAL_SLUG: 'hvac',
    API_KEY_ENVIRONMENT: 'test',
    USAGE_EVENTS_QUEUE: queue,
    STRIPE_SECRET_KEY: 'sk_test_0123456789abcdef',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_IDS: JSON.stringify(PRICE_IDS),
    BILLING_PUBLIC_ORIGIN: 'https://api.data.aroqon.com',
    BILLING_RETURN_URL: 'https://data.aroqon.com/hvac/pricing',
    ...overrides,
  };
}

const openFixtureDriver = async () => fixtures.driver;

interface FakeStripe {
  sessions: Map<string, Record<string, unknown>>;
  calls: Array<{ url: string; body: string }>;
}

function installFakeStripe(): FakeStripe {
  const fake: FakeStripe = { sessions: new Map(), calls: [] };
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    fake.calls.push({ url, body: String(init.body ?? '') });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') {
      const params = new URLSearchParams(String(init.body));
      const id = `cs_test_created${String(fake.calls.length).padStart(6, '0')}`;
      return Response.json({
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        metadata: { plan_code: params.get('metadata[plan_code]') },
      });
    }
    const retrieve = /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9]+)/.exec(url);
    if (retrieve !== null) {
      const session = fake.sessions.get(retrieve[1]!);
      return session === undefined
        ? Response.json({ error: { message: 'No such session', code: 'resource_missing' } }, { status: 404 })
        : Response.json(session);
    }
    if (url === 'https://api.stripe.com/v1/billing_portal/sessions') {
      return Response.json({ url: 'https://billing.stripe.com/p/session/test_portal' });
    }
    return Response.json({ error: { message: 'unexpected' } }, { status: 500 });
  });
  return fake;
}

function paidSession(
  id: string,
  options: { subscriptionId: string; priceId?: string; vertical?: string; status?: string; paymentStatus?: string },
): Record<string, unknown> {
  return {
    id,
    status: options.status ?? 'complete',
    payment_status: options.paymentStatus ?? 'paid',
    customer: `cus_${options.subscriptionId}`,
    customer_details: { email: 'developer@example.com' },
    metadata: { vertical_slug: options.vertical ?? 'hvac', plan_code: 'developer' },
    subscription: {
      id: options.subscriptionId,
      status: 'active',
      customer: `cus_${options.subscriptionId}`,
      items: { data: [{ price: { id: options.priceId ?? PRICE_IDS.developer }, current_period_end: 1_900_000_000 }] },
    },
  };
}

async function call(path: string, init: RequestInit = {}, env = billingEnv()): Promise<Response> {
  return serveRequest(new Request(`https://api.data.aroqon.com${path}`, init), env, ctx, openFixtureDriver);
}

async function claim(sessionId: string, accept = 'application/json'): Promise<Response> {
  return call(`/v1/billing/claim?session_id=${sessionId}`, { headers: { accept } });
}

async function signedWebhook(event: Record<string, unknown>, secret = WEBHOOK_SECRET): Promise<Response> {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await computeStripeSignature(secret, timestamp, payload);
  return call('/v1/billing/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' },
    body: payload,
  });
}

async function claimKey(fake: FakeStripe, sessionId: string, subscriptionId: string): Promise<string> {
  fake.sessions.set(sessionId, paidSession(sessionId, { subscriptionId }));
  const response = await claim(sessionId);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data: { api_key: string } };
  return body.data.api_key;
}

async function tenantForSubscription(subscriptionId: string): Promise<string> {
  const rows = await fixtures.driver.query<{ tenant_id: string }>(
    `select tenant_id from api_subscriptions where provider_subscription_id = $1`,
    [subscriptionId],
  );
  return rows[0]!.tenant_id;
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['API_PAID']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plans and checkout', () => {
  it('lists exactly the paid plans with their allowances', async () => {
    installFakeStripe();
    const response = await call('/v1/billing/plans');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ code: string; included_requests: number }> };
    expect(body.data.map((plan) => [plan.code, plan.included_requests])).toEqual([
      ['developer', 5000],
      ['growth', 25000],
      ['scale', 75000],
    ]);
  });

  it('creates a subscription checkout bound to this vertical and plan', async () => {
    const fake = installFakeStripe();
    const response = await call('/v1/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'growth', email: 'dev@example.com' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { checkout_url: string; plan: string } };
    expect(body.data.plan).toBe('growth');
    expect(body.data.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const sent = new URLSearchParams(fake.calls[0]!.body);
    expect(sent.get('line_items[0][price]')).toBe(PRICE_IDS.growth);
    expect(sent.get('metadata[vertical_slug]')).toBe('hvac');
    expect(sent.get('customer_email')).toBe('dev@example.com');
    expect(sent.get('success_url')).toBe(
      'https://api.data.aroqon.com/v1/billing/claim?session_id={CHECKOUT_SESSION_ID}',
    );
  });

  it('redirects a form post straight to Checkout', async () => {
    installFakeStripe();
    const response = await call('/v1/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'plan=developer',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it('refuses unknown plans, the free plan, bad bodies and wrong methods', async () => {
    const fake = installFakeStripe();
    for (const plan of ['evaluate', 'enterprise']) {
      const response = await call('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      expect(response.status).toBe(404);
    }
    const bad = await call('/v1/billing/checkout', { method: 'POST', body: 'plan=developer' });
    expect(bad.status).toBe(400);
    const wrongMethod = await call('/v1/billing/checkout');
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST');
    expect(fake.calls).toHaveLength(0);
  });

  it('does not exist when billing is not configured', async () => {
    const response = await call('/v1/billing/plans', {}, billingEnv({
      STRIPE_SECRET_KEY: undefined,
      STRIPE_WEBHOOK_SECRET: undefined,
      STRIPE_PRICE_IDS: undefined,
      BILLING_PUBLIC_ORIGIN: undefined,
      BILLING_RETURN_URL: undefined,
    }));
    expect(response.status).toBe(404);
  });

  it('refuses to start with partial billing configuration', async () => {
    const response = await call('/v1/billing/plans', {}, billingEnv({ STRIPE_WEBHOOK_SECRET: undefined }));
    expect(response.status).toBe(503);
  });
});

describe('claiming the key', () => {
  it('issues one working paid key per completed checkout, exactly once', async () => {
    const fake = installFakeStripe();
    const secret = await claimKey(fake, 'cs_test_claimonce00001', 'sub_claimonce1');
    expect(secret).toMatch(/^df_test_/);

    const again = await claim('cs_test_claimonce00001');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_CLAIMED');

    const served = await call('/v1/health', { headers: { authorization: `Bearer ${secret}` } });
    expect(served.status).toBe(200);

    const rows = await fixtures.driver.query<{
      access_tier: string;
      billing_source: string;
      monthly_request_allowance: number;
      status: string;
      tenant_status: string;
    }>(
      `select key.access_tier, key.billing_source, allowance.monthly_request_allowance,
              subscription.status, tenant.status as tenant_status
         from api_subscriptions subscription
         join api_tenants tenant on tenant.id = subscription.tenant_id
         join api_keys key on key.tenant_id = subscription.tenant_id
         join api_tenant_allowances allowance on allowance.tenant_id = subscription.tenant_id
        where subscription.provider_checkout_session_id = 'cs_test_claimonce00001'`,
    );
    expect(rows).toEqual([
      {
        access_tier: 'API_PAID',
        billing_source: 'DIRECT',
        monthly_request_allowance: 5000,
        status: 'ACTIVE',
        tenant_status: 'ACTIVE',
      },
    ]);
  });

  it('renders the key once as a no-index HTML page for a browser', async () => {
    const fake = installFakeStripe();
    fake.sessions.set('cs_test_claimhtml00001', paidSession('cs_test_claimhtml00001', { subscriptionId: 'sub_claimhtml1' }));
    const response = await claim('cs_test_claimhtml00001', 'text/html');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toMatch(/df_test_[A-Za-z0-9_-]{43}/);
  });

  it('refuses unpaid, foreign-vertical and unknown checkouts without issuing a key', async () => {
    const fake = installFakeStripe();
    fake.sessions.set('cs_test_unpaid0000001', paidSession('cs_test_unpaid0000001', { subscriptionId: 'sub_unpaid', status: 'open', paymentStatus: 'unpaid' }));
    fake.sessions.set('cs_test_foreign000001', paidSession('cs_test_foreign000001', { subscriptionId: 'sub_foreign', vertical: 'vehicles' }));
    expect((await claim('cs_test_unpaid0000001')).status).toBe(409);
    expect((await claim('cs_test_foreign000001')).status).toBe(409);
    expect((await claim('cs_test_missing000001')).status).toBe(404);
    expect((await claim('not-a-session')).status).toBe(400);
    const issued = await fixtures.driver.query(
      `select 1 from api_subscriptions where provider_subscription_id in ('sub_unpaid', 'sub_foreign')`,
    );
    expect(issued).toHaveLength(0);
  });
});

describe('the monthly allowance hard stop', () => {
  it('counts persisted usage per UTC month and stops the key at its allowance', async () => {
    const fake = installFakeStripe();
    const secret = await claimKey(fake, 'cs_test_allowance0001', 'sub_allowance1');
    const tenantId = await tenantForSubscription('sub_allowance1');
    const [key] = await fixtures.driver.query<{ id: string }>(`select id from api_keys where tenant_id = $1`, [tenantId]);

    // The trigger counts a persisted non-5xx usage row, and never a 5xx or a replay.
    const insertUsage = (id: string, status: number) =>
      fixtures.driver.query(
        `insert into api_usage_events
           (id, tenant_id, api_key_id, vertical_id, occurred_at, route_key, method, status,
            rows_served, duration_ms, access_tier, billing_source)
         values ($1, $2, $3, $4, now(), 'health', 'GET', $5, 0, 1, 'API_PAID', 'DIRECT')
         on conflict (id) do nothing`,
        [id, tenantId, key!.id, fixtures.vertical.id, status],
      );
    await insertUsage('7a000000-0000-4000-8000-000000000001', 200);
    await insertUsage('7a000000-0000-4000-8000-000000000001', 200);
    await insertUsage('7a000000-0000-4000-8000-000000000002', 503);
    const [counter] = await fixtures.driver.query<{ request_count: string }>(
      `select request_count::text from api_usage_monthly_counters where tenant_id = $1`,
      [tenantId],
    );
    expect(counter?.request_count).toBe('1');

    await fixtures.driver.query(
      `update api_usage_monthly_counters set request_count = 5000 where tenant_id = $1`,
      [tenantId],
    );
    const stopped = await call('/v1/health', { headers: { authorization: `Bearer ${secret}` } });
    expect(stopped.status).toBe(429);
    expect(stopped.headers.get('x-ratelimit-limit')).toBe('5000');
    expect(stopped.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(Number(stopped.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await stopped.json()) as { error: { code: string } }).error.code).toBe('ALLOWANCE_EXHAUSTED');
  });
});

describe('the Stripe webhook', () => {
  it('rejects unsigned and wrongly signed deliveries', async () => {
    installFakeStripe();
    const unsigned = await call('/v1/billing/stripe-webhook', { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(400);
    const forged = await signedWebhook({ id: 'evt_forged', type: 'customer.subscription.deleted', data: { object: {} } }, 'whsec_wrong');
    expect(forged.status).toBe(400);
  });

  it('suspends a canceled subscription, is idempotent, and restores access on reactivation', async () => {
    const fake = installFakeStripe();
    const secret = await claimKey(fake, 'cs_test_lifecycle0001', 'sub_lifecycle1');
    const subscription = (status: string, priceId = PRICE_IDS.developer) => ({
      id: 'sub_lifecycle1',
      status,
      customer: 'cus_sub_lifecycle1',
      items: { data: [{ price: { id: priceId }, current_period_end: 1_900_000_000 }] },
    });

    const canceled = await signedWebhook({ id: 'evt_cancel_1', type: 'customer.subscription.deleted', data: { object: subscription('canceled') } });
    expect(canceled.status).toBe(200);
    expect((await call('/v1/health', { headers: { authorization: `Bearer ${secret}` } })).status).toBe(403);

    const replay = await signedWebhook({ id: 'evt_cancel_1', type: 'customer.subscription.deleted', data: { object: subscription('canceled') } });
    expect(await replay.json()).toEqual({ received: true, duplicate: true });

    const upgraded = await signedWebhook({ id: 'evt_upgrade_1', type: 'customer.subscription.updated', data: { object: subscription('active', PRICE_IDS.scale) } });
    expect(upgraded.status).toBe(200);
    expect((await call('/v1/health', { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    const [allowance] = await fixtures.driver.query<{ plan_code: string; monthly_request_allowance: number }>(
      `select plan_code, monthly_request_allowance from api_tenant_allowances where tenant_id = $1`,
      [await tenantForSubscription('sub_lifecycle1')],
    );
    expect(allowance).toEqual({ plan_code: 'scale', monthly_request_allowance: 75000 });
  });

  it('keeps access while Stripe retries a past-due invoice', async () => {
    const fake = installFakeStripe();
    const secret = await claimKey(fake, 'cs_test_pastdue000001', 'sub_pastdue1');
    await signedWebhook({
      id: 'evt_pastdue_1',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_pastdue1', status: 'past_due', items: { data: [] } } },
    });
    expect((await call('/v1/health', { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
  });

  it('provisions a completed checkout before the customer reaches the claim page', async () => {
    const fake = installFakeStripe();
    fake.sessions.set('cs_test_webhookfirst1', paidSession('cs_test_webhookfirst1', { subscriptionId: 'sub_webhookfirst' }));
    const delivered = await signedWebhook({
      id: 'evt_completed_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_webhookfirst1', metadata: { vertical_slug: 'hvac' } } },
    });
    expect(delivered.status).toBe(200);
    const [row] = await fixtures.driver.query<{ key_claimed_at: unknown }>(
      `select key_claimed_at from api_subscriptions where provider_checkout_session_id = 'cs_test_webhookfirst1'`,
    );
    expect(row).toEqual({ key_claimed_at: null });
    expect((await claim('cs_test_webhookfirst1')).status).toBe(201);
    expect((await claim('cs_test_webhookfirst1')).status).toBe(409);
  });
});

describe('the billing portal', () => {
  it('opens the portal for a self-service key and refuses anything else', async () => {
    const fake = installFakeStripe();
    const secret = await claimKey(fake, 'cs_test_portal0000001', 'sub_portal1');
    const opened = await call('/v1/billing/portal', { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
    expect(opened.status).toBe(201);
    expect(((await opened.json()) as { data: { portal_url: string } }).data.portal_url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    const body = new URLSearchParams(fake.calls.at(-1)!.body);
    expect(body.get('customer')).toBe('cus_sub_portal1');

    expect((await call('/v1/billing/portal', { method: 'POST' })).status).toBe(401);
    const unknown = await call('/v1/billing/portal', {
      method: 'POST',
      headers: { authorization: 'Bearer df_test_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(unknown.status).toBe(404);
  });
});
