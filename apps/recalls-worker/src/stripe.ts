/**
 * Stripe over plain fetch: Checkout for sign-up (every plan, including the $0
 * Evaluate tier, so each key is tied to a Stripe customer), the billing portal
 * for upgrades and cancellation, and signed webhooks for subscription state.
 */

import { isPlanId, planForPriceId, priceIdFor, type PlanId } from './account.js';
import type { D1Database, Env } from './env.js';

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[];
interface FormObject {
  readonly [key: string]: FormValue;
}

export function formEncode(params: FormObject, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) parts.push(...formEncode(item as FormObject, `${name}[${index}]`));
        else parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === 'object') {
      parts.push(...formEncode(value as FormObject, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StripeError';
  }
}

export async function stripe<T>(env: Env, method: 'GET' | 'POST', path: string, params: FormObject = {}): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new StripeError('Stripe is not configured', 503);
  const body = formEncode(params).join('&');
  const url = method === 'GET' && body ? `https://api.stripe.com/v1/${path}?${body}` : `https://api.stripe.com/v1/${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-06-20',
    },
    ...(method === 'POST' ? { body } : {}),
  });
  const json = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new StripeError(json.error?.message ?? `Stripe ${response.status}`, response.status);
  return json;
}

export interface CheckoutSession {
  readonly id: string;
  readonly url: string | null;
  readonly status: string | null;
  readonly payment_status: string;
  readonly customer: string | null;
  readonly subscription: string | { id: string; status: string; items: { data: Array<{ price: { id: string } }> } } | null;
  readonly customer_details: { email: string | null } | null;
  readonly metadata: Record<string, string> | null;
}

export async function createCheckoutSession(env: Env, plan: PlanId): Promise<CheckoutSession> {
  const price = priceIdFor(env, plan);
  if (!price) throw new StripeError(`No Stripe price configured for ${plan}`, 503);
  const origin = env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com';
  return stripe<CheckoutSession>(env, 'POST', 'checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/recalls/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/recalls#pricing`,
    allow_promotion_codes: plan === 'evaluate' ? undefined : true,
    payment_method_collection: 'if_required',
    billing_address_collection: 'auto',
    metadata: { plan, product: 'recalls' },
    subscription_data: { metadata: { plan, product: 'recalls' } },
    custom_text: {
      submit: { message: `By subscribing you agree to the Terms of Service at ${origin}/terms. Your API key is shown on the next page.` },
    },
  });
}

export async function retrieveCheckoutSession(env: Env, id: string): Promise<CheckoutSession> {
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) throw new StripeError('Invalid checkout session', 400);
  return stripe<CheckoutSession>(env, 'GET', `checkout/sessions/${id}`, { expand: ['subscription'] });
}

export async function createPortalSession(env: Env, stripeCustomerId: string): Promise<string> {
  const origin = env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com';
  const session = await stripe<{ url: string }>(env, 'POST', 'billing_portal/sessions', { customer: stripeCustomerId, return_url: `${origin}/recalls` });
  return session.url;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** Verify a `Stripe-Signature` header (scheme v1) within the replay tolerance. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
  if (!header) return false;
  const fields = header.split(',').map((part) => part.split('=', 2) as [string, string]);
  const timestamp = Number(fields.find(([key]) => key === 't')?.[1]);
  const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

interface Subscription {
  readonly id: string;
  readonly customer: string;
  readonly status: string;
  readonly items: { data: Array<{ price: { id: string } }> };
  readonly metadata?: Record<string, string>;
}

export function customerStatusFor(subscriptionStatus: string): 'active' | 'past_due' | 'canceled' {
  if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') return 'active';
  if (subscriptionStatus === 'past_due') return 'past_due';
  // unpaid, canceled, incomplete, incomplete_expired, paused: no access.
  return 'canceled';
}

/** Create or update the local customer from a Stripe subscription. Returns the local id. */
export async function upsertCustomerFromSubscription(db: D1Database, env: Env, subscription: Subscription, email: string | null, now = new Date().toISOString()): Promise<string | null> {
  const plan = planForPriceId(env, subscription.items.data[0]?.price.id) ?? (isPlanId(subscription.metadata?.['plan']) ? (subscription.metadata?.['plan'] as PlanId) : null);
  if (!plan) return null;
  const status = customerStatusFor(subscription.status);
  const existing = await db
    .prepare('SELECT id FROM customer WHERE stripe_subscription_id = ? OR stripe_customer_id = ? ORDER BY created_at LIMIT 1')
    .bind(subscription.id, subscription.customer)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare('UPDATE customer SET plan = ?, status = ?, stripe_subscription_id = ?, stripe_customer_id = ?, email = COALESCE(?, email), updated_at = ? WHERE id = ?')
      .bind(plan, status, subscription.id, subscription.customer, email, now, existing.id)
      .run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO customer (id, email, stripe_customer_id, stripe_subscription_id, plan, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(id, email, subscription.customer, subscription.id, plan, status, now, now)
    .run();
  const row = await db.prepare('SELECT id FROM customer WHERE stripe_subscription_id = ?').bind(subscription.id).first<{ id: string }>();
  return row?.id ?? null;
}

export async function handleStripeWebhook(env: Env, request: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook not configured', { status: 503 });
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('invalid signature', { status: 400 });
  }
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const now = new Date().toISOString();

  // Events can arrive late or out of order, so the payload only says *which*
  // subscription changed; its current state is re-read from Stripe. Handling
  // is idempotent, and the event is recorded only after it succeeds, so a
  // failure is retried by Stripe rather than remembered as done.
  let subscriptionId: string | null = null;
  let email: string | null = null;
  if (event.type.startsWith('customer.subscription.')) {
    subscriptionId = String(event.data.object['id'] ?? '') || null;
  } else if (event.type === 'checkout.session.completed') {
    const session = event.data.object as unknown as CheckoutSession;
    subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
    email = session.customer_details?.email ?? null;
  }
  if (subscriptionId) {
    const subscription = await stripe<Subscription>(env, 'GET', `subscriptions/${encodeURIComponent(subscriptionId)}`);
    await upsertCustomerFromSubscription(env.DB, env, subscription, email, now);
  }
  await env.DB.prepare('INSERT INTO stripe_event (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(event.id, event.type, now).run();
  return Response.json({ received: true });
}
