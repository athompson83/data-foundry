/**
 * The marketplace channel is a transport adapter, not a second API.
 *
 * These tests drive the same `serveRequest` entry point as direct customers.
 * The only marketplace-specific decisions allowed above it are origin
 * authentication and selection of the server-held RAPIDAPI/RAPIDAPI key.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintApiKey, type ApiAccessTier, type ApiBillingSource } from '@data-foundry/api-keys';
import type { UsageEvent } from '@data-foundry/usage-events';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import {
  resetDeployments,
  serveRequest,
  type QueueBinding,
} from '../src/index.js';

let fixtures: QueryFixtures;

interface SeededKey {
  readonly secret: string;
  readonly tenantId: string;
  readonly apiKeyId: string;
}

async function seedKey(
  slug: string,
  accessTier: ApiAccessTier,
  billingSource: ApiBillingSource,
): Promise<SeededKey> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ($1, $2, 'ACTIVE') returning id`,
    [slug, slug],
  );
  if (tenant === undefined) throw new Error('tenant insert returned no row');

  const minted = await mintApiKey('test');
  const [key] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      tenant.id,
      minted.tokenHash,
      minted.tokenPrefix,
      `${slug} key`,
      fixtures.vertical.id,
      accessTier,
      billingSource,
    ],
  );
  if (key === undefined) throw new Error('key insert returned no row');
  return { secret: minted.secret, tenantId: tenant.id, apiKeyId: key.id };
}

function recordingQueue(): { readonly queue: QueueBinding; readonly sent: UsageEvent[] } {
  const sent: UsageEvent[] = [];
  return {
    queue: { send: async (message: unknown) => { sent.push(message as UsageEvent); } },
    sent,
  };
}

function immediateContext(): {
  readonly ctx: { waitUntil(promise: Promise<unknown>): void };
  readonly settle: () => Promise<void>;
} {
  let pending: Promise<unknown> = Promise.resolve();
  return {
    ctx: { waitUntil: (promise) => { pending = promise; } },
    settle: async () => { await pending; },
  };
}

const openFixtureDriver = async () => fixtures.driver;

function marketplaceEnv(key: SeededKey, queue: QueueBinding) {
  return {
    POSTGRES_URL: 'postgres://fixture/db',
    VERTICAL_SLUG: 'hvac',
    API_KEY_ENVIRONMENT: 'test',
    RAPIDAPI_HOSTNAME: 'marketplace.edge.invalid',
    RAPIDAPI_PROXY_SECRET: 'marketplace-proxy-secret-for-tests',
    RAPIDAPI_API_KEY: key.secret,
    USAGE_EVENTS_QUEUE: queue,
  };
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['API_PAID', 'RAPIDAPI']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
  vi.restoreAllMocks();
});

describe('the RapidAPI marketplace origin', () => {
  it('uses the server-held marketplace key and meters RAPIDAPI/RAPIDAPI through the canonical API', async () => {
    const marketplace = await seedKey('rapidapi-marketplace', 'RAPIDAPI', 'RAPIDAPI');
    const direct = await seedKey('rapidapi-direct-decoy', 'API_PAID', 'DIRECT');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const response = await serveRequest(
      new Request(`https://marketplace.edge.invalid/v1/entities/${fixtures.equipment.id}`, {
        headers: {
          // A caller-controlled direct credential must not select the tenant or
          // billing channel on the marketplace origin.
          authorization: `Bearer ${direct.secret}`,
          'x-rapidapi-proxy-secret': 'marketplace-proxy-secret-for-tests',
        },
      }),
      marketplaceEnv(marketplace, queue),
      ctx,
      openFixtureDriver,
    );
    await settle();

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      tenant_id: marketplace.tenantId,
      api_key_id: marketplace.apiKeyId,
      access_tier: 'RAPIDAPI',
      billing_source: 'RAPIDAPI',
      route_key: 'entities.detail',
    });
  });

  it('rejects a missing or invalid proxy secret with one opaque response', async () => {
    const marketplace = await seedKey('rapidapi-invalid-proxy', 'RAPIDAPI', 'RAPIDAPI');
    const { queue, sent } = recordingQueue();
    const env = marketplaceEnv(marketplace, queue);
    const requests = [
      new Request('https://marketplace.edge.invalid/v1/health'),
      new Request('https://marketplace.edge.invalid/v1/health', {
        headers: { 'x-rapidapi-proxy-secret': 'wrong' },
      }),
      new Request('https://marketplace.edge.invalid/v1/health', {
        headers: { 'x-rapidapi-proxy-secret': 'marketplace-proxy-secret-for-tests-extra' },
      }),
    ];

    const bodies: string[] = [];
    for (const request of requests) {
      const { ctx, settle } = immediateContext();
      const response = await serveRequest(request, env, ctx, openFixtureDriver);
      bodies.push(await response.text());
      await settle();
      expect(response.status).toBe(401);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('proxy');
    expect(bodies[0]).not.toContain('secret');
    expect(sent).toEqual([]);
  });

  it('does not let RapidAPI-shaped headers turn the direct origin into a marketplace request', async () => {
    const marketplace = await seedKey('rapidapi-spoof-marketplace', 'RAPIDAPI', 'RAPIDAPI');
    const direct = await seedKey('rapidapi-spoof-direct', 'API_PAID', 'DIRECT');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const response = await serveRequest(
      new Request('https://edge.invalid/v1/health', {
        headers: {
          authorization: `Bearer ${direct.secret}`,
          'x-rapidapi-proxy-secret': 'marketplace-proxy-secret-for-tests',
        },
      }),
      marketplaceEnv(marketplace, queue),
      ctx,
      openFixtureDriver,
    );
    await settle();

    expect(response.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it('fails closed as a generic configuration error when marketplace credentials are incomplete', async () => {
    const marketplace = await seedKey('rapidapi-missing-config', 'RAPIDAPI', 'RAPIDAPI');
    const { queue } = recordingQueue();
    const complete = marketplaceEnv(marketplace, queue);
    const { RAPIDAPI_PROXY_SECRET: _proxySecret, ...withoutProxySecret } = complete;
    const { RAPIDAPI_API_KEY: _apiKey, ...withoutApiKey } = complete;
    const partials = [
      withoutProxySecret,
      withoutApiKey,
      {
        POSTGRES_URL: complete.POSTGRES_URL,
        VERTICAL_SLUG: complete.VERTICAL_SLUG,
        API_KEY_ENVIRONMENT: complete.API_KEY_ENVIRONMENT,
        USAGE_EVENTS_QUEUE: queue,
      },
    ];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bodies: string[] = [];
    for (const env of partials) {
      const { ctx } = immediateContext();
      const response = await serveRequest(
        new Request('https://marketplace.edge.invalid/v1/health', {
          headers: { 'x-rapidapi-proxy-secret': 'marketplace-proxy-secret-for-tests' },
        }),
        env,
        ctx,
        openFixtureDriver,
      );
      expect(response.status).toBe(503);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('RAPIDAPI');
    expect(bodies[0]).not.toContain(marketplace.secret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(marketplace.secret);
  });

  it('does not meter or log request targets, queries, entity ids, bodies, or plaintext credentials', async () => {
    const marketplace = await seedKey('rapidapi-private', 'RAPIDAPI', 'RAPIDAPI');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const proxySecret = 'marketplace-proxy-secret-for-tests';
    const querySecret = 'never-persist-this-query';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await serveRequest(
      new Request(
        `https://marketplace.edge.invalid/v1/entities/${fixtures.equipment.id}?private=${querySecret}`,
        {
          headers: {
            'x-rapidapi-proxy-secret': proxySecret,
            'x-rapidapi-user': 'marketplace-user-private',
          },
        },
      ),
      marketplaceEnv(marketplace, queue),
      ctx,
      openFixtureDriver,
    );
    const responseBody = await response.clone().text();
    await settle();

    expect(response.status).toBe(200);
    const persistedShape = JSON.stringify(sent);
    const loggedShape = JSON.stringify(errorSpy.mock.calls);
    for (const forbidden of [
      proxySecret,
      marketplace.secret,
      querySecret,
      fixtures.equipment.id,
      responseBody,
      'marketplace-user-private',
    ]) {
      expect(persistedShape, forbidden).not.toContain(forbidden);
      expect(loggedShape, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the direct origin remains direct', () => {
  it('continues to authenticate a direct key when no marketplace signal is present', async () => {
    const direct = await seedKey('direct-still-direct', 'API_PAID', 'DIRECT');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const response = await serveRequest(
      new Request('https://edge.invalid/v1/health', {
        headers: { authorization: `Bearer ${direct.secret}` },
      }),
      {
        POSTGRES_URL: 'postgres://fixture/db',
        VERTICAL_SLUG: 'hvac',
        API_KEY_ENVIRONMENT: 'test',
        USAGE_EVENTS_QUEUE: queue,
      },
      ctx,
      openFixtureDriver,
    );
    await settle();

    expect(response.status).toBe(200);
    expect(sent[0]).toMatchObject({ access_tier: 'API_PAID', billing_source: 'DIRECT' });
  });
});
