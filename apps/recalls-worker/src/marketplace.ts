/**
 * The RapidAPI channel (ADR-0016, "RapidAPI channel"). RapidAPI's gateway
 * authenticates and bills its own subscribers, then forwards each request with
 * the listing's proxy secret. This Worker trusts a request as marketplace
 * traffic only when that secret matches; it then serves data without touching
 * a Stripe customer's key or allowance, so no request is billed twice.
 *
 * Any request carrying an `x-rapidapi-*` header is marketplace-shaped and is
 * decided here, never passed on to direct-key authentication: a spoofed or
 * misconfigured marketplace request cannot fall through to a valid
 * `rcl_live_` key, and a direct key sent through RapidAPI is never looked up.
 */

import type { Env } from './env.js';
import { sha256Hex } from './store.js';

export const RAPIDAPI_PROXY_SECRET_HEADER = 'x-rapidapi-proxy-secret';
const SUBSCRIPTIONS = new Set(['BASIC', 'PRO', 'ULTRA', 'MEGA', 'CUSTOM']);
const MAX_USER_LENGTH = 128;

export interface MarketplacePrincipal {
  readonly channel: 'rapidapi';
  /** RapidAPI username, as forwarded by the gateway. Logged only as a digest. */
  readonly user: string;
  /** BASIC, PRO, ULTRA, MEGA or CUSTOM; null when absent or unrecognised. */
  readonly subscription: string | null;
}

export type ChannelDecision =
  | { readonly channel: 'direct' }
  | MarketplacePrincipal
  | { readonly channel: 'rejected'; readonly status: 401 | 403; readonly code: string; readonly message: string };

export function hasMarketplaceHeader(request: Request): boolean {
  for (const name of request.headers.keys()) if (name.toLowerCase().startsWith('x-rapidapi-')) return true;
  return false;
}

/** The marketplace channel is open only when explicitly enabled and a proxy secret is installed. */
export function marketplaceEnabled(env: Env): boolean {
  return env.RAPIDAPI_ENABLED === '1' && typeof env.RAPIDAPI_PROXY_SECRET === 'string' && env.RAPIDAPI_PROXY_SECRET.length >= 16;
}

/**
 * Compare secrets without an early return on length or the first differing
 * byte: both are hashed to a fixed size, and every byte is visited.
 */
async function matchesSecret(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function resolveChannel(env: Env, request: Request): Promise<ChannelDecision> {
  if (!hasMarketplaceHeader(request)) return { channel: 'direct' };
  if (!marketplaceEnabled(env)) {
    return { channel: 'rejected', status: 403, code: 'marketplace_disabled', message: 'The RapidAPI channel is not open. Direct API keys: https://data.aroqon.com/#pricing' };
  }
  const presented = request.headers.get(RAPIDAPI_PROXY_SECRET_HEADER);
  if (presented === null || !(await matchesSecret(presented, env.RAPIDAPI_PROXY_SECRET as string))) {
    return { channel: 'rejected', status: 401, code: 'invalid_proxy_secret', message: 'Marketplace requests must come through RapidAPI.' };
  }
  const user = request.headers.get('x-rapidapi-user')?.trim() ?? '';
  if (!user || user.length > MAX_USER_LENGTH) {
    return { channel: 'rejected', status: 401, code: 'missing_marketplace_user', message: 'Marketplace requests must identify the RapidAPI subscriber.' };
  }
  const subscription = request.headers.get('x-rapidapi-subscription')?.trim().toUpperCase() ?? '';
  return { channel: 'rapidapi', user, subscription: SUBSCRIPTIONS.has(subscription) ? subscription : null };
}

/**
 * One structured log line per served marketplace request. RapidAPI is the meter
 * and biller of record for this channel; these lines let its invoices be
 * reconciled against what this Worker served. The username is logged as a digest.
 */
export async function logMarketplaceRequest(principal: MarketplacePrincipal, path: string, status: number): Promise<void> {
  const user = (await sha256Hex(principal.user)).slice(0, 16);
  console.log('rapidapi_request', JSON.stringify({ user, subscription: principal.subscription, path, status }));
}

/**
 * A refused marketplace-shaped request (channel closed, bad or missing proxy secret,
 * missing subscriber) is logged too, marked unverified: RapidAPI may still count it.
 * The claimed username is unverified and logged only as a digest.
 */
export async function logMarketplaceRejection(request: Request, path: string, status: number, code: string): Promise<void> {
  const claimed = request.headers.get('x-rapidapi-user')?.trim() ?? '';
  const user = claimed ? (await sha256Hex(claimed)).slice(0, 16) : null;
  console.log('rapidapi_request', JSON.stringify({ user, subscription: null, path, status, verified: false, code }));
}

