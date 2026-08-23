/**
 * What a credential has to be, and what it must never become.
 *
 * The assertions worth reading twice are the negative ones: that a secret is not
 * recoverable from what a row stores, and that a key in a query string is not a
 * credential this code will accept.
 */
import { describe, expect, it } from 'vitest';
import {
  apiKeyPrefix,
  evaluateStoredKey,
  hashApiKey,
  looksLikeApiKey,
  mintApiKey,
  readBearerToken,
  type StoredApiKey,
} from '../src/index.js';

const NOW = new Date('2026-08-23T12:00:00Z');

const stored = (overrides: Partial<StoredApiKey> = {}): StoredApiKey => ({
  id: 'key-1',
  tenant_id: 'tenant-1',
  token_hash: 'a'.repeat(64),
  revoked_at: null,
  expires_at: null,
  ...overrides,
});

describe('minting', () => {
  it('produces a key with an environment segment a human can read', async () => {
    expect((await mintApiKey('live')).secret).toMatch(/^df_live_/);
    expect((await mintApiKey('test')).secret).toMatch(/^df_test_/);
  });

  it('defaults to live, because a key that silently meant test would be worse', async () => {
    expect((await mintApiKey()).environment).toBe('live');
  });

  it('is unique across mints', async () => {
    const secrets = new Set<string>();
    for (let index = 0; index < 200; index += 1) secrets.add((await mintApiKey()).secret);
    expect(secrets.size).toBe(200);
  });

  it('carries 43 base64url characters, which is what 32 bytes unpadded encodes to', async () => {
    const { secret } = await mintApiKey('live');
    expect(secret.slice('df_live_'.length)).toHaveLength(43);
  });

  /**
   * Uniqueness and length are both satisfied by a counter, and length alone is
   * satisfied by 32 zero bytes. Neither proves the bits are unpredictable, which
   * is the entire security argument — review made exactly this point.
   *
   * This does not prove a CSPRNG either; nothing short of a statistical battery
   * would, and that does not belong in a unit suite. What it does is fail
   * against the two implementations somebody would actually write by mistake: a
   * fixed buffer, and an incrementing counter. Both leave the leading byte
   * constant across every mint. Real randomness does not.
   */
  it('varies in its leading bits, which a counter and a zero buffer do not', async () => {
    const leading = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      leading.add((await mintApiKey()).secret.slice('df_live_'.length, 'df_live_'.length + 2));
    }
    // 200 draws over 4096 two-character combinations. A CSPRNG gives ~195
    // distinct; a counter or a constant buffer gives 1.
    expect(leading.size).toBeGreaterThan(100);
  });

  it('matches its own recogniser, so a scanner tuned to it finds real keys', async () => {
    for (let index = 0; index < 50; index += 1) {
      const { secret } = await mintApiKey();
      expect(looksLikeApiKey(secret), secret).toBe(true);
    }
  });
});

describe('what a row stores', () => {
  it('stores a hash, not the secret', async () => {
    const minted = await mintApiKey();
    expect(minted.tokenHash).not.toContain(minted.secret);
    expect(minted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores a prefix too short to reconstruct the key from', async () => {
    const minted = await mintApiKey();
    // 12 characters, of which 8 are the fixed `df_live_`. Four secret
    // characters is ~24 bits; the remaining ~232 are not stored anywhere.
    expect(minted.tokenPrefix).toHaveLength(12);
    expect(minted.secret.startsWith(minted.tokenPrefix)).toBe(true);
    expect(minted.tokenPrefix.length).toBeLessThan(minted.secret.length / 3);
  });

  /**
   * An assertion about what the MINTER emits, not about the database.
   *
   * It restates `db/migrations/0011`'s regex in TypeScript, so it would keep
   * passing if that CHECK were dropped, renamed or weakened — review flagged
   * this, and it is right. The constraint itself is proved where it lives, in
   * `tooling/test/migrations.test.ts`, by inserting a raw key and expecting the
   * database to refuse it. Both are worth having; only one of them is evidence
   * about the schema.
   */
  it('emits values the migration is willing to store', async () => {
    const minted = await mintApiKey();
    expect(minted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.tokenPrefix.length).toBeGreaterThanOrEqual(4);
    expect(minted.tokenPrefix.length).toBeLessThanOrEqual(16);
  });

  it('hashes deterministically, so verification is a lookup rather than a search', async () => {
    const minted = await mintApiKey();
    expect(await hashApiKey(minted.secret)).toBe(minted.tokenHash);
  });

  /**
   * Determinism only proves minting and verification call the SAME function. It
   * passes just as well if that function returns a constant, or is not SHA-256
   * at all — review's point, and correct.
   *
   * A published known-answer vector is what distinguishes "some function" from
   * "SHA-256". NIST FIPS 180-4, one-block message "abc".
   */
  it('is actually SHA-256, against a published vector rather than against itself', async () => {
    expect(await hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await hashApiKey('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('gives different keys different hashes', async () => {
    const a = await mintApiKey();
    const b = await mintApiKey();
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('derives the prefix rather than trusting a stored one', async () => {
    const minted = await mintApiKey();
    expect(apiKeyPrefix(minted.secret)).toBe(minted.tokenPrefix);
  });
});

describe('reading the credential off a request', () => {
  it('reads a Bearer token', () => {
    expect(readBearerToken('Bearer df_live_abc')).toBe('df_live_abc');
  });

  it('tolerates the spacing real clients send', () => {
    expect(readBearerToken('  Bearer   df_live_abc  ')).toBe('df_live_abc');
  });

  it('returns null rather than throwing, because unauthenticated is ordinary', () => {
    for (const header of [null, undefined, '', 'Basic abc', 'Bearer', 'df_live_abc']) {
      expect(readBearerToken(header), String(header)).toBeNull();
    }
  });

  it('is case-sensitive about the scheme, and does not invent one', () => {
    // Not a security boundary on its own — the lookup still has to match — but
    // accepting arbitrary schemes would mean accepting arbitrary parsing.
    expect(readBearerToken('bearer df_live_abc')).toBeNull();
  });

  /**
   * The one that matters. A key accepted from a query string ends up in every
   * access log, proxy log and `Referer` header between the client and here.
   */
  it('has no path that reads a credential from a URL', () => {
    const url = new URL('https://api.example.com/v1/search?api_key=df_live_abc&token=df_live_abc');
    // The reader takes a header value. Handing it a URL yields nothing, and
    // there is no second reader that takes one.
    expect(readBearerToken(url.searchParams.get('api_key'))).toBeNull();
    expect(readBearerToken(url.toString())).toBeNull();
  });
});

describe('whether a stored key may be used', () => {
  it('accepts a live key', () => {
    expect(evaluateStoredKey(stored(), NOW)).toEqual({ ok: true, key: stored() });
  });

  it('rejects a key that is not there', () => {
    expect(evaluateStoredKey(null, NOW)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('rejects a revoked key', () => {
    const verdict = evaluateStoredKey(stored({ revoked_at: '2026-08-01T00:00:00Z' }), NOW);
    expect(verdict).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('rejects an expired key', () => {
    const verdict = evaluateStoredKey(stored({ expires_at: '2026-08-01T00:00:00Z' }), NOW);
    expect(verdict).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('treats the expiry instant itself as expired, not as the last usable moment', () => {
    const verdict = evaluateStoredKey(stored({ expires_at: NOW.toISOString() }), NOW);
    expect(verdict).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('accepts a key whose expiry is still ahead', () => {
    const verdict = evaluateStoredKey(stored({ expires_at: '2027-01-01T00:00:00Z' }), NOW);
    expect(verdict.ok).toBe(true);
  });

  /**
   * Ordering, not a coin toss. A key somebody deliberately revoked and which has
   * also lapsed should say REVOKED: telling its owner it expired sends them to
   * renew it instead of asking why it was withdrawn.
   */
  it('reports revocation ahead of expiry when both apply', () => {
    const verdict = evaluateStoredKey(
      stored({ revoked_at: '2026-08-01T00:00:00Z', expires_at: '2026-08-02T00:00:00Z' }),
      NOW,
    );
    expect(verdict).toEqual({ ok: false, reason: 'REVOKED' });
  });
});
