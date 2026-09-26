import { describe, expect, it } from 'vitest';
import {
  BillingConfigurationError,
  StripeApiError,
  StripeClient,
  computeStripeSignature,
  encodeStripeForm,
  findPlanByPriceId,
  parseCheckoutSession,
  planCode,
  resolvePurchasablePlans,
  storedSubscriptionStatus,
  subscriptionGrantsAccess,
  verifyStripeSignature,
} from '../src/index.js';

const PLANS = [
  { name: 'Evaluate', monthly_usd: 0, included_requests: 100 },
  { name: 'Developer', monthly_usd: 49, included_requests: 5000 },
  { name: 'Growth', monthly_usd: 149, included_requests: 25000 },
  { name: 'Scale', monthly_usd: 299, included_requests: 75000 },
];
const PRICE_IDS = JSON.stringify({
  developer: 'price_Developer0001',
  growth: 'price_Growth000001',
  scale: 'price_Scale0000001',
});

describe('plan catalogue', () => {
  it('sells every paid plan and never the free plan', () => {
    const plans = resolvePurchasablePlans(PLANS, PRICE_IDS);
    expect(plans.map((plan) => [plan.code, plan.includedRequests, plan.providerPriceId])).toEqual([
      ['developer', 5000, 'price_Developer0001'],
      ['growth', 25000, 'price_Growth000001'],
      ['scale', 75000, 'price_Scale0000001'],
    ]);
    expect(findPlanByPriceId(plans, 'price_Growth000001')?.code).toBe('growth');
    expect(findPlanByPriceId(plans, 'price_unknown00000')).toBeNull();
  });

  it.each([
    [undefined, /not configured/],
    ['not json', /not valid JSON/],
    ['[]', /JSON object/],
    [JSON.stringify({ developer: 'price_Developer0001', growth: 'price_Growth000001' }), /scale/],
    [JSON.stringify({ developer: 'bad', growth: 'price_Growth000001', scale: 'price_Scale0000001' }), /developer/],
    [JSON.stringify({ evaluate: 'price_Evaluate00001', developer: 'price_Developer0001', growth: 'price_Growth000001', scale: 'price_Scale0000001' }), /unknown paid plan "evaluate"/],
  ])('fails closed on bad price configuration %#', (value, message) => {
    expect(() => resolvePurchasablePlans(PLANS, value)).toThrow(BillingConfigurationError);
    expect(() => resolvePurchasablePlans(PLANS, value)).toThrow(message);
  });

  it('derives stable plan codes', () => {
    expect(planCode('Developer')).toBe('developer');
    expect(planCode(' Growth Plus ')).toBe('growth-plus');
    expect(() => planCode('***')).toThrow(BillingConfigurationError);
  });
});

describe('Stripe webhook signatures', () => {
  const secret = 'whsec_test_secret';
  const payload = '{"id":"evt_1","type":"customer.subscription.updated"}';

  it('accepts a valid v1 signature inside the tolerance window', async () => {
    const signature = await computeStripeSignature(secret, 1_800_000_000, payload);
    await expect(
      verifyStripeSignature(payload, `t=1800000000,v1=${signature}`, secret, 1_800_000_100),
    ).resolves.toEqual({ ok: true, timestamp: 1_800_000_000 });
  });

  it('accepts any matching v1 among several (secret rotation)', async () => {
    const signature = await computeStripeSignature(secret, 1_800_000_000, payload);
    const other = 'a'.repeat(64);
    await expect(
      verifyStripeSignature(payload, `t=1800000000,v1=${other},v1=${signature},v0=${other}`, secret, 1_800_000_000),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses a tampered body, a wrong secret, a replay and malformed headers', async () => {
    const signature = await computeStripeSignature(secret, 1_800_000_000, payload);
    const header = `t=1800000000,v1=${signature}`;
    await expect(verifyStripeSignature(`${payload} `, header, secret, 1_800_000_000)).resolves.toEqual({
      ok: false,
      reason: 'SIGNATURE_MISMATCH',
    });
    await expect(verifyStripeSignature(payload, header, 'whsec_other', 1_800_000_000)).resolves.toEqual({
      ok: false,
      reason: 'SIGNATURE_MISMATCH',
    });
    await expect(verifyStripeSignature(payload, header, secret, 1_800_000_301)).resolves.toEqual({
      ok: false,
      reason: 'TIMESTAMP_OUT_OF_TOLERANCE',
    });
    await expect(verifyStripeSignature(payload, null, secret, 1_800_000_000)).resolves.toEqual({
      ok: false,
      reason: 'MISSING_SIGNATURE',
    });
    for (const malformed of ['t=abc,v1=' + signature, `v1=${signature}`, 't=1800000000', 't=1800000000,v1=XYZ', 'garbage']) {
      await expect(verifyStripeSignature(payload, malformed, secret, 1_800_000_000)).resolves.toEqual({
        ok: false,
        reason: 'MALFORMED_SIGNATURE',
      });
    }
  });
});

describe('Stripe REST client', () => {
  it('encodes nested form parameters the way Stripe expects', () => {
    expect(
      encodeStripeForm({
        mode: 'subscription',
        line_items: [{ price: 'price_x', quantity: 1 }],
        metadata: { plan_code: 'developer' },
        skipped: undefined,
      }),
    ).toBe(
      'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_x&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Bplan_code%5D=developer',
    );
  });

  it('creates a subscription checkout session with metadata on the session and subscription', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new StripeClient({
      secretKey: 'sk_test_0123456789abcdef',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'cs_test_abcdefghij12', url: 'https://checkout.stripe.com/c/pay/x' }), {
          status: 200,
        });
      },
    });
    const session = await client.createCheckoutSession({
      priceId: 'price_Developer0001',
      successUrl: 'https://api.data.aroqon.com/v1/billing/claim?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://data.aroqon.com/hvac/pricing',
      metadata: { vertical_slug: 'hvac', plan_code: 'developer' },
    });
    expect(session.url).toBe('https://checkout.stripe.com/c/pay/x');
    expect(calls[0]?.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('line_items[0][price]')).toBe('price_Developer0001');
    expect(body.get('metadata[vertical_slug]')).toBe('hvac');
    expect(body.get('subscription_data[metadata][plan_code]')).toBe('developer');
    expect(body.get('success_url')).toContain('{CHECKOUT_SESSION_ID}');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Bearer sk_test_0123456789abcdef');
  });

  it('surfaces Stripe errors without echoing the key', async () => {
    const client = new StripeClient({
      secretKey: 'sk_test_0123456789abcdef',
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'No such price', code: 'resource_missing' } }), { status: 400 }),
    });
    const failure = await client
      .createCheckoutSession({ priceId: 'price_x', successUrl: 'https://a', cancelUrl: 'https://b', metadata: {} })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StripeApiError);
    expect((failure as StripeApiError).stripeCode).toBe('resource_missing');
    expect(String((failure as Error).message)).not.toContain('sk_test');
  });

  it('refuses non-Stripe keys and session ids before any request', async () => {
    expect(() => new StripeClient({ secretKey: 'pk_test_0123456789abcdef' })).toThrow(StripeApiError);
    const client = new StripeClient({
      secretKey: 'sk_test_0123456789abcdef',
      fetch: async () => {
        throw new Error('must not be called');
      },
    });
    await expect(client.retrieveCheckoutSession('../../v1/customers')).rejects.toBeInstanceOf(StripeApiError);
  });

  it('parses an expanded session and reads the period from either subscription shape', () => {
    const session = parseCheckoutSession({
      id: 'cs_test_abcdefghij12',
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_123',
      customer_details: { email: 'dev@example.com' },
      metadata: { vertical_slug: 'hvac', plan_code: 'developer', ignored: 7 },
      subscription: {
        id: 'sub_123',
        status: 'active',
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_Developer0001' }, current_period_end: 1_800_000_000 }] },
      },
    });
    expect(session).toMatchObject({
      status: 'complete',
      paymentStatus: 'paid',
      customerId: 'cus_123',
      customerEmail: 'dev@example.com',
      subscriptionId: 'sub_123',
      metadata: { vertical_slug: 'hvac', plan_code: 'developer' },
      subscription: { priceId: 'price_Developer0001', currentPeriodEnd: 1_800_000_000, status: 'active' },
    });
    const legacy = parseCheckoutSession({
      id: 'cs_test_abcdefghij13',
      subscription: { id: 'sub_9', status: 'active', current_period_end: 1_700_000_000, items: { data: [] } },
    });
    expect(legacy.subscription?.currentPeriodEnd).toBe(1_700_000_000);
  });
});

describe('subscription status', () => {
  it('keeps access while Stripe retries and stops it once Stripe gives up', () => {
    expect(storedSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(subscriptionGrantsAccess('PAST_DUE')).toBe(true);
    expect(subscriptionGrantsAccess('ACTIVE')).toBe(true);
    for (const status of ['unpaid', 'canceled', 'paused', 'incomplete', 'incomplete_expired']) {
      const stored = storedSubscriptionStatus(status);
      expect(stored).not.toBeNull();
      expect(subscriptionGrantsAccess(stored!)).toBe(false);
    }
    expect(storedSubscriptionStatus('something_new')).toBeNull();
  });
});
