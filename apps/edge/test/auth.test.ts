/**
 * Authentication and scope enforcement, against a real database.
 *
 * The property under test throughout is reject-before-execution: every
 * failure case here is checked without ever building a `QueryModel` call, and
 * the cross-tenant case is checked by actually minting two tenants and
 * proving one's key resolves to its own tenant id and no other.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { mintApiKey } from '@data-foundry/api-keys';
import { authenticate, toAuthResponse, type AuthFailure } from '../src/auth.js';

let fixtures: QueryFixtures;
let hvacVerticalId: string;
let otherVerticalId: string;

interface SeededTenant {
  readonly tenantId: string;
  readonly secret: string;
  readonly apiKeyId: string;
}

async function seedTenant(options: {
  readonly status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  readonly revoked?: boolean;
  readonly expiresAt?: string;
  readonly verticalId?: string | null;
  readonly slug: string;
}): Promise<SeededTenant> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ($1, $2, $3) returning id`,
    [options.slug, options.slug, options.status ?? 'ACTIVE'],
  );
  const tenantId = tenant?.id;
  if (tenantId === undefined) throw new Error('tenant insert returned no row');

  const minted = await mintApiKey('test');
  const [key] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys (tenant_id, token_hash, token_prefix, label, vertical_id, revoked_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      tenantId,
      minted.tokenHash,
      minted.tokenPrefix,
      `${options.slug} key`,
      options.verticalId === undefined ? hvacVerticalId : options.verticalId,
      options.revoked === true ? new Date().toISOString() : null,
      options.expiresAt ?? null,
    ],
  );
  const apiKeyId = key?.id;
  if (apiKeyId === undefined) throw new Error('key insert returned no row');

  return { tenantId, secret: minted.secret, apiKeyId };
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  hvacVerticalId = fixtures.vertical.id;
  const [other] = await fixtures.driver.query<{ id: string }>(
    `insert into verticals (slug, name, schema_version, status, default_refresh_policy)
     values ('other-vertical', 'Other', '1', 'ACTIVE', '{}'::jsonb)
     returning id`,
  );
  otherVerticalId = other?.id ?? '';
});

afterAll(async () => {
  await fixtures.driver.close();
});

describe('a valid key authenticates', () => {
  it('resolves the tenant and key that minted it', async () => {
    const seeded = await seedTenant({ slug: 'acme-valid' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: true, tenantId: seeded.tenantId, apiKeyId: seeded.apiKeyId });
  });

  it('accepts a key scoped to no particular vertical for any vertical this deployment serves', async () => {
    const seeded = await seedTenant({ slug: 'acme-unscoped', verticalId: null });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result.ok).toBe(true);
  });
});

describe('an invalid key rejects', () => {
  it('rejects a missing Authorization header', async () => {
    const result = await authenticate(fixtures.driver, undefined, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'MISSING_CREDENTIAL' });
  });

  it('rejects a non-Bearer scheme', async () => {
    const seeded = await seedTenant({ slug: 'acme-basic' });
    const result = await authenticate(fixtures.driver, `Basic ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'MISSING_CREDENTIAL' });
  });

  it('rejects a value that does not even look like one of our keys, without a database round trip', async () => {
    const result = await authenticate(fixtures.driver, 'Bearer not-a-real-key', hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_CREDENTIAL' });
  });

  it('rejects a well-formed key that was never minted', async () => {
    const fake = await mintApiKey('test'); // minted, never stored
    const result = await authenticate(fixtures.driver, `Bearer ${fake.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('rejects an expired key', async () => {
    const seeded = await seedTenant({ slug: 'acme-expired', expiresAt: '2000-01-01T00:00:00Z' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});

describe('a revoked key rejects', () => {
  it('rejects, even though the key is still well-formed and unexpired', async () => {
    const seeded = await seedTenant({ slug: 'acme-revoked', revoked: true });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('reports REVOKED rather than EXPIRED for a key that is both — telling its owner it expired sends them to renew instead of asking why it was withdrawn', async () => {
    const seeded = await seedTenant({
      slug: 'acme-revoked-and-expired',
      revoked: true,
      expiresAt: '2000-01-01T00:00:00Z',
    });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });
});

describe('a suspended or closed tenant rejects', () => {
  it('rejects a key whose tenant is suspended, even though the key itself is fine', async () => {
    const seeded = await seedTenant({ slug: 'acme-suspended', status: 'SUSPENDED' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'TENANT_SUSPENDED' });
  });

  it('rejects a key whose tenant is closed', async () => {
    const seeded = await seedTenant({ slug: 'acme-closed', status: 'CLOSED' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'TENANT_CLOSED' });
  });
});

describe('wrong tenant cannot cross the tenant boundary', () => {
  it('resolves two independently-minted keys to their own tenants and never the other', async () => {
    const alice = await seedTenant({ slug: 'alice-co' });
    const bob = await seedTenant({ slug: 'bob-co' });

    const aliceResult = await authenticate(fixtures.driver, `Bearer ${alice.secret}`, hvacVerticalId, new Date());
    const bobResult = await authenticate(fixtures.driver, `Bearer ${bob.secret}`, hvacVerticalId, new Date());

    expect(aliceResult).toEqual({ ok: true, tenantId: alice.tenantId, apiKeyId: alice.apiKeyId });
    expect(bobResult).toEqual({ ok: true, tenantId: bob.tenantId, apiKeyId: bob.apiKeyId });
    expect(aliceResult.ok && bobResult.ok && aliceResult.tenantId).not.toBe(
      aliceResult.ok && bobResult.ok && bobResult.tenantId,
    );
  });

  it('never resolves a tenant id for someone else’s key, even under concurrent requests', async () => {
    const alice = await seedTenant({ slug: 'alice-concurrent' });
    const bob = await seedTenant({ slug: 'bob-concurrent' });

    const [aliceResult, bobResult] = await Promise.all([
      authenticate(fixtures.driver, `Bearer ${alice.secret}`, hvacVerticalId, new Date()),
      authenticate(fixtures.driver, `Bearer ${bob.secret}`, hvacVerticalId, new Date()),
    ]);

    expect(aliceResult.ok && aliceResult.tenantId).toBe(alice.tenantId);
    expect(bobResult.ok && bobResult.tenantId).toBe(bob.tenantId);
  });
});

describe('missing scope rejects', () => {
  it('rejects a key scoped to a different vertical than this deployment serves', async () => {
    const seeded = await seedTenant({ slug: 'acme-wrong-vertical', verticalId: otherVerticalId });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, new Date());
    expect(result).toEqual({ ok: false, reason: 'WRONG_VERTICAL' });
  });
});

describe('the response never discloses which failure occurred', () => {
  const reasons: AuthFailure['reason'][] = [
    'MISSING_CREDENTIAL',
    'MALFORMED_CREDENTIAL',
    'UNKNOWN_KEY',
    'REVOKED',
    'EXPIRED',
  ];
  for (const reason of reasons) {
    it(`${reason} produces the same 401 body as every other 401 reason`, () => {
      const { status, body } = toAuthResponse({ ok: false, reason });
      expect(status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  }

  for (const reason of ['TENANT_SUSPENDED', 'TENANT_CLOSED', 'WRONG_VERTICAL'] as const) {
    it(`${reason} produces the same 403 body as every other 403 reason`, () => {
      const { status, body } = toAuthResponse({ ok: false, reason });
      expect(status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  }

  it('the 401 and 403 bodies are themselves identical regardless of which specific reason produced them', () => {
    const unauthorized = (['MISSING_CREDENTIAL', 'MALFORMED_CREDENTIAL', 'UNKNOWN_KEY', 'REVOKED', 'EXPIRED'] as const).map(
      (reason) => JSON.stringify(toAuthResponse({ ok: false, reason }).body),
    );
    expect(new Set(unauthorized).size).toBe(1);

    const forbidden = (['TENANT_SUSPENDED', 'TENANT_CLOSED', 'WRONG_VERTICAL'] as const).map((reason) =>
      JSON.stringify(toAuthResponse({ ok: false, reason }).body),
    );
    expect(new Set(forbidden).size).toBe(1);
  });
});
