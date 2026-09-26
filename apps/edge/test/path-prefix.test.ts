/**
 * The canonical `api.data.aroqon.com/v1/<slug>/...` contract (ADR-0012) served
 * by a per-vertical edge Worker (ADR-0011) through `API_PATH_PREFIX`.
 *
 * The prefix is stripped before authentication, routing, billing and metering,
 * every self-link is mapped back, a path outside the prefix is a 404 that never
 * authenticates or meters, and a deployment without the variable behaves
 * exactly as it did before. The bundled vertical is `hvac`, so these tests use
 * `/v1/hvac`; the mechanism is slug-agnostic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { entityQualityScore, type Entity } from '../../../packages/canonical-schema/src/index.js';
import { mintApiKey } from '@data-foundry/api-keys';
import type { UsageEvent } from '@data-foundry/usage-events';
import {
  API_PATH_PREFIX_PATTERN,
  resolveEdgeConfig,
  resetDeployments,
  serveRequest,
  toInternalPath,
  toPublicLink,
  toPublicPath,
  type QueueBinding,
} from '../src/index.js';

const PREFIX = '/v1/hvac';
const ORIGIN = 'https://api.data.aroqon.com';
const PRICE_IDS = { developer: 'price_Developer0001', growth: 'price_Growth000001', scale: 'price_Scale0000001' };

let fixtures: QueryFixtures;
let merged: Entity;
let secret: string;

const ctx = { waitUntil: () => undefined };
const openFixtureDriver = async () => fixtures.driver;

function recordingQueue(): { queue: QueueBinding; sent: UsageEvent[] } {
  const sent: UsageEvent[] = [];
  return { queue: { send: async (message: unknown) => { sent.push(message as UsageEvent); } }, sent };
}

function env(queue: QueueBinding, overrides: Record<string, string | undefined> = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    POSTGRES_URL: 'postgres://fixture/db',
    VERTICAL_SLUG: 'hvac',
    API_KEY_ENVIRONMENT: 'test',
    USAGE_EVENTS_QUEUE: queue,
    API_PATH_PREFIX: PREFIX,
    ...overrides,
  };
}

function billingVars(): Record<string, string> {
  return {
    STRIPE_SECRET_KEY: 'sk_test_0123456789abcdef',
    STRIPE_WEBHOOK_SECRET: 'whsec_edge_prefix_secret',
    STRIPE_PRICE_IDS: JSON.stringify(PRICE_IDS),
    BILLING_PUBLIC_ORIGIN: ORIGIN,
    BILLING_RETURN_URL: 'https://data.aroqon.com/hvac/pricing',
  };
}

async function get(path: string, environment: ReturnType<typeof env>, init: RequestInit = {}): Promise<Response> {
  return serveRequest(new Request(`${ORIGIN}${path}`, init), environment, ctx, openFixtureDriver);
}

const auth = (): RequestInit => ({ headers: { authorization: `Bearer ${secret}` } });

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['API_PAID']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
  merged = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Carrier Infinity 24ANB7 (prefix duplicate)',
    canonical_slug: 'carrier-infinity-24anb7-prefix-dup',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.4),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await addSyntheticEntityEvidence(fixtures, merged);
  await fixtures.store.mergeEntities({
    from_entity_id: merged.id,
    to_entity_id: fixtures.equipment.id,
    reason: 'MERGE',
    from_slug: merged.canonical_slug,
    judgment_id: null,
  });

  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ('prefix-e2e', 'prefix-e2e', 'ACTIVE') returning id`,
  );
  const minted = await mintApiKey('test');
  await fixtures.driver.query(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, 'prefix key', $4, 'API_PAID', 'DIRECT')`,
    [tenant!.id, minted.tokenHash, minted.tokenPrefix, fixtures.vertical.id],
  );
  secret = minted.secret;
}, 300_000);

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('path mapping', () => {
  it('strips the prefix by whole segment and refuses everything outside it', () => {
    expect(toInternalPath('/v1/hvac/search', PREFIX)).toBe('/v1/search');
    expect(toInternalPath('/v1/hvac/billing/checkout', PREFIX)).toBe('/v1/billing/checkout');
    expect(toInternalPath('/v1/hvac', PREFIX)).toBe('/v1');
    expect(toInternalPath('/v1/hvac/', PREFIX)).toBe('/v1/');
    for (const outside of ['/', '/v1', '/v1/search', '/v1/hvacx/search', '/v1/hvac-archive/search', '/V1/hvac/search', '/v2/hvac/search']) {
      expect(toInternalPath(outside, PREFIX)).toBeNull();
    }
    // Without a prefix the path is the request's own.
    expect(toInternalPath('/v1/search', null)).toBe('/v1/search');
    expect(toInternalPath('/anything', null)).toBe('/anything');
  });

  it('maps internal self-links back to the public contract and leaves foreign links alone', () => {
    expect(toPublicPath('/v1/entities/abc?x=1', PREFIX)).toBe('/v1/hvac/entities/abc?x=1');
    expect(toPublicPath('/v1', PREFIX)).toBe('/v1/hvac');
    expect(toPublicPath('/v10/entities', PREFIX)).toBe('/v10/entities');
    expect(toPublicPath('/other', PREFIX)).toBe('/other');
    expect(toPublicPath('/v1/entities/abc', null)).toBe('/v1/entities/abc');
    expect(toPublicLink(`${ORIGIN}/v1/billing/claim?session_id=x`, PREFIX, ORIGIN)).toBe(
      `${ORIGIN}/v1/hvac/billing/claim?session_id=x`,
    );
    expect(toPublicLink('https://checkout.stripe.com/v1/pay', PREFIX, ORIGIN)).toBe('https://checkout.stripe.com/v1/pay');
    expect(toPublicLink('//evil.example/v1/x', PREFIX, ORIGIN)).toBe('//evil.example/v1/x');
  });

  it('validates API_PATH_PREFIX strictly against its own vertical', () => {
    const base = { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://x/y', VERTICAL_SLUG: 'hvac', API_KEY_ENVIRONMENT: 'test' };
    expect(resolveEdgeConfig(base).apiPathPrefix).toBeNull();
    expect(resolveEdgeConfig({ ...base, API_PATH_PREFIX: '/v1/hvac' }).apiPathPrefix).toBe('/v1/hvac');
    for (const bad of ['', ' /v1/hvac', '/v1/hvac/', '/v1/HVAC', '/v2/hvac', '/v1/1hvac', 'v1/hvac', '/v1/hvac/search', `/v1/${'a'.repeat(64)}`]) {
      expect(() => resolveEdgeConfig({ ...base, API_PATH_PREFIX: bad }), bad).toThrow(/API_PATH_PREFIX/);
    }
    expect(() => resolveEdgeConfig({ ...base, API_PATH_PREFIX: '/v1/vehicles' })).toThrow(/VERTICAL_SLUG/);
    expect(API_PATH_PREFIX_PATTERN.test(`/v1/a${'b'.repeat(62)}`)).toBe(true);
    expect(API_PATH_PREFIX_PATTERN.test(`/v1/a${'b'.repeat(63)}`)).toBe(false);
  });
});

describe('a prefixed deployment', () => {
  it('serves /v1/<slug>/... with the internal route key and meters it unchanged', async () => {
    const { queue, sent } = recordingQueue();
    const response = await get(`${PREFIX}/entities/${fixtures.equipment.id}`, env(queue), auth());
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ route_key: 'entities.detail', status: 200 });

    const search = await get(`${PREFIX}/search?q=carrier`, env(queue), auth());
    expect(search.status).toBe(200);
    expect(sent[1]).toMatchObject({ route_key: 'search' });
  });

  it('answers 404 outside the prefix before authentication or metering', async () => {
    const { queue, sent } = recordingQueue();
    for (const path of ['/v1/search', '/v1/health', '/', '/v1/hvacx/health', '/v1/vehicles/health', '/v1/billing/plans']) {
      const response = await get(path, env(queue, billingVars()), auth());
      expect(response.status, path).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
    const head = await get('/v1/search', env(queue), { method: 'HEAD', ...auth() });
    expect(head.status).toBe(404);
    expect(await head.text()).toBe('');
    expect(sent).toHaveLength(0);
  });

  it('refuses a prefix for another vertical as a configuration failure', async () => {
    const { queue } = recordingQueue();
    const response = await get('/v1/vehicles/health', env(queue, { API_PATH_PREFIX: '/v1/vehicles' }), auth());
    expect(response.status).toBe(503);
    expect(response.headers.get('x-unavailable-reason')).toBe('configuration');
  });

  it('rewrites a 301 entity redirect Location and body to the public prefix', async () => {
    const { queue, sent } = recordingQueue();
    const response = await get(`${PREFIX}/entities/${merged.id}/facts?limit=5`, env(queue), auth());
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${PREFIX}/entities/${fixtures.equipment.id}/facts`);
    const body = (await response.json()) as { redirect: { location: string } };
    expect(body.redirect.location).toBe(`${PREFIX}/entities/${fixtures.equipment.id}/facts`);
    expect(Number(response.headers.get('content-length'))).toBe(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    );
    expect(sent[0]).toMatchObject({ route_key: 'entities.facts', status: 301 });
  });

  it('spells the contract document routes and a route-not-found echo under the prefix', async () => {
    const { queue } = recordingQueue();
    const contract = await get(PREFIX, env(queue), auth());
    expect(contract.status).toBe(200);
    const routes = ((await contract.json()) as { routes: { path: string }[] }).routes.map((route) => route.path);
    expect(routes.length).toBeGreaterThan(0);
    for (const path of routes) expect(path.startsWith(`${PREFIX}/`), path).toBe(true);

    const missing = await get(`${PREFIX}/nope`, env(queue), auth());
    expect(missing.status).toBe(404);
    const body = (await missing.json()) as { error: { details?: { path?: string } } };
    expect(body.error.details?.path).toBe(`${PREFIX}/nope`);
  });

  it('builds the Checkout success_url and billing hints under the prefix', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      calls.push({ url: String(input), body: String(init.body ?? '') });
      return Response.json({ id: 'cs_test_prefix00000001', url: 'https://checkout.stripe.com/c/pay/cs_test_prefix00000001', metadata: {} });
    });
    const { queue } = recordingQueue();
    const response = await get(`${PREFIX}/billing/checkout`, env(queue, billingVars()), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'plan=developer',
    });
    expect(response.status).toBe(303);
    // A third-party Location is never rewritten.
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_test_prefix00000001');
    const sent = new URLSearchParams(calls[0]!.body);
    expect(sent.get('success_url')).toBe(`${ORIGIN}${PREFIX}/billing/claim?session_id={CHECKOUT_SESSION_ID}`);
    expect(sent.get('metadata[vertical_slug]')).toBe('hvac');

    const unknown = await get(`${PREFIX}/billing/checkout`, env(queue, billingVars()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'nope' }),
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { message: string } }).error.message).toContain(`GET ${PREFIX}/billing/plans`);

    const plans = await get(`${PREFIX}/billing/plans`, env(queue, billingVars()));
    expect(plans.status).toBe(200);
  });
});

describe('an un-prefixed deployment is unchanged', () => {
  it('serves /v1/... and emits un-prefixed self-links', async () => {
    const { queue, sent } = recordingQueue();
    const unprefixed = env(queue, { API_PATH_PREFIX: undefined });
    const redirect = await get(`/v1/entities/${merged.id}`, unprefixed, auth());
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe(`/v1/entities/${fixtures.equipment.id}`);
    expect(((await redirect.json()) as { redirect: { location: string } }).redirect.location).toBe(
      `/v1/entities/${fixtures.equipment.id}`,
    );
    // The prefixed spelling is simply an unknown API version path here.
    const prefixed = await get(`${PREFIX}/health`, unprefixed, auth());
    expect(prefixed.status).toBe(404);
    expect(sent[0]).toMatchObject({ route_key: 'entities.detail', status: 301 });
  });

  it('returns byte-identical responses to an absent variable for the same request', async () => {
    const first = recordingQueue();
    const withoutKey = env(first.queue);
    delete (withoutKey as Record<string, unknown>)['API_PATH_PREFIX'];
    const a = await get('/v1/health', withoutKey, auth());
    resetDeployments();
    const second = recordingQueue();
    const b = await get('/v1/health', env(second.queue, { API_PATH_PREFIX: undefined }), auth());
    expect(a.status).toBe(b.status);
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
    expect(await a.text()).toBe(await b.text());
  });
});
