/**
 * `@data-foundry/api-keys` — minting and verifying API credentials.
 *
 * A new concern rather than a new layer. AGENTS.md's architecture boundaries
 * describe the path a fact takes from acquisition to a consumer surface; access
 * control sits across that path rather than on it, and belongs to neither the
 * store (which would make every reader a credential handler) nor the query layer
 * (which must not know a caller exists). It depends on nothing but Web Crypto.
 *
 * Web Crypto, specifically, because this code runs in a Cloudflare Worker and in
 * Node. `node:crypto` would work in one of those. `crypto.subtle` works in both,
 * so verification at the edge and minting in an admin tool are the same function
 * rather than two implementations that agree until they do not.
 *
 * ## Why SHA-256 and not bcrypt
 *
 * The usual rule — never store a fast hash of a credential — is a rule about
 * *passwords*, which are low-entropy and human-chosen, where an attacker with
 * the hash can guess the input. An API key minted here is 256 bits from a
 * CSPRNG. There is no dictionary for it and no meaningful offline attack to slow
 * down; the whole security argument rests on the entropy, not on the cost of the
 * hash. Adding a work factor would buy nothing and would put a deliberate delay
 * on the hot path of every authenticated request.
 *
 * The property that does matter is that a stolen database is not a stolen key
 * ring, and SHA-256 of a 256-bit secret gives that.
 */

/**
 * How a key is spelled: `df_<environment>_<secret>`.
 *
 * The environment segment exists so a live key is visibly not a test key in a
 * log, a screenshot or a support ticket. The prefix as a whole exists so secret
 * scanners have something to match — a bare base64 blob is indistinguishable
 * from any other string, and a key that cannot be recognised cannot be revoked
 * by anyone who finds it.
 */
export const KEY_PREFIX = 'df';

export type KeyEnvironment = 'live' | 'test';

/** Bytes of randomness behind each key. 32 bytes is 256 bits. */
const SECRET_BYTES = 32;

/**
 * Characters kept for display, counted over the whole key.
 *
 * Enough to identify a key in a list, far too few to reconstruct it: the stored
 * prefix covers the fixed `df_live_` and a handful of secret characters, leaving
 * well over 200 bits unguessable.
 */
const DISPLAY_PREFIX_LENGTH = 12;

export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApiKeyError';
  }
}

/** A freshly minted key. The secret exists here and is never stored. */
export interface MintedApiKey {
  /** The full credential. Returned once; after this it is unrecoverable. */
  readonly secret: string;
  /** SHA-256 of `secret`, lowercase hex. This is what a row stores. */
  readonly tokenHash: string;
  /** Leading characters, for identifying the key without revealing it. */
  readonly tokenPrefix: string;
  readonly environment: KeyEnvironment;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of a presented key, lowercase hex.
 *
 * The same function mints and verifies. A separate verification path is how the
 * two drift, and a drifted verifier either rejects every valid key or accepts
 * something it should not.
 */
export async function hashApiKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return toHex(digest);
}

/** The display prefix for a key, derived rather than stored separately. */
export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, DISPLAY_PREFIX_LENGTH);
}

/**
 * Mint a key. The only place a secret comes into existence.
 *
 * `crypto.getRandomValues` is the CSPRNG in both runtimes. `Math.random` is not
 * one, and a key minted from it is guessable regardless of how it is stored.
 */
export async function mintApiKey(environment: KeyEnvironment = 'live'): Promise<MintedApiKey> {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  const secret = `${KEY_PREFIX}_${environment}_${toBase64Url(bytes)}`;
  return {
    secret,
    tokenHash: await hashApiKey(secret),
    tokenPrefix: apiKeyPrefix(secret),
    environment,
  };
}

/**
 * The credential in an `Authorization` header, or `null`.
 *
 * Returns `null` for anything malformed rather than throwing: a missing or
 * unparseable credential is an ordinary unauthenticated request, not an
 * exceptional condition, and the caller answers both the same way.
 *
 * Only the `Bearer` scheme is read. Accepting the key in a query parameter as
 * well would put it in every access log and referrer header between here and
 * the client, which is how credentials leak without anyone doing anything wrong.
 */
export function readBearerToken(authorization: string | null | undefined): string | null {
  if (authorization === null || authorization === undefined) return null;
  const match = /^Bearer[ ]+(\S+)$/.exec(authorization.trim());
  return match?.[1] ?? null;
}

/** Does this string even look like one of our keys? */
export function looksLikeApiKey(candidate: string): boolean {
  return /^df_(live|test)_[A-Za-z0-9_-]{43}$/.test(candidate);
}

export interface StoredApiKey {
  readonly id: string;
  readonly tenant_id: string;
  readonly token_hash: string;
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
}

export type KeyRejection = 'UNKNOWN_KEY' | 'REVOKED' | 'EXPIRED';

export type KeyVerdict =
  | { readonly ok: true; readonly key: StoredApiKey }
  | { readonly ok: false; readonly reason: KeyRejection };

/**
 * Is this stored key usable right now?
 *
 * Separate from the lookup so the decision is testable without a database, and
 * so the ordering is explicit: a revoked key is revoked whether or not it has
 * also expired. Reporting expiry for a key somebody deliberately revoked would
 * send its owner to renew it instead of asking why it was withdrawn.
 */
export function evaluateStoredKey(key: StoredApiKey | null, now: Date): KeyVerdict {
  if (key === null) return { ok: false, reason: 'UNKNOWN_KEY' };
  if (key.revoked_at !== null) return { ok: false, reason: 'REVOKED' };
  if (key.expires_at !== null && new Date(key.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: 'EXPIRED' };
  }
  return { ok: true, key };
}
