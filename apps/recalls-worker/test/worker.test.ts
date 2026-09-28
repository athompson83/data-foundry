import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeRequest, findCustomerByKey, issueKey, mintApiKey, KEY_PREFIX } from '../src/account.js';
import { gtinCandidates, lookupCandidates } from '../src/api.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ndjsonBundle, parseRawRef, prepareRecall, rawRef, renderLiteral, writeRecallGroups, writeRecallStatements } from '../src/store.js';
import { formEncode, verifyStripeSignature } from '../src/stripe.js';
import { indexNowBodies, pingChangedRecalls, productName } from '../src/seo.js';
import { scheduledSync, syncWindow } from '../src/sync.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';
import { DEVICE, FOOD } from './fixtures.js';

function makeEnv(overrides: Partial<Env> = {}): Env & { bucket: ReturnType<typeof createTestBucket> } {
  const { db } = createTestDatabase();
  const bucket = createTestBucket();
  return {
    DB: db,
    RAW_ARTIFACTS: bucket,
    bucket,
    PUBLIC_ORIGIN: 'https://data.aroqon.com',
    API_ORIGIN: 'https://api.data.aroqon.com',
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_value',
    STRIPE_PRICE_EVALUATE: 'price_eval',
    STRIPE_PRICE_DEVELOPER: 'price_dev',
    STRIPE_PRICE_GROWTH: 'price_growth',
    STRIPE_PRICE_SCALE: 'price_scale',
    SALES_OPEN: '1',
    ...overrides,
  };
}

async function seed(env: Env): Promise<void> {
  const now = '2026-09-26T00:00:00.000Z';
  const prepared = [await prepareRecall('food', FOOD), await prepareRecall('device', DEVICE)];
  const bundle = ndjsonBundle(prepared.map((item) => item.raw));
  await env.RAW_ARTIFACTS.put('recalls/test.ndjson', bundle.body);
  for (const [index, item] of prepared.entries()) {
    const range = bundle.ranges[index] as { offset: number; length: number };
    const statements = writeRecallStatements(item, rawRef('recalls/test.ndjson', range.offset, range.length), now);
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
  }
}

async function seedCustomer(env: Env, plan: 'evaluate' | 'developer' = 'evaluate', status = 'active'): Promise<string> {
  await env.DB.prepare("INSERT INTO customer (id, email, stripe_customer_id, stripe_subscription_id, plan, status, created_at, updated_at) VALUES ('c1', 'a@example.com', 'cus_1', 'sub_1', ?, ?, 'now', 'now')")
    .bind(plan, status)
    .run();
  return issueKey(env.DB, 'c1', null);
}

function get(path: string, key?: string, host = 'api.data.aroqon.com'): Request {
  return new Request(`https://${host}${path}`, key ? { headers: { authorization: `Bearer ${key}` } } : {});
}

beforeEach(() => {
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => void store.set(request.url, response),
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keys and allowances', () => {
  it('mints unguessable prefixed keys and stores only hashes', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env);
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(key).toHaveLength(KEY_PREFIX.length + 32);
    expect(mintApiKey()).not.toBe(mintApiKey());
    const stored = await env.DB.prepare('SELECT key_hash FROM api_key').first<{ key_hash: string }>();
    expect(stored?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.key_hash).not.toContain(key.slice(KEY_PREFIX.length));
  });

  it('hard-stops at the plan allowance', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env, 'evaluate');
    const customer = await findCustomerByKey(env.DB, key);
    if (!customer) throw new Error('customer not found');
    for (let index = 1; index <= 100; index += 1) expect(await consumeRequest(env.DB, customer)).toBe(index);
    expect(await consumeRequest(env.DB, customer)).toBeNull();
    // A new month resets the allowance.
    expect(await consumeRequest(env.DB, customer, new Date('2099-01-15T00:00:00Z'))).toBe(1);
  });
});

describe('API surface', () => {
  it('requires a key, meters, and returns structured records', async () => {
    const env = makeEnv();
    await seed(env);
    expect((await worker.fetch(get('/v1/recalls'), env)).status).toBe(401);
    expect((await worker.fetch(get('/v1/recalls', 'rcl_live_nope'), env)).status).toBe(401);

    const key = await seedCustomer(env);
    const response = await worker.fetch(get('/v1/recalls?state=TX&allergen=peanut', key), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99');
    const body = (await response.json()) as { data: Array<Record<string, any>> };
    expect(body.data.map((recall) => recall['recall_number'])).toEqual(['F-0001-2026']);
    const recall = body.data[0] as Record<string, any>;
    expect(recall['codes'].lots).toEqual(['AC2601', 'AC2602']);
    expect(recall['codes'].gtins).toEqual(['00012345678905']);
    expect(recall['codes'].expiration_dates).toEqual(['2027-03-01', '2027-03-08']);
    expect(recall['reason'].allergens).toEqual(['peanut']);
    expect(recall['provenance'].raw_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recall['raw']).toBeUndefined();
  });

  it('serves verified raw evidence from its exact R2 byte range', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env);
    const body = (await (await worker.fetch(get('/v1/recalls/Z-0002-2026?include=raw', key), env)).json()) as { data: { raw: Record<string, unknown>; provenance: { raw_evidence: string } } };
    expect(body.data.raw).toEqual(DEVICE);
    expect(body.data.provenance.raw_evidence).toBe('recalls/test.ndjson');
    expect((await worker.fetch(get('/v1/recalls?include=raw&limit=50', key), env)).status).toBe(400);
    // Tampered evidence is refused rather than served.
    env.bucket.objects.set('recalls/test.ndjson', (env.bucket.objects.get('recalls/test.ndjson') as string).replace('Infusion', 'Infusian'));
    expect((await worker.fetch(get('/v1/recalls/Z-0002-2026?include=raw', key), env)).status).toBe(500);
    expect(parseRawRef('a/b.ndjson#10:20')).toEqual({ key: 'a/b.ndjson', offset: 10, length: 20 });
    // Missing evidence is refused too, never served as raw: null.
    env.bucket.objects.delete('recalls/test.ndjson');
    expect((await worker.fetch(get('/v1/recalls/Z-0002-2026?include=raw', key), env)).status).toBe(500);
  });

  it('treats a nationwide recall as reaching every state', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env);
    const body = (await (await worker.fetch(get('/v1/recalls?state=WY', key), env)).json()) as { data: Array<{ recall_number: string }> };
    expect(body.data.map((recall) => recall.recall_number)).toEqual(['Z-0002-2026']);
  });

  it('looks up one code across identifier kinds', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env);
    for (const code of ['05708932072526', '5708932072526', '8904168']) {
      const body = (await (await worker.fetch(get(`/v1/recalls/lookup?code=${code}`, key), env)).json()) as { data: Array<{ recall: { recall_number: string } }> };
      expect(body.data.map((match) => match.recall.recall_number)).toEqual(['Z-0002-2026']);
    }
    expect(lookupCandidates('12345-678-90')).toContainEqual(['ndc', '12345-0678-90']);
    expect(lookupCandidates('130 ef')).toContainEqual(['lot', '130EF']);
    // A printed UPC-E is also read as its expanded UPC-A, the form the index stores.
    expect(lookupCandidates('04252614')).toContainEqual(['gtin', '00042100005264']);
    expect(gtinCandidates('04252614')).toEqual(['00042100005264']);
    expect(gtinCandidates('96385074')).toEqual(['00000096385074']);
  });

  it('matches NDCs across package and product forms', async () => {
    const env = makeEnv();
    const now = '2026-09-26T00:00:00.000Z';
    const productOnly = await prepareRecall('drug', { recall_number: 'D-0001-2026', report_date: '20260901', openfda: { product_ndc: ['12345-6789'] } });
    const packageOnly = await prepareRecall('drug', { recall_number: 'D-0002-2026', report_date: '20260902', code_info: 'NDC 12345-6789-01' });
    for (const group of writeRecallGroups([{ prepared: productOnly, rawRef: 'k#0:1' }, { prepared: packageOnly, rawRef: 'k#0:1' }], now)) {
      await env.DB.batch(group.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
    }
    const key = await seedCustomer(env);
    const ids = async (path: string) => ((await (await worker.fetch(get(path, key), env)).json()) as { data: Array<{ recall_number?: string; recall?: { recall_number: string } }> }).data.map((item) => item.recall_number ?? item.recall?.recall_number).sort();
    // A package code finds its own package and the whole-product recall.
    expect(await ids('/v1/recalls?ndc=12345-6789-01')).toEqual(['D-0001-2026', 'D-0002-2026']);
    // A different package of the same product finds only the whole-product recall.
    expect(await ids('/v1/recalls?ndc=12345-6789-02')).toEqual(['D-0001-2026']);
    // A product code finds the product and every listed package of it.
    expect(await ids('/v1/recalls?ndc=12345-6789')).toEqual(['D-0001-2026', 'D-0002-2026']);
    expect(await ids('/v1/recalls/lookup?code=12345-6789')).toEqual(['D-0001-2026', 'D-0002-2026']);
  });

  it('states the total and truncation for large lookups', async () => {
    const env = makeEnv();
    const now = '2026-09-26T00:00:00.000Z';
    const writes = await Promise.all(Array.from({ length: 105 }, async (_, index) => ({ prepared: await prepareRecall('food', { ...FOOD, recall_number: `F-${String(index).padStart(4, '0')}-2026` }), rawRef: 'k#0:1' })));
    for (const group of writeRecallGroups(writes, now)) await env.DB.batch(group.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
    const key = await seedCustomer(env);
    const body = (await (await worker.fetch(get('/v1/recalls/lookup?code=AC2601', key), env)).json()) as { data: unknown[]; total_matches: number; truncated: boolean; complete_results: string[] };
    expect(body.data).toHaveLength(100);
    expect(body.total_matches).toBe(105);
    expect(body.truncated).toBe(true);
    expect(body.complete_results).toContain('/v1/recalls?lot=AC2601');
  });

  it('pages with a stable cursor and supports full-text search', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env);
    const first = (await (await worker.fetch(get('/v1/recalls?limit=1', key), env)).json()) as { data: Array<{ recall_number: string }>; next_cursor: string };
    expect(first.data[0]?.recall_number).toBe('F-0001-2026');
    const second = (await (await worker.fetch(get(`/v1/recalls?limit=1&cursor=${first.next_cursor}`, key), env)).json()) as { data: Array<{ recall_number: string }>; next_cursor: string | null };
    expect(second.data[0]?.recall_number).toBe('Z-0002-2026');
    expect(second.next_cursor).toBeNull();
    const fts = (await (await worker.fetch(get('/v1/recalls?q=occlusion', key), env)).json()) as { data: Array<{ recall_number: string }> };
    expect(fts.data.map((recall) => recall.recall_number)).toEqual(['Z-0002-2026']);
  });

  it('returns 429 once the allowance is spent and 400 for bad parameters', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env);
    await env.DB.prepare("INSERT INTO usage_month (customer_id, month, requests) VALUES ('c1', ?, 100)").bind(`${new Date().toISOString().slice(0, 7)}-01`).run();
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(429);
    await env.DB.prepare("UPDATE usage_month SET requests = 0").run();
    expect((await worker.fetch(get('/v1/recalls?gtin=00012345678906', key), env)).status).toBe(400);
    expect((await worker.fetch(get('/v1/recalls?limit=500', key), env)).status).toBe(400);
    // An offset timestamp is compared in UTC: 01:00+05:00 is 2026-09-25T20:00Z, before the seed's changed_at.
    const since = (await (await worker.fetch(get(`/v1/recalls?changed_since=${encodeURIComponent('2026-09-26T01:00:00+05:00')}`, key), env)).json()) as { data: unknown[] };
    expect(since.data).toHaveLength(2);
  });

  it('refuses canceled subscriptions and honours the kill switch', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env, 'developer', 'canceled');
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(403);
    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    expect((await worker.fetch(get('/v1/recalls/stats'), killed)).status).toBe(503);
    const killedKey = await seedCustomer(killed);
    expect((await worker.fetch(get('/v1/recalls', killedKey), killed)).status).toBe(503);
  });

  it('serves public stats and pages on the right hosts', async () => {
    const env = makeEnv();
    await seed(env);
    const stats = (await (await worker.fetch(get('/v1/recalls/stats'), env)).json()) as { categories: Array<{ category: string; recalls: number }> };
    expect(stats.categories).toEqual([
      { category: 'device', recalls: 1, latest_report: '2026-09-10' },
      { category: 'food', recalls: 1, latest_report: '2026-09-15' },
    ]);
    const landing = await worker.fetch(get('/recalls', undefined, 'data.aroqon.com'), env);
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain('$49');
    const redirect = await worker.fetch(get('/v1/recalls', undefined, 'data.aroqon.com'), env);
    expect(redirect.status).toBe(308);
    expect((await worker.fetch(get('/openapi.json'), env)).status).toBe(200);
  });
});

describe('discoverability', () => {
  const site = (path: string) => get(path, undefined, 'data.aroqon.com');
  const jsonLd = (page: string) => [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) => JSON.parse(match[1] as string) as Record<string, unknown>);

  it('serves one public page per recall from the same rows as the API, with JSON-LD', async () => {
    const env = makeEnv();
    await seed(env);
    const response = await worker.fetch(site('/recalls/F-0001-2026'), env);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('<link rel="canonical" href="https://data.aroqon.com/recalls/F-0001-2026">');
    expect(page).not.toContain('noindex');
    expect(page).toContain('AC2601');
    expect(page).toContain('00012345678905');
    expect(page).toContain('LA, OK, TX');
    expect(page).toContain('Class I food recall F-0001-2026');
    const [ld] = jsonLd(page);
    expect(ld).toMatchObject({ '@type': 'WebPage', url: 'https://data.aroqon.com/recalls/F-0001-2026', isPartOf: { '@id': 'https://data.aroqon.com/recalls#dataset' }, about: { '@type': 'Product', gtin: '00012345678905' } });
    // A cached second read does not depend on D1.
    expect((await worker.fetch(site('/recalls/F-0001-2026'), { ...env, DB: undefined as never })).status).toBe(200);
    expect((await worker.fetch(site('/recalls/F-9999-2026'), env)).status).toBe(404);
  });

  it('keeps thin records out of the index but reachable (rule 8)', async () => {
    const env = makeEnv();
    await seed(env);
    const page = await (await worker.fetch(site('/recalls/Z-0002-2026'), env)).text();
    expect(page).toContain('<meta name="robots" content="noindex, follow">');
    const index = await (await worker.fetch(site('/sitemap.xml'), env)).text();
    expect(index).toContain('<loc>https://data.aroqon.com/sitemaps/pages.xml</loc>');
    expect(index).toContain('<loc>https://data.aroqon.com/sitemaps/recalls-1.xml</loc>');
    const urls = await (await worker.fetch(site('/sitemaps/recalls-1.xml'), env)).text();
    expect(urls).toContain('<loc>https://data.aroqon.com/recalls/F-0001-2026</loc><lastmod>2026-09-26</lastmod>');
    expect(urls).not.toContain('Z-0002-2026');
    expect((await worker.fetch(site('/sitemaps/recalls-2.xml'), env)).status).toBe(404);
  });

  it('links every recall from crawlable year hubs', async () => {
    const env = makeEnv();
    await seed(env);
    const hub = await (await worker.fetch(site('/recalls/browse'), env)).text();
    expect(hub).toContain('href="/recalls/browse/food/2026"');
    const year = await (await worker.fetch(site('/recalls/browse/device/2026'), env)).text();
    expect(year).toContain('href="/recalls/Z-0002-2026"');
    expect(year).toContain('noindex, follow');
    expect((await worker.fetch(site('/recalls/browse/device/2019'), env)).status).toBe(404);
    expect((await worker.fetch(site('/recalls/browse/device/2026?page=0'), env)).status).toBe(404);
  });

  it('publishes llms.txt, robots.txt and Dataset JSON-LD for crawlers and agents', async () => {
    const env = makeEnv();
    const llms = await worker.fetch(site('/llms.txt'), env);
    expect(llms.headers.get('content-type')).toContain('text/markdown');
    const summary = await llms.text();
    expect(summary.startsWith('# Data Foundry\n\n> ')).toBe(true);
    expect(summary).toContain('https://api.data.aroqon.com/v1/recalls/lookup?code=');
    expect(await (await worker.fetch(site('/llms-full.txt'), env)).text()).toContain('### GET /v1/recalls/lookup');
    const robots = await (await worker.fetch(site('/robots.txt'), env)).text();
    expect(robots).toContain('Sitemap: https://data.aroqon.com/sitemap.xml');
    expect(robots).toContain('Disallow: /recalls/checkout');
    const landing = await (await worker.fetch(site('/recalls'), env)).text();
    expect(jsonLd(landing)[0]).toMatchObject({ '@type': 'Dataset', name: 'FDA Recall Intelligence' });
    expect(jsonLd(await (await worker.fetch(site('/'), env)).text())[0]).toMatchObject({ '@type': 'DataCatalog' });
  });

  it('escapes page text and JSON-LD against injection', async () => {
    const env = makeEnv();
    const prepared = await prepareRecall('food', { ...FOOD, recall_number: 'F-0003-2026', product_description: 'Bars </script><script>alert(1)</script> with a long enough name' });
    const bundle = ndjsonBundle([prepared.raw]);
    await env.RAW_ARTIFACTS.put('recalls/x.ndjson', bundle.body);
    const range = bundle.ranges[0] as { offset: number; length: number };
    await env.DB.batch(writeRecallStatements(prepared, rawRef('recalls/x.ndjson', range.offset, range.length), 'now').map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
    const page = await (await worker.fetch(site('/recalls/F-0003-2026'), env)).text();
    expect(page).not.toContain('<script>alert(1)');
    expect(page).toContain('\\u003c/script>');
  });

  it('withdraws pages, hubs and sitemaps under the kill switch, even when cached', async () => {
    const live = makeEnv();
    await seed(live);
    for (const path of ['/recalls/F-0001-2026', '/sitemap.xml', '/sitemaps/recalls-1.xml', '/recalls/browse', '/recalls/browse/food/2026']) {
      expect((await worker.fetch(site(path), live)).status, path).toBe(200);
      expect((await worker.fetch(site(path), { ...live, SOURCE_KILL_SWITCH: '1' })).status, path).toBe(503);
    }
  });

  it('keys the cache on the canonical URL, so nonce parameters cannot force D1 reads', async () => {
    const env = makeEnv();
    await seed(env);
    const offline = { ...env, DB: undefined as never };
    for (const path of ['/recalls/F-0001-2026', '/sitemap.xml', '/sitemaps/recalls-1.xml', '/recalls/browse', '/recalls/browse/food/2026']) {
      expect((await worker.fetch(site(path), env)).status, path).toBe(200);
      expect((await worker.fetch(site(`${path}?nonce=${Math.random()}`), offline)).status, `${path} with a nonce`).toBe(200);
    }
    // Only the Worker's own cache holds copies: clients must come back through the kill switch.
    expect((await worker.fetch(site('/recalls/F-0001-2026'), offline)).headers.get('cache-control')).toBe('no-cache');
    expect((await worker.fetch(site('/sitemaps/recalls-1.xml'), env)).headers.get('cache-control')).toBe('no-cache');
    // Shards past the end are refused from the cached count, so no unique shard number can force a D1 query.
    for (const shard of [2, 7, 500, 999]) expect((await worker.fetch(site(`/sitemaps/recalls-${shard}.xml`), offline)).status, `shard ${shard}`).toBe(404);
    expect((await worker.fetch(site('/sitemaps/recalls-0.xml'), offline)).status).toBe(404);
    // Browse pages past the end and unknown recalls are cached misses too.
    expect((await worker.fetch(site('/recalls/browse/food/2026?page=9999'), env)).status).toBe(404);
    expect((await worker.fetch(site('/recalls/browse/food/2026?page=9999'), offline)).status).toBe(404);
    expect((await worker.fetch(site('/recalls/F-9999-2026'), env)).status).toBe(404);
    expect((await worker.fetch(site('/recalls/F-9999-2026'), offline)).status).toBe(404);
    // The one parameter that changes a response still separates cache entries.
    // Page 2 is past the year's cached count, so it is refused without D1.
    expect((await worker.fetch(site('/recalls/browse/food/2026?page=2'), offline)).status).toBe(404);
  });

  it('routes every published recall number, including irregular legacy ones, on pages, the API and sitemaps', async () => {
    const env = makeEnv();
    for (const recall_number of ['F-1855.2013', 'D-66241-001']) {
      const prepared = await prepareRecall('food', { ...FOOD, recall_number });
      const bundle = ndjsonBundle([prepared.raw]);
      await env.RAW_ARTIFACTS.put(`recalls/${recall_number}.ndjson`, bundle.body);
      const range = bundle.ranges[0] as { offset: number; length: number };
      await env.DB.batch(writeRecallStatements(prepared, rawRef(`recalls/${recall_number}.ndjson`, range.offset, range.length), 'now').map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
      expect((await worker.fetch(site(`/recalls/${recall_number}`), env)).status, recall_number).toBe(200);
    }
    const urls = await (await worker.fetch(site('/sitemaps/recalls-1.xml'), env)).text();
    expect(urls).toContain('/recalls/F-1855.2013</loc>');
    expect(urls).toContain('/recalls/D-66241-001</loc>');
    const key = await seedCustomer(env);
    expect((await worker.fetch(get('/v1/recalls/F-1855.2013', key), env)).status).toBe(200);
    expect((await worker.fetch(site('/recalls/docs'), env)).status).toBe(301);
    expect((await worker.fetch(site('/docs'), env)).status).toBe(200);
  });

  it('serves the IndexNow key and pings changed, indexable pages, retrying until a batch is accepted', async () => {
    const env = makeEnv({ INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    await seed(env);
    expect(await (await worker.fetch(site('/a1b2c3d4e5f60718293a4b5c6d7e8f90.txt'), env)).text()).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    const sent: string[] = [];
    let reply = 429;
    const fetcher = (async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      return new Response(null, { status: reply });
    }) as unknown as typeof fetch;
    const ctx = { publicOrigin: 'https://data.aroqon.com', apiOrigin: 'https://api.data.aroqon.com', supportEmail: 's@example.com' };
    const key = env.INDEXNOW_KEY;
    // The seeded recall changed at 2026-09-26T00:00Z. First run, no watermark yet: it records its own
    // boundary (one edge-cache lifetime before it started) and has nothing settled to send.
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, key, '2026-09-26T00:30:00.000Z', fetcher)).toEqual({ since: '2026-09-25T23:25:00.000Z', submitted: 0, status: [], advanced: true });
    // 40 minutes after the change the old page may still be cached somewhere, so it is not announced yet.
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, key, '2026-09-26T00:40:00.000Z', fetcher)).toMatchObject({ submitted: 0 });
    // Once settled it is sent; a 429 keeps the watermark, so the next run retries…
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, key, '2026-09-26T01:10:00.000Z', fetcher)).toEqual({ since: '2026-09-25T23:35:00.000Z', submitted: 1, status: [429], advanced: false });
    expect(JSON.parse(sent[0] as string)).toEqual({ host: 'data.aroqon.com', key, keyLocation: `https://data.aroqon.com/${key}.txt`, urlList: ['https://data.aroqon.com/recalls/F-0001-2026'] });
    reply = 202;
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, key, '2026-09-26T07:00:00.000Z', fetcher)).toMatchObject({ since: '2026-09-25T23:35:00.000Z', submitted: 1, status: [202], advanced: true });
    // …and then moves on.
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, key, '2026-09-26T13:00:00.000Z', fetcher)).toMatchObject({ since: '2026-09-26T05:55:00.000Z', submitted: 0, advanced: true });
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, undefined, '2026-09-29T00:00:00.000Z', fetcher)).toMatchObject({ submitted: 0, advanced: false });
    expect(indexNowBodies(ctx, 'k', Array.from({ length: 10_001 }, (_, index) => `F-${index}-2026`))).toHaveLength(2);
  });

  it('replaces a malformed or future IndexNow watermark before submitting, so a failed run is still retried', async () => {
    const env = makeEnv({ INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    await seed(env);
    const ctx = { publicOrigin: 'https://data.aroqon.com', apiOrigin: 'https://api.data.aroqon.com', supportEmail: 's@example.com' };
    const failing = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    for (const bad of ['not-a-date', '2099-01-01T00:00:00.000Z']) {
      await env.RAW_ARTIFACTS.put('state/indexnow-watermark.json', JSON.stringify({ since: bad }));
      const result = await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, '2026-09-25T00:00:00.000Z', failing);
      expect(result, bad).toMatchObject({ since: '2026-09-24T22:55:00.000Z', advanced: true });
      expect(await (await env.RAW_ARTIFACTS.get('state/indexnow-watermark.json'))?.text(), bad).toBe(JSON.stringify({ since: '2026-09-24T22:55:00.000Z' }));
    }
    // The replaced boundary is what later runs retry from: the change at 00:00 is sent, and resent while it fails.
    await env.RAW_ARTIFACTS.put('state/indexnow-watermark.json', JSON.stringify({ since: 'garbage' }));
    await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, '2026-09-26T00:30:00.000Z', failing);
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, '2026-09-26T01:10:00.000Z', failing)).toMatchObject({ since: '2026-09-25T23:25:00.000Z', submitted: 1, advanced: false });
    expect(await pingChangedRecalls(ctx, env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, '2026-09-26T07:00:00.000Z', failing)).toMatchObject({ since: '2026-09-25T23:25:00.000Z', submitted: 1, advanced: false });
  });

  it('does not ping IndexNow or move its watermark while the kill switch is on', async () => {
    const env = makeEnv({ INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', SOURCE_KILL_SWITCH: '1' });
    await seed(env);
    await env.RAW_ARTIFACTS.put('state/indexnow-watermark.json', JSON.stringify({ since: '2026-09-25T00:00:00.000Z' }));
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await worker.scheduled({}, env);
    // The product-recall sources have their own kill switch; only the FDA dataset is withdrawn here.
    expect(fetcher.mock.calls.filter((call) => String((call as unknown[])[0]).includes('indexnow'))).toEqual([]);
    expect(fetcher.mock.calls.filter((call) => String((call as unknown[])[0]).includes('api.fda.gov'))).toEqual([]);
    expect(await (await env.RAW_ARTIFACTS.get('state/indexnow-watermark.json'))?.text()).toBe(JSON.stringify({ since: '2026-09-25T00:00:00.000Z' }));
  });

  it('bounds browse pagination by the data, so unique page numbers cannot each query D1', async () => {
    const env = makeEnv();
    await seed(env);
    expect((await worker.fetch(site('/recalls/browse/food/2026'), env)).status).toBe(200);
    const offline = { ...env, DB: undefined as never };
    // The year's count is cached, so any page past it is refused without touching D1.
    for (const page of [2, 5000, 5001, 9999]) expect((await worker.fetch(site(`/recalls/browse/food/2026?page=${page}`), offline)).status, `page ${page}`).toBe(404);
    for (const year of ['2011', '9999']) expect((await worker.fetch(site(`/recalls/browse/food/${year}`), offline)).status, year).toBe(404);
  });

  it('derives short product names for titles', () => {
    expect(productName('Acme Peanut Crunch Bars, 2 oz, UPC 0 12345 67890 5')).toBe('Acme Peanut Crunch Bars');
    expect(productName(null)).toBe('Product');
    expect(productName('A'.repeat(20) + ' ' + 'word '.repeat(30)).length).toBeLessThanOrEqual(71);
  });
});

describe('sync', () => {
  it('inserts, then touches unchanged records, then rewrites changed ones, keeping raw pages in R2', async () => {
    const env = makeEnv();
    let records: Array<Record<string, unknown>> = [FOOD];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: records }), { status: 200 })));

    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30', '2026-09-26T00:00:00.000Z')).toMatchObject({ fetched: 1, inserted: 1, changed: 0 });
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30', '2026-09-26T06:00:00.000Z')).toMatchObject({ fetched: 1, inserted: 0, changed: 0 });
    records = [{ ...FOOD, status: 'Terminated', termination_date: '20260925' }];
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30', '2026-09-26T12:00:00.000Z')).toMatchObject({ fetched: 1, inserted: 0, changed: 1 });

    const row = await env.DB.prepare('SELECT status, terminated_on, first_seen_at, changed_at FROM recall').first<Record<string, string>>();
    expect(row).toEqual({ status: 'Terminated', terminated_on: '2026-09-25', first_seen_at: '2026-09-26T00:00:00.000Z', changed_at: '2026-09-26T12:00:00.000Z' });
    const keys = await env.DB.prepare("SELECT COUNT(*) AS n FROM recall_key WHERE kind = 'lot'").first<{ n: number }>();
    expect(keys?.n).toBe(2);
    // Only new and changed records are bundled: the unchanged run writes nothing.
    expect(env.bucket.objects.size).toBe(2);
    const runs = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_run WHERE status = 'SUCCEEDED'").first<{ n: number }>();
    expect(runs?.n).toBe(3);
  });

  it('writes a 1,000-record page in a handful of D1 statements', async () => {
    const env = makeEnv();
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...FOOD, recall_number: `F-${String(index).padStart(4, '0')}-2026` }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ results: String(url).includes('skip=0') ? records : [] }), { status: 200 })));
    let statements = 0;
    const batch = env.DB.batch.bind(env.DB);
    (env.DB as { batch: typeof env.DB.batch }).batch = async (list) => {
      statements += list.length;
      return batch(list);
    };
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ fetched: 1000, inserted: 1000 });
    expect(statements).toBeLessThan(20);
    const keys = await env.DB.prepare('SELECT COUNT(*) AS n FROM recall_key').first<{ n: number }>();
    expect(keys?.n).toBe(1000 * 10); // per record: 2 lots, 2 expiries, 1 gtin, 3 states, 1 reason class, 1 allergen
    const fts = await env.DB.prepare("SELECT COUNT(*) AS n FROM recall_fts WHERE recall_fts MATCH 'peanuts'").first<{ n: number }>();
    expect(fts?.n).toBe(1000);
  });

  it('rolls back a recall whose group fails, so the next run rewrites it', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [FOOD] }), { status: 200 })));
    const batch = env.DB.batch.bind(env.DB);
    let fail = true;
    (env.DB as { batch: typeof env.DB.batch }).batch = async (list) => {
      if (fail && list.length > 1) {
        fail = false;
        // Run the group's statements up to the keys, then fail: a transaction must undo all of it.
        return batch([...list.slice(0, 4), env.DB.prepare('SELECT no_such_column FROM recall')]);
      }
      return batch(list);
    };
    await expect(syncWindow(env, 'food', '2026-09-01', '2026-09-30')).rejects.toThrow();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM recall').first<{ n: number }>()).toEqual({ n: 0 });
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recall_key WHERE kind = 'lot'").first<{ n: number }>()).toEqual({ n: 2 });
  });

  it('produces identical rows, keys and search entries from the bulk and Worker writers', async () => {
    const now = '2026-09-26T00:00:00.000Z';
    const writes = [
      { prepared: await prepareRecall('food', FOOD), rawRef: 'k#0:1' },
      { prepared: await prepareRecall('device', DEVICE), rawRef: 'k#2:3' },
    ];
    const bulk = createTestDatabase();
    for (const write of writes) bulk.sqlite.exec(writeRecallStatements(write.prepared, write.rawRef, now).map(renderLiteral).join('\n'));
    const worker = createTestDatabase();
    for (const group of writeRecallGroups(writes, now)) await worker.db.batch(group.map((statement) => worker.db.prepare(statement.sql).bind(...statement.params)));
    // Rewriting the same records must not duplicate search entries.
    for (const group of writeRecallGroups(writes, now)) await worker.db.batch(group.map((statement) => worker.db.prepare(statement.sql).bind(...statement.params)));
    for (const sql of [
      'SELECT * FROM recall ORDER BY recall_number',
      'SELECT * FROM recall_key ORDER BY kind, value, recall_number',
      'SELECT rowid, recall_number, firm_name, product_description, reason_for_recall FROM recall_fts ORDER BY rowid',
    ]) {
      expect(worker.sqlite.prepare(sql).all()).toEqual(bulk.sqlite.prepare(sql).all());
    }
  });

  it('keeps syncing other windows when one fails', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/food/') ? new Response('boom', { status: 400 }) : new Response(JSON.stringify({ results: [] }), { status: 200 }))));
    const results = await scheduledSync(env, '2026-09-26');
    expect(results).toHaveLength(6);
    expect(results.filter((result) => 'error' in result).map((result) => result.category)).toEqual(['food', 'food']);
    // The failed food history window is held for retry; drug and device advance.
    expect(await env.DB.prepare("SELECT category FROM sync_cursor ORDER BY category").all<{ category: string }>()).toEqual({ results: [{ category: 'device' }, { category: 'drug' }] });
    expect(await scheduledSync(makeEnv({ SOURCE_KILL_SWITCH: '1' }), '2026-09-26')).toEqual([]);
  });

  it('re-derives a record when the parser version changes, even if its bytes did not', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [FOOD] }), { status: 200 })));
    await syncWindow(env, 'food', '2026-09-01', '2026-09-30');
    await env.DB.prepare("UPDATE recall SET parser_version = 'recall-structuring@0'").run();
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 0, changed: 1 });
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 0, changed: 0 });
  });

  it('skips placeholder recall numbers from publication but keeps them as evidence', async () => {
    const env = makeEnv();
    const placeholder = { ...DEVICE, recall_number: 'N/A' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [FOOD, placeholder] }), { status: 200 })));
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ fetched: 2, inserted: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recall WHERE recall_number = 'N/A'").first<{ n: number }>()).toEqual({ n: 0 });
    const bundle = [...env.bucket.objects.values()][0] as string;
    expect(bundle.trim().split('\n').map((line) => JSON.parse(line).recall_number)).toEqual(['F-0001-2026', 'N/A']);
  });

  it('keeps the first of duplicate recall numbers on a page, stably across runs', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [FOOD, { ...FOOD, status: 'Terminated' }] }), { status: 200 })));
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 1, changed: 0 });
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 0, changed: 0 });
    expect(await env.DB.prepare('SELECT status FROM recall').first<{ status: string }>()).toEqual({ status: 'Ongoing' });
    // The later duplicate is not published but is archived as evidence.
    const first = [...env.bucket.objects.values()][0] as string;
    expect(first.trim().split('\n').map((line) => JSON.parse(line).status)).toEqual(['Ongoing', 'Terminated']);
  });

  it('keeps the first occurrence of a recall number across pages of one window', async () => {
    const env = makeEnv();
    const filler = Array.from({ length: 999 }, (_, index) => ({ ...FOOD, recall_number: `F-${String(index + 1).padStart(4, '0')}-2025` }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const page = String(url).includes('skip=0') ? [...filler, FOOD] : String(url).includes('skip=1000') ? [{ ...FOOD, status: 'Terminated' }] : [];
      return new Response(JSON.stringify({ results: page }), { status: 200 });
    }));
    await syncWindow(env, 'food', '2026-09-01', '2026-09-30');
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ inserted: 0, changed: 0 });
    expect(await env.DB.prepare("SELECT status FROM recall WHERE recall_number = 'F-0001-2026'").first()).toEqual({ status: 'Ongoing' });
  });

  it('retries a failed history window before moving on, then skips it after repeated failures', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/food/') && String(url).includes('20120601') ? new Response('boom', { status: 400 }) : new Response(JSON.stringify({ results: [] }), { status: 200 }))));
    const cursor = async () => (await env.DB.prepare("SELECT next_from FROM sync_cursor WHERE category = 'food'").first<{ next_from: string }>())?.next_from ?? null;
    await scheduledSync(env, '2026-09-26');
    expect(await cursor()).toBeNull();
    await scheduledSync(env, '2026-09-26');
    expect(await cursor()).toBeNull();
    await scheduledSync(env, '2026-09-26');
    expect(await cursor()).toBe('2012-09-29');

    // The next full-history sweep returns to the same window: failures from
    // the previous sweep must not count, so one new failure is retried.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await env.DB.prepare("UPDATE sync_cursor SET next_from = '2012-06-01', updated_at = ? WHERE category = 'food'").bind(new Date().toISOString()).run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await scheduledSync(env, '2026-09-26');
    expect(await cursor()).toBe('2012-06-01');
  });

  it('records a failed run', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await expect(syncWindow(env, 'drug', '2026-09-01', '2026-09-30')).rejects.toThrow(/403/);
    const run = await env.DB.prepare('SELECT status, error FROM sync_run').first<{ status: string; error: string }>();
    expect(run).toEqual({ status: 'FAILED', error: 'openFDA drug 403' });
  });
});

describe('bulk load rendering', () => {
  it('renders literal SQL identical in effect to bound statements', async () => {
    const statements = writeRecallStatements(await prepareRecall('food', { ...FOOD, product_description: "O'Brien's Bars" }), 'k#0:1', 'now');
    const { sqlite, db } = createTestDatabase();
    sqlite.exec(statements.map(renderLiteral).join('\n'));
    const row = await db.prepare('SELECT product_description FROM recall').first<{ product_description: string }>();
    expect(row?.product_description).toBe("O'Brien's Bars");
  });
});

describe('Stripe', () => {
  async function sign(payload: string, secret: string, timestamp: number): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
    return `t=${timestamp},v1=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  it('verifies signatures and rejects tampering and replay', async () => {
    const now = 1_800_000_000;
    const header = await sign('{"a":1}', 'whsec_x', now);
    expect(await verifyStripeSignature('{"a":1}', header, 'whsec_x', now)).toBe(true);
    expect(await verifyStripeSignature('{"a":2}', header, 'whsec_x', now)).toBe(false);
    expect(await verifyStripeSignature('{"a":1}', header, 'whsec_y', now)).toBe(false);
    expect(await verifyStripeSignature('{"a":1}', header, 'whsec_x', now + 301)).toBe(false);
  });

  it('form-encodes nested parameters the way Stripe expects', () => {
    expect(formEncode({ line_items: [{ price: 'p', quantity: 1 }], metadata: { plan: 'growth' }, skip: undefined })).toEqual([
      'line_items%5B0%5D%5Bprice%5D=p',
      'line_items%5B0%5D%5Bquantity%5D=1',
      'metadata%5Bplan%5D=growth',
    ]);
  });

  it('keeps checkout closed until sales are opened', async () => {
    const env = makeEnv({ SALES_OPEN: '0' });
    const form = new FormData();
    form.set('plan', 'developer');
    const response = await worker.fetch(new Request('https://data.aroqon.com/recalls/checkout', { method: 'POST', body: form }), env);
    expect(response.status).toBe(503);
  });

  it('issues a key exactly once per completed checkout', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      id: 'cs_test_abc',
      url: null,
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_9',
      customer_details: { email: 'buyer@example.com' },
      metadata: { plan: 'developer' },
      subscription: { id: 'sub_9', status: 'active', items: { data: [{ price: { id: 'price_dev' } }] } },
    })));
    const first = await worker.fetch(new Request('https://data.aroqon.com/recalls/welcome?session_id=cs_test_abc'), env);
    expect(first.status).toBe(200);
    const key = /rcl_live_[A-Za-z0-9]{32}/.exec(await first.text())?.[0];
    expect(key).toBeDefined();
    const customer = await findCustomerByKey(env.DB, key as string);
    expect(customer).toMatchObject({ plan: 'developer', status: 'active', stripeCustomerId: 'cus_9', email: 'buyer@example.com' });
    const second = await worker.fetch(new Request('https://data.aroqon.com/recalls/welcome?session_id=cs_test_abc'), env);
    expect(second.status).toBe(409);
    expect(await second.text()).not.toMatch(/rcl_live_[A-Za-z0-9]{32}/);
  });

  it('never issues two free keys for one email, even concurrently', async () => {
    const env = makeEnv();
    for (const id of ['c1', 'c2']) {
      await env.DB.prepare("INSERT INTO customer (id, email, plan, status, created_at, updated_at) VALUES (?, ?, 'evaluate', 'active', 'now', 'now')").bind(id, id === 'c1' ? 'Same@Example.com ' : 'same@example.com').run();
    }
    const { issueFreeKey } = await import('../src/account.js');
    const results = await Promise.all([issueFreeKey(env.DB, 'c1', 'Same@Example.com ', 'cs_1'), issueFreeKey(env.DB, 'c2', 'same@example.com', 'cs_2')]);
    expect(results.filter((key) => key !== null)).toHaveLength(1);
  });

  it('issues one free Evaluate key per email', async () => {
    const env = makeEnv();
    let sequence = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      sequence += 1;
      return Response.json({
        id: `cs_test_free${sequence}`,
        url: null,
        status: 'complete',
        payment_status: 'no_payment_required',
        customer: `cus_free${sequence}`,
        customer_details: { email: sequence === 1 ? 'Dev@Example.com' : 'dev@example.com' },
        metadata: { plan: 'evaluate' },
        subscription: { id: `sub_free${sequence}`, status: 'active', items: { data: [{ price: { id: 'price_eval' } }] } },
      });
    }));
    expect((await worker.fetch(new Request('https://data.aroqon.com/recalls/welcome?session_id=cs_test_free1'), env)).status).toBe(200);
    const second = await worker.fetch(new Request('https://data.aroqon.com/recalls/welcome?session_id=cs_test_free2'), env);
    expect(second.status).toBe(409);
    expect(await second.text()).not.toMatch(/rcl_live_[A-Za-z0-9]{32}/);
  });

  it('rotates atomically: a failed insert leaves the old key working', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env, 'developer');
    const batch = env.DB.batch.bind(env.DB);
    (env.DB as { batch: typeof env.DB.batch }).batch = async (list) => batch([...list.slice(0, 1), env.DB.prepare('SELECT no_such_column FROM api_key')]);
    expect((await worker.fetch(new Request('https://api.data.aroqon.com/v1/account/rotate-key', { method: 'POST', headers: { authorization: `Bearer ${key}` } }), env)).status).toBe(500);
    (env.DB as { batch: typeof env.DB.batch }).batch = batch;
    expect((await worker.fetch(get('/v1/account', key), env)).status).toBe(200);
  });

  it('reissues a lost key for an operator only, revoking the old one', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'a'.repeat(40) });
    const oldKey = await seedCustomer(env, 'developer');
    const reissue = (token: string) => worker.fetch(new Request('https://data.aroqon.com/admin/reissue-key?stripe_customer_id=cus_1', { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env);
    expect((await reissue('b'.repeat(40))).status).toBe(404);
    const response = await reissue('a'.repeat(40));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { api_key: string; email: string };
    expect(body.email).toBe('a@example.com');
    expect((await worker.fetch(get('/v1/recalls', oldKey), env)).status).toBe(401);
    expect((await worker.fetch(get('/v1/recalls', body.api_key), env)).status).toBe(200);
  });

  it('revokes every key of one customer for an operator only, leaving the customer and usage intact', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'a'.repeat(40) });
    const key = await seedCustomer(env, 'developer');
    await seed(env);
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(200);
    const revoke = (token: string, id = 'cus_1') => worker.fetch(new Request(`https://data.aroqon.com/admin/revoke-keys?stripe_customer_id=${id}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env);
    expect((await revoke('b'.repeat(40))).status).toBe(404);
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(200);
    expect((await revoke('a'.repeat(40), 'cus_unknown')).status).toBe(404);
    const response = await revoke('a'.repeat(40));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { active_keys: number }).active_keys).toBe(0);
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(401);
    expect(await env.DB.prepare('SELECT status FROM customer').first()).toEqual({ status: 'active' });
    expect(await env.DB.prepare('SELECT requests FROM usage_month').first()).toEqual({ requests: 2 });
    // A reissue after revocation works again: acceptance runs are repeatable.
    const reissued = (await (await worker.fetch(new Request('https://data.aroqon.com/admin/reissue-key?stripe_customer_id=cus_1', { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(40)}` } }), env)).json()) as { api_key: string };
    expect((await worker.fetch(get('/v1/recalls', reissued.api_key), env)).status).toBe(200);
  });

  it('opens and closes only internal acceptance fixtures, closing atomically to a suspended state', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'a'.repeat(40) });
    const realKey = await seedCustomer(env, 'developer');
    await seed(env);
    await env.DB.prepare("INSERT INTO customer (id, email, stripe_customer_id, plan, status, created_at, updated_at) VALUES ('acc', 'acceptance-internal@aroqon.invalid', 'cus_acceptance_internal_20260928', 'developer', 'suspended', 'now', 'now')").run();
    const fixture = (id: string, state: string, token = 'a'.repeat(40)) => worker.fetch(new Request(`https://data.aroqon.com/admin/acceptance-fixture?stripe_customer_id=${id}&state=${state}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env);
    expect((await fixture('cus_acceptance_internal_20260928', 'open', 'b'.repeat(40))).status).toBe(404);
    // A real customer is never touched: its id does not qualify.
    expect((await fixture('cus_1', 'closed')).status).toBe(400);
    expect((await worker.fetch(get('/v1/recalls', realKey), env)).status).toBe(200);
    expect(await (await fixture('cus_acceptance_internal_20260928', 'open')).json()).toMatchObject({ status: 'active', active_keys: 0 });
    const key = await issueKey(env.DB, 'acc', null);
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(200);
    // Opening never revives a fixture that still holds an active key.
    await env.DB.prepare("UPDATE customer SET status = 'suspended' WHERE id = 'acc'").run();
    expect(await (await fixture('cus_acceptance_internal_20260928', 'open')).json()).toMatchObject({ status: 'suspended', active_keys: 1 });
    expect(await (await fixture('cus_acceptance_internal_20260928', 'closed')).json()).toMatchObject({ status: 'suspended', active_keys: 0 });
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(401);
    // An internal-looking id whose customer lacks the internal email is refused.
    await env.DB.prepare("UPDATE customer SET email = 'x@example.com' WHERE id = 'acc'").run();
    expect((await fixture('cus_acceptance_internal_20260928', 'open')).status).toBe(404);
  });

  it('reports the serving version and its source tag to an operator only', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'a'.repeat(40), CF_VERSION_METADATA: { id: 'v-123', tag: 'abcdef012345', timestamp: '2026-09-28T18:00:00Z' } });
    const version = (token: string) => worker.fetch(new Request('https://data.aroqon.com/admin/version', { headers: { authorization: `Bearer ${token}` } }), env);
    expect((await version('b'.repeat(40))).status).toBe(404);
    expect(await (await version('a'.repeat(40))).json()).toEqual({ version_id: 'v-123', tag: 'abcdef012345', timestamp: '2026-09-28T18:00:00Z' });
  });

  it('reports each IndexNow feed\'s watermark and last scheduled run to an operator only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T14:00:00.000Z'));
    try {
      const env = makeEnv({ ADMIN_TOKEN: 'a'.repeat(40), INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', PRODUCT_RECALLS_OPEN: '1' });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
      const status = (token: string) => worker.fetch(new Request('https://data.aroqon.com/admin/indexnow-status', { headers: { authorization: `Bearer ${token}` } }), env);
      expect((await status('b'.repeat(40))).status).toBe(404);
      expect(await (await status('a'.repeat(40))).json()).toEqual({ recalls: { watermark: null, last_run: null }, 'product-recalls': { watermark: null, last_run: null } });
      await worker.scheduled({ scheduledTime: Date.parse('2026-09-27T12:17:00.000Z') }, env);
      const body = (await (await status('a'.repeat(40))).json()) as Record<string, { watermark: { since: string }; last_run: Record<string, unknown> }>;
      for (const name of ['recalls', 'product-recalls']) {
        expect(body[name]?.watermark.since).toBe('2026-09-27T12:55:00.000Z');
        expect(body[name]?.last_run).toMatchObject({ trigger: 'scheduled', scheduled_time: '2026-09-27T12:17:00.000Z', started: '2026-09-27T14:00:00.000Z', advanced: true });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the customer\'s current subscription whatever order webhooks arrive in', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env, 'developer');
    const subs = {
      sub_1: { id: 'sub_1', customer: 'cus_1', status: 'canceled', created: 1, items: { data: [{ price: { id: 'price_dev' } }] } },
      sub_2: { id: 'sub_2', customer: 'cus_1', status: 'active', created: 2, items: { data: [{ price: { id: 'price_growth' } }] } },
    } as const;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/v1/subscriptions') return Response.json({ data: [subs.sub_1, subs.sub_2] });
      return Response.json(subs[path.split('/').pop() as keyof typeof subs]);
    }));
    const deliver = async (id: string, type: string, subscription: string) => {
      const payload = JSON.stringify({ id, type, data: { object: { id: subscription } } });
      const request = new Request('https://data.aroqon.com/stripe/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': await sign(payload, 'whsec_test_secret_value', Math.floor(Date.now() / 1000)) },
      });
      expect((await worker.fetch(request, env)).status).toBe(200);
    };
    // The new subscription's event first, then the old one's late cancellation.
    await deliver('evt_new', 'customer.subscription.created', 'sub_2');
    await deliver('evt_old', 'customer.subscription.deleted', 'sub_1');
    expect(await env.DB.prepare('SELECT plan, status, stripe_subscription_id FROM customer').first()).toEqual({ plan: 'growth', status: 'active', stripe_subscription_id: 'sub_2' });
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(200);
  });

  it('reports an operational key-issue failure as retryable, not as already issued', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      id: 'cs_test_fail', url: null, status: 'complete', payment_status: 'paid', customer: 'cus_f',
      customer_details: { email: 'f@example.com' }, metadata: { plan: 'developer' },
      subscription: { id: 'sub_f', status: 'active', items: { data: [{ price: { id: 'price_dev' } }] } },
    })));
    const prepare = env.DB.prepare.bind(env.DB);
    (env.DB as { prepare: typeof env.DB.prepare }).prepare = (sql) => (sql.startsWith('INSERT INTO api_key') ? prepare('SELECT no_such_column FROM api_key') : prepare(sql));
    const response = await worker.fetch(new Request('https://data.aroqon.com/recalls/welcome?session_id=cs_test_fail'), env);
    expect(response.status).toBe(500);
  });

  it('applies a cancellation webhook from the re-read subscription', async () => {
    const env = makeEnv();
    const key = await seedCustomer(env, 'developer');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [{ price: { id: 'price_dev' } }] } })));
    const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
    const request = new Request('https://data.aroqon.com/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': await sign(payload, 'whsec_test_secret_value', Math.floor(Date.now() / 1000)) },
    });
    expect((await worker.fetch(request, env)).status).toBe(200);
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(403);
    const unsigned = new Request('https://data.aroqon.com/stripe/webhook', { method: 'POST', body: payload });
    expect((await worker.fetch(unsigned, env)).status).toBe(400);
  });
});

describe('RapidAPI channel', () => {
  const SECRET = 'rapidapi-proxy-secret-0123456789';
  const market = (path: string, headers: Record<string, string>) => new Request(`https://api.data.aroqon.com${path}`, { headers });
  const usage = async (env: Env) => (await env.DB.prepare('SELECT coalesce(sum(requests), 0) AS n FROM usage_month').first<{ n: number }>())?.n;

  it('is closed by default: marketplace-shaped requests are refused, even with a valid direct key', async () => {
    const env = makeEnv();
    await seed(env);
    const key = await seedCustomer(env, 'developer');
    for (const env2 of [env, makeEnv({ RAPIDAPI_ENABLED: '1' })]) {
      const response = await worker.fetch(market('/v1/recalls', { authorization: `Bearer ${key}`, 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'someone' }), env2);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('marketplace_disabled');
    }
    expect(await usage(env)).toBe(0);
  });

  it('rejects a missing or wrong proxy secret without falling back to the direct key', async () => {
    const env = makeEnv({ RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: SECRET });
    await seed(env);
    const key = await seedCustomer(env, 'developer');
    for (const headers of [
      { authorization: `Bearer ${key}`, 'x-rapidapi-user': 'spoofer' },
      { authorization: `Bearer ${key}`, 'x-rapidapi-user': 'spoofer', 'x-rapidapi-proxy-secret': 'wrong-secret-value-0000000000' },
      { authorization: `Bearer ${key}`, 'x-rapidapi-host': 'recalls.p.rapidapi.com' },
    ]) {
      const response = await worker.fetch(market('/v1/recalls', headers), env);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_proxy_secret');
    }
    expect(await usage(env)).toBe(0);
    // The direct path is unchanged.
    expect((await worker.fetch(get('/v1/recalls', key), env)).status).toBe(200);
    expect(await usage(env)).toBe(1);
  });

  it('serves a verified subscriber without touching any Stripe customer allowance, ignoring Authorization', async () => {
    const env = makeEnv({ RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: SECRET });
    await seed(env);
    const key = await seedCustomer(env, 'evaluate');
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    const headers = { 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'alice@example.com', 'x-rapidapi-subscription': 'pro', authorization: `Bearer ${key}` };
    const response = await worker.fetch(market('/v1/recalls?limit=1', headers), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-limit')).toBeNull();
    expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(1);
    expect((await worker.fetch(market('/v1/recalls/F-0000-2026', headers), env)).status).toBe(404);
    expect(await usage(env)).toBe(0);
    const lines = logged.filter((line) => line.startsWith('rapidapi_request'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"subscription":"PRO"');
    expect(lines.join('\n')).not.toContain('alice');
    vi.restoreAllMocks();
  });

  it('logs every marketplace response once, stats cache hits and refusals included', async () => {
    const env = makeEnv({ RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: SECRET });
    await seed(env);
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    const headers = { 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'carol' };
    expect((await worker.fetch(market('/v1/recalls/stats', headers), env)).status).toBe(200);
    expect((await worker.fetch(market('/v1/recalls/stats', headers), env)).status).toBe(200); // cache hit
    expect((await worker.fetch(market('/v1/account', headers), env)).status).toBe(403);
    expect((await worker.fetch(market('/v1/recalls?limit=500', headers), env)).status).toBe(400);
    const lines = logged.filter((line) => line.startsWith('rapidapi_request')).map((line) => JSON.parse(line.slice('rapidapi_request '.length)) as { path: string; status: number });
    expect(lines.map((line) => [line.path, line.status])).toEqual([['/v1/recalls/stats', 200], ['/v1/recalls/stats', 200], ['/v1/account', 403], ['/v1/recalls', 400]]);
    // Refusals before any subscriber is verified are logged as unverified, with only a digest of the claimed user.
    logged.length = 0;
    expect((await worker.fetch(market('/v1/recalls', { 'x-rapidapi-user': 'mallory' }), env)).status).toBe(401);
    expect((await worker.fetch(market('/v1/recalls', { 'x-rapidapi-proxy-secret': SECRET }), env)).status).toBe(401);
    expect((await worker.fetch(market('/v1/recalls', headers), makeEnv())).status).toBe(403);
    const refused = logged.filter((line) => line.startsWith('rapidapi_request')).map((line) => JSON.parse(line.slice('rapidapi_request '.length)) as { status: number; verified: boolean; code: string; user: string | null });
    expect(refused.map((line) => [line.status, line.verified, line.code])).toEqual([[401, false, 'invalid_proxy_secret'], [401, false, 'missing_marketplace_user'], [403, false, 'marketplace_disabled']]);
    expect(refused[0]?.user).toMatch(/^[0-9a-f]{16}$/);
    expect(logged.join('\n')).not.toContain('mallory');
    vi.restoreAllMocks();
  });

  it('requires the subscriber identity and keeps account endpoints to direct keys', async () => {
    const env = makeEnv({ RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: SECRET });
    await seed(env);
    expect((await worker.fetch(market('/v1/recalls', { 'x-rapidapi-proxy-secret': SECRET }), env)).status).toBe(401);
    expect((await worker.fetch(market('/v1/recalls', { 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'x'.repeat(129) }), env)).status).toBe(401);
    for (const path of ['/v1/account', '/v1/account/rotate-key']) {
      const response = await worker.fetch(new Request(`https://api.data.aroqon.com${path}`, { method: path.endsWith('key') ? 'POST' : 'GET', headers: { 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'bob' } }), env);
      expect(response.status).toBe(403);
    }
  });

  it('publishes a marketplace contract without account endpoints or the bearer scheme', async () => {
    const env = makeEnv({ PRODUCT_RECALLS_OPEN: '1' });
    const direct = (await (await worker.fetch(get('/openapi.json'), env)).json()) as { paths: Record<string, unknown>; components: Record<string, unknown> };
    const rapid = (await (await worker.fetch(get('/openapi.json?channel=rapidapi'), env)).json()) as { paths: Record<string, unknown>; components: Record<string, unknown>; security: unknown[] };
    expect(Object.keys(direct.paths)).toContain('/v1/account');
    expect(direct.components['securitySchemes']).toBeDefined();
    expect(Object.keys(rapid.paths).some((path) => path.startsWith('/v1/account'))).toBe(false);
    expect(Object.keys(rapid.paths)).toEqual(expect.arrayContaining(['/v1/recalls', '/v1/recalls/lookup', '/v1/product-recalls', '/v1/product-recalls/lookup']));
    expect(rapid.components['securitySchemes']).toBeUndefined();
    expect(rapid.security).toEqual([]);
  });
});
