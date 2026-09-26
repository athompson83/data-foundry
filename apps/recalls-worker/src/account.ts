/**
 * Plans, API keys and the monthly hard stop. Prices and allowances are the
 * owner-accepted ladder from docs/owner-actions/direct-api-pricing-and-invoicing-decision.md
 * (accepted 2026-09-26): hard stop at the allowance, no automatic overage.
 */

import type { D1Database, Env } from './env.js';
import { sha256Hex } from './store.js';

export const PLANS = {
  evaluate: { name: 'Evaluate', monthlyUsd: 0, requests: 100 },
  developer: { name: 'Developer', monthlyUsd: 49, requests: 5_000 },
  growth: { name: 'Growth', monthlyUsd: 149, requests: 25_000 },
  scale: { name: 'Scale', monthlyUsd: 299, requests: 75_000 },
} as const;

export type PlanId = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS;
}

export function priceIdFor(env: Env, plan: PlanId): string | undefined {
  return {
    evaluate: env.STRIPE_PRICE_EVALUATE,
    developer: env.STRIPE_PRICE_DEVELOPER,
    growth: env.STRIPE_PRICE_GROWTH,
    scale: env.STRIPE_PRICE_SCALE,
  }[plan];
}

export function planForPriceId(env: Env, priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  return PLAN_IDS.find((plan) => priceIdFor(env, plan) === priceId) ?? null;
}

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const KEY_PREFIX = 'rcl_live_';

export function mintApiKey(): string {
  // 62^32 ≈ 2^190. Rejection sampling keeps the alphabet uniform.
  const out: string[] = [];
  while (out.length < 32) {
    for (const byte of crypto.getRandomValues(new Uint8Array(48))) {
      if (byte < 248 && out.length < 32) out.push(KEY_ALPHABET[byte % 62] as string);
    }
  }
  return `${KEY_PREFIX}${out.join('')}`;
}

export interface AuthenticatedCustomer {
  readonly customerId: string;
  readonly keyId: string;
  readonly plan: PlanId;
  readonly status: 'active' | 'past_due' | 'suspended' | 'canceled';
  readonly stripeCustomerId: string | null;
  readonly email: string | null;
}

export function presentedKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match ? (match[1] as string) : null;
  }
  return request.headers.get('x-api-key')?.trim() || null;
}

export async function findCustomerByKey(db: D1Database, key: string): Promise<AuthenticatedCustomer | null> {
  if (!key.startsWith(KEY_PREFIX) || key.length !== KEY_PREFIX.length + 32) return null;
  const row = await db
    .prepare(
      `SELECT k.id AS key_id, c.id AS customer_id, c.plan, c.status, c.stripe_customer_id, c.email
         FROM api_key k JOIN customer c ON c.id = k.customer_id
        WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
    )
    .bind(await sha256Hex(key))
    .first<{ key_id: string; customer_id: string; plan: PlanId; status: AuthenticatedCustomer['status']; stripe_customer_id: string | null; email: string | null }>();
  if (!row) return null;
  return { customerId: row.customer_id, keyId: row.key_id, plan: row.plan, status: row.status, stripeCustomerId: row.stripe_customer_id, email: row.email };
}

export function usageMonth(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/**
 * Count one request against the month's allowance. Returns the new count, or
 * null when the allowance is already spent (the hard stop).
 */
export async function consumeRequest(db: D1Database, customer: AuthenticatedCustomer, now = new Date()): Promise<number | null> {
  const limit = PLANS[customer.plan].requests;
  const row = await db
    .prepare(
      `INSERT INTO usage_month (customer_id, month, requests) VALUES (?, ?, 1)
       ON CONFLICT (customer_id, month) DO UPDATE SET requests = requests + 1 WHERE requests < ?
       RETURNING requests`,
    )
    .bind(customer.customerId, usageMonth(now), limit)
    .first<{ requests: number }>();
  return row?.requests ?? null;
}

export async function currentUsage(db: D1Database, customerId: string, now = new Date()): Promise<number> {
  const row = await db.prepare('SELECT requests FROM usage_month WHERE customer_id = ? AND month = ?').bind(customerId, usageMonth(now)).first<{ requests: number }>();
  return row?.requests ?? 0;
}

/**
 * Issue the one free Evaluate key for an email, or return null when another
 * Evaluate customer with the same email already holds a key. The check and the
 * insert are one statement, which D1's single-writer database executes
 * atomically, so two concurrent checkouts cannot both succeed.
 */
export async function issueFreeKey(db: D1Database, customerId: string, email: string, checkoutSessionId: string, now = new Date().toISOString()): Promise<string | null> {
  const key = mintApiKey();
  const row = await db
    .prepare(
      `INSERT INTO api_key (id, customer_id, key_hash, key_prefix, checkout_session_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM customer c JOIN api_key k ON k.customer_id = c.id
         WHERE c.plan = 'evaluate' AND lower(trim(c.email)) = lower(trim(?)) AND c.id <> ?
       )
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), customerId, await sha256Hex(key), key.slice(0, KEY_PREFIX.length + 4), checkoutSessionId, now, email, customerId)
    .first<{ id: string }>();
  return row ? key : null;
}

/**
 * Revoke keys and issue one new key in a single batch (one transaction), so a
 * failed insert can never leave the customer without a working key. With
 * `keyId`, only that key is revoked (rotation); otherwise every active key is
 * (operator reissue after a lost key).
 */
export async function replaceKey(db: D1Database, customerId: string, keyId: string | null, now = new Date().toISOString()): Promise<string> {
  const key = mintApiKey();
  const revoke = keyId
    ? db.prepare('UPDATE api_key SET revoked_at = ? WHERE id = ? AND customer_id = ? AND revoked_at IS NULL').bind(now, keyId, customerId)
    : db.prepare('UPDATE api_key SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL').bind(now, customerId);
  await db.batch([
    revoke,
    db.prepare('INSERT INTO api_key (id, customer_id, key_hash, key_prefix, checkout_session_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
      .bind(crypto.randomUUID(), customerId, await sha256Hex(key), key.slice(0, KEY_PREFIX.length + 4), now),
  ]);
  return key;
}

/** Issue a fresh key for a customer and return the plaintext exactly once. */
export async function issueKey(db: D1Database, customerId: string, checkoutSessionId: string | null, now = new Date().toISOString()): Promise<string> {
  const key = mintApiKey();
  await db
    .prepare('INSERT INTO api_key (id, customer_id, key_hash, key_prefix, checkout_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), customerId, await sha256Hex(key), key.slice(0, KEY_PREFIX.length + 4), checkoutSessionId, now)
    .run();
  return key;
}
