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
 * The prefix has two jobs pulling in opposite directions, and the first version
 * of this constant was measured against only one of them.
 *
 * Twelve characters is eight fixed (`df_live_`) plus four that vary — about 24
 * bits of distinguishing power, so a tenant with a few thousand keys should
 * expect two of them to share a prefix. A colliding prefix defeats the whole
 * point of storing one: an operator revoking "the key starting `df_live_a3Kq`"
 * cannot tell which key that is, and gets the wrong answer at precisely the
 * moment somebody is trying to contain a leak.
 *
 * Sixteen gives eight varying characters, ~48 bits, and no expected collision
 * short of tens of millions of keys — while disclosing 48 bits of a 256-bit
 * secret, leaving over 200 bits unguessable. The secret is untouched by the
 * change; only the ambiguity is.
 */
const DISPLAY_PREFIX_LENGTH = 16;

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

const KEY_SHAPE = /^df_(live|test)_[A-Za-z0-9_-]{43}$/;

/** Does this string even look like one of our keys? */
export function looksLikeApiKey(candidate: string): boolean {
  return KEY_SHAPE.test(candidate);
}

/**
 * Which environment a credential names, or `null` if it is not a credential.
 *
 * Read from a WELL-FORMED key only. A string that merely starts with `df_live_`
 * is not one, and accepting it would make the environment check depend on a
 * prefix an attacker chooses rather than on a key we minted.
 */
export function keyEnvironment(candidate: string): KeyEnvironment | null {
  const match = KEY_SHAPE.exec(candidate);
  return (match?.[1] as KeyEnvironment | undefined) ?? null;
}

/**
 * The environment segment of a stored DISPLAY PREFIX.
 *
 * Separate from `keyEnvironment` because a display prefix is a truncated key by
 * construction, so the full-key shape can never match one. Kept private: the
 * distinction between "a credential someone presented" and "the fragment we
 * stored" is exactly the distinction a caller would collapse, and collapsing it
 * would let a truncated string be accepted as a credential.
 */
const PREFIX_SHAPE = /^df_(live|test)_/;

function storedKeyEnvironment(tokenPrefix: string): KeyEnvironment | null {
  const match = PREFIX_SHAPE.exec(tokenPrefix);
  return (match?.[1] as KeyEnvironment | undefined) ?? null;
}

export interface StoredApiKey {
  readonly id: string;
  readonly tenant_id: string;
  readonly token_hash: string;
  /** The stored display prefix. Carries the environment segment; see below. */
  readonly token_prefix: string;
  readonly revoked_at: string | null;
  readonly expires_at: string | null;
}

export type KeyRejection = 'UNKNOWN_KEY' | 'REVOKED' | 'EXPIRED' | 'WRONG_ENVIRONMENT';

/**
 * The request being judged, and the deployment judging it.
 *
 * Required rather than optional, and that is the whole control. The environment
 * segment existed from the first version of this package and nothing read it —
 * it was a label for humans, and a label nothing enforces is one that is
 * eventually wrong. An optional parameter here would be the same mistake in a
 * new place: every caller that forgot it would compile.
 */
export interface CredentialPresentation {
  /** The credential exactly as presented on the request. */
  readonly presented: string;
  /** The environment THIS deployment serves. */
  readonly environment: KeyEnvironment;
}

export type KeyVerdict =
  | { readonly ok: true; readonly key: StoredApiKey }
  | { readonly ok: false; readonly reason: KeyRejection };

/**
 * Is this stored key usable right now, on this deployment?
 *
 * Separate from the lookup so the decision is testable without a database, and
 * so the ordering is explicit.
 *
 * ## The order is the design
 *
 * **Environment first, before the row is consulted at all.** It is a property of
 * the request rather than of the database, so a key from the wrong environment
 * is refused without a lookup — which also means the response cannot be used to
 * learn whether a key from the other environment exists. The failure this
 * prevents is ordinary rather than exotic: a test key that works against live is
 * one somebody will paste into a CI job or a public repository believing it
 * reaches nothing real, and live traffic recorded against a key its owner
 * believed was free is the same mistake sending an invoice.
 *
 * **Then the stored row's own prefix.** This one catches a bug rather than an
 * attacker: a row minted in the other environment coming back from a hash lookup
 * means the lookup matched something it should not have.
 *
 * **Then revocation, then expiry.** A key somebody deliberately revoked and
 * which has also lapsed reports REVOKED: telling its owner it expired sends them
 * to renew it instead of asking why it was withdrawn.
 */
export function evaluateStoredKey(
  key: StoredApiKey | null,
  now: Date,
  presentation: CredentialPresentation,
): KeyVerdict {
  if (keyEnvironment(presentation.presented) !== presentation.environment) {
    return { ok: false, reason: 'WRONG_ENVIRONMENT' };
  }
  if (key === null) return { ok: false, reason: 'UNKNOWN_KEY' };
  if (storedKeyEnvironment(key.token_prefix) !== presentation.environment) {
    return { ok: false, reason: 'WRONG_ENVIRONMENT' };
  }
  if (key.revoked_at !== null) return { ok: false, reason: 'REVOKED' };
  if (key.expires_at !== null && new Date(key.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: 'EXPIRED' };
  }
  return { ok: true, key };
}
