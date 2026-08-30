/**
 * Authentication and scope enforcement, against a real database.
 *
 * The property under test throughout is reject-before-execution: every
 * failure case here is checked without ever building a `QueryModel` call, and
 * the cross-tenant case is checked by actually minting two tenants and
 * proving one's key resolves to its own tenant id and no other.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { mintApiKey } from '@data-foundry/api-keys';
import type { SqlExecutor } from '@data-foundry/canonical-store';
import {
  authenticate as authenticateRequest,
  toAuthResponse,
  type AuthFailure,
} from '../src/auth.js';

const authenticate = (
  executor: SqlExecutor,
  authorizationHeader: string | null | undefined,
  verticalId: string,
  environment: 'test' | 'live',
  now: Date,
  expectedBillingSource: 'DIRECT' | 'RAPIDAPI' = 'DIRECT',
) =>
  authenticateRequest(executor, authorizationHeader, {
    verticalId,
    environment,
    expectedBillingSource,
    now,
  });

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
  readonly verticalId?: string;
  readonly accessTier?: 'API_FREE' | 'API_PAID' | 'RAPIDAPI';
  readonly billingSource?: 'DIRECT' | 'RAPIDAPI';
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
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, revoked_at, expires_at,
        access_tier, billing_source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      tenantId,
      minted.tokenHash,
      minted.tokenPrefix,
      `${options.slug} key`,
      options.verticalId === undefined ? hvacVerticalId : options.verticalId,
      options.revoked === true ? new Date().toISOString() : null,
      options.expiresAt ?? null,
      options.accessTier ?? 'API_PAID',
      options.billingSource ?? 'DIRECT',
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
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({
      ok: true,
      tenantId: seeded.tenantId,
      apiKeyId: seeded.apiKeyId,
      verticalId: hvacVerticalId,
      accessTier: 'API_PAID',
      billingSource: 'DIRECT',
    });
  });
});

describe('an invalid key rejects', () => {
  it('rejects a missing Authorization header', async () => {
    const result = await authenticate(fixtures.driver, undefined, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'MISSING_CREDENTIAL' });
  });

  it('rejects a non-Bearer scheme', async () => {
    const seeded = await seedTenant({ slug: 'acme-basic' });
    const result = await authenticate(fixtures.driver, `Basic ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'MISSING_CREDENTIAL' });
  });

  it('rejects a value that does not even look like one of our keys, without a database round trip', async () => {
    const result = await authenticate(fixtures.driver, 'Bearer not-a-real-key', hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_CREDENTIAL' });
  });

  it('rejects a well-formed key that was never minted', async () => {
    const fake = await mintApiKey('test'); // minted, never stored
    const result = await authenticate(fixtures.driver, `Bearer ${fake.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('rejects an expired key', async () => {
    const seeded = await seedTenant({ slug: 'acme-expired', expiresAt: '2000-01-01T00:00:00Z' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a key for another environment before any database lookup', async () => {
    const live = await mintApiKey('live');
    const query = vi.fn(async () => {
      throw new Error('database must not be consulted');
    });
    const executor = { query } as unknown as SqlExecutor;

    const result = await authenticate(executor, `Bearer ${live.secret}`, hvacVerticalId, 'test', new Date());

    expect(result).toEqual({ ok: false, reason: 'WRONG_ENVIRONMENT' });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('a revoked key rejects', () => {
  it('rejects, even though the key is still well-formed and unexpired', async () => {
    const seeded = await seedTenant({ slug: 'acme-revoked', revoked: true });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('reports REVOKED rather than EXPIRED for a key that is both — telling its owner it expired sends them to renew instead of asking why it was withdrawn', async () => {
    const seeded = await seedTenant({
      slug: 'acme-revoked-and-expired',
      revoked: true,
      expiresAt: '2000-01-01T00:00:00Z',
    });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });
});

describe('a suspended or closed tenant rejects', () => {
  it('rejects a key whose tenant is suspended, even though the key itself is fine', async () => {
    const seeded = await seedTenant({ slug: 'acme-suspended', status: 'SUSPENDED' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'TENANT_SUSPENDED' });
  });

  it('fails closed for an unknown future or corrupt tenant status', async () => {
    const minted = await mintApiKey('test');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from api_keys')) {
        return [{
          id: '11111111-1111-4111-8111-111111111111',
          tenant_id: '22222222-2222-4222-8222-222222222222',
          token_hash: minted.tokenHash,
          token_prefix: minted.tokenPrefix,
          vertical_id: hvacVerticalId,
          access_tier: 'API_PAID',
          billing_source: 'DIRECT',
          revoked_at: null,
          expires_at: null,
        }];
      }
      return [{ id: '22222222-2222-4222-8222-222222222222', status: 'PAUSED' }];
    });

    const result = await authenticate(
      { query } as unknown as SqlExecutor,
      `Bearer ${minted.secret}`,
      hvacVerticalId,
      'test',
      new Date(),
    );

    expect(result).toEqual({ ok: false, reason: 'TENANT_INACTIVE' });
  });

  it('rejects a key whose tenant is closed', async () => {
    const seeded = await seedTenant({ slug: 'acme-closed', status: 'CLOSED' });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'TENANT_CLOSED' });
  });
});

describe('wrong tenant cannot cross the tenant boundary', () => {
  it('resolves two independently-minted keys to their own tenants and never the other', async () => {
    const alice = await seedTenant({ slug: 'alice-co' });
    const bob = await seedTenant({ slug: 'bob-co' });

    const aliceResult = await authenticate(fixtures.driver, `Bearer ${alice.secret}`, hvacVerticalId, 'test', new Date());
    const bobResult = await authenticate(fixtures.driver, `Bearer ${bob.secret}`, hvacVerticalId, 'test', new Date());

    expect(aliceResult).toEqual({ ok: true, tenantId: alice.tenantId, apiKeyId: alice.apiKeyId, verticalId: hvacVerticalId, accessTier: 'API_PAID', billingSource: 'DIRECT' });
    expect(bobResult).toEqual({ ok: true, tenantId: bob.tenantId, apiKeyId: bob.apiKeyId, verticalId: hvacVerticalId, accessTier: 'API_PAID', billingSource: 'DIRECT' });
    expect(aliceResult.ok && bobResult.ok && aliceResult.tenantId).not.toBe(
      aliceResult.ok && bobResult.ok && bobResult.tenantId,
    );
  });

  it('never resolves a tenant id for someone else’s key, even under concurrent requests', async () => {
    const alice = await seedTenant({ slug: 'alice-concurrent' });
    const bob = await seedTenant({ slug: 'bob-concurrent' });

    const [aliceResult, bobResult] = await Promise.all([
      authenticate(fixtures.driver, `Bearer ${alice.secret}`, hvacVerticalId, 'test', new Date()),
      authenticate(fixtures.driver, `Bearer ${bob.secret}`, hvacVerticalId, 'test', new Date()),
    ]);

    expect(aliceResult.ok && aliceResult.tenantId).toBe(alice.tenantId);
    expect(bobResult.ok && bobResult.tenantId).toBe(bob.tenantId);
  });
});

describe('missing scope rejects', () => {
  it('rejects a key scoped to a different vertical than this deployment serves', async () => {
    const seeded = await seedTenant({ slug: 'acme-wrong-vertical', verticalId: otherVerticalId });
    const result = await authenticate(fixtures.driver, `Bearer ${seeded.secret}`, hvacVerticalId, 'test', new Date());
    expect(result).toEqual({ ok: false, reason: 'WRONG_VERTICAL' });
  });
});

describe('access tier and billing channel are part of authentication', () => {
  it('rejects a quarantined legacy key whose access profile has not been classified', async () => {
    const minted = await mintApiKey('test');
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes('from api_keys')) {
        throw new Error('tenant lookup must not run for an unclassified key');
      }
      return [{
        id: '11111111-1111-4111-8111-111111111111',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        token_hash: minted.tokenHash,
        token_prefix: minted.tokenPrefix,
        vertical_id: hvacVerticalId,
        access_tier: null,
        billing_source: null,
        revoked_at: null,
        expires_at: null,
      }];
    });

    const result = await authenticate(
      { query } as unknown as SqlExecutor,
      `Bearer ${minted.secret}`,
      hvacVerticalId,
      'test',
      new Date(),
    );

    expect(result).toEqual({ ok: false, reason: 'ACCESS_PROFILE_MISSING' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a RapidAPI marketplace key at the direct API edge', async () => {
    const seeded = await seedTenant({
      slug: 'rapidapi-at-direct-edge',
      accessTier: 'RAPIDAPI',
      billingSource: 'RAPIDAPI',
    });
    const result = await authenticate(
      fixtures.driver,
      `Bearer ${seeded.secret}`,
      hvacVerticalId,
      'test',
      new Date(),
      'DIRECT',
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_BILLING_SOURCE' });
  });

  it('rejects a direct key at the marketplace edge', async () => {
    const seeded = await seedTenant({ slug: 'direct-at-rapidapi-edge' });
    const result = await authenticate(
      fixtures.driver,
      `Bearer ${seeded.secret}`,
      hvacVerticalId,
      'test',
      new Date(),
      'RAPIDAPI',
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_BILLING_SOURCE' });
  });

  it('accepts a direct free-tier key and preserves its surface classification', async () => {
    const seeded = await seedTenant({
      slug: 'direct-free-tier',
      accessTier: 'API_FREE',
      billingSource: 'DIRECT',
    });
    const result = await authenticate(
      fixtures.driver,
      `Bearer ${seeded.secret}`,
      hvacVerticalId,
      'test',
      new Date(),
    );
    expect(result).toMatchObject({
      ok: true,
      accessTier: 'API_FREE',
      billingSource: 'DIRECT',
    });
  });
});

describe('the response never discloses which failure occurred', () => {
  const reasons: AuthFailure['reason'][] = [
    'MISSING_CREDENTIAL',
    'MALFORMED_CREDENTIAL',
    'UNKNOWN_KEY',
    'REVOKED',
    'EXPIRED',
    'WRONG_ENVIRONMENT',
  ];
  for (const reason of reasons) {
    it(`${reason} produces the same 401 body as every other 401 reason`, () => {
      const { status, body } = toAuthResponse({ ok: false, reason });
      expect(status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  }

  for (const reason of ['TENANT_SUSPENDED', 'TENANT_CLOSED', 'TENANT_INACTIVE', 'WRONG_VERTICAL', 'ACCESS_PROFILE_MISSING', 'WRONG_BILLING_SOURCE'] as const) {
    it(`${reason} produces the same 403 body as every other 403 reason`, () => {
      const { status, body } = toAuthResponse({ ok: false, reason });
      expect(status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  }

  it('the 401 and 403 bodies are themselves identical regardless of which specific reason produced them', () => {
    const unauthorized = (['MISSING_CREDENTIAL', 'MALFORMED_CREDENTIAL', 'UNKNOWN_KEY', 'REVOKED', 'EXPIRED', 'WRONG_ENVIRONMENT'] as const).map(
      (reason) => JSON.stringify(toAuthResponse({ ok: false, reason }).body),
    );
    expect(new Set(unauthorized).size).toBe(1);

    const forbidden = (['TENANT_SUSPENDED', 'TENANT_CLOSED', 'TENANT_INACTIVE', 'WRONG_VERTICAL', 'ACCESS_PROFILE_MISSING', 'WRONG_BILLING_SOURCE'] as const).map((reason) =>
      JSON.stringify(toAuthResponse({ ok: false, reason }).body),
    );
    expect(new Set(forbidden).size).toBe(1);
  });
});
