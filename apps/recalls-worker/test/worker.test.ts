import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeRequest, findCustomerByKey, issueKey, mintApiKey, KEY_PREFIX } from '../src/account.js';
import { lookupCandidates } from '../src/api.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ndjsonBundle, parseRawRef, prepareRecall, rawRef, renderLiteral, writeRecallGroups, writeRecallStatements } from '../src/store.js';
import { formEncode, verifyStripeSignature } from '../src/stripe.js';
import { scheduledSync, syncWindow } from '../src/sync.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

const FOOD = {
  recall_number: 'F-0001-2026',
  event_id: '90001',
  status: 'Ongoing',
  classification: 'Class I',
  product_type: 'Food',
  recalling_firm: 'Acme Snacks LLC',
  city: 'Austin',
  state: 'TX',
  country: 'United States',
  voluntary_mandated: 'Voluntary: Firm initiated',
  distribution_pattern: 'Distributed to retailers in TX, OK and LA.',
  product_description: 'Acme Peanut Crunch Bars, 2 oz, UPC 0 12345 67890 5',
  product_quantity: '1,200 cases',
  reason_for_recall: 'Product contains undeclared peanuts.',
  recall_initiation_date: '20260901',
  report_date: '20260915',
  code_info: 'Lot #: AC2601, Best By 03/01/2027; AC2602, Best By 03/08/2027',
};

const DEVICE = {
  recall_number: 'Z-0002-2026',
  event_id: '90002',
  status: 'Ongoing',
  classification: 'Class II',
  recalling_firm: 'Medi Devices Inc',
  distribution_pattern: 'US Nationwide distribution.',
  product_description: 'Infusion set',
  product_quantity: '3618',
  reason_for_recall: 'Software anomaly may cause an occlusion alarm to fail.',
  report_date: '20260910',
  code_info: 'UDI/DI 05708932072526, Lot Numbers: 8849570, 8904168',
};

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

  it('keeps syncing other windows when one fails, and advances the history cursor', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/food/') ? new Response('boom', { status: 400 }) : new Response(JSON.stringify({ results: [] }), { status: 200 }))));
    const results = await scheduledSync(env, '2026-09-26');
    expect(results).toHaveLength(6);
    expect(results.filter((result) => 'error' in result).map((result) => result.category)).toEqual(['food', 'food']);
    const cursor = await env.DB.prepare("SELECT next_from FROM sync_cursor WHERE category = 'food'").first<{ next_from: string }>();
    expect(cursor?.next_from).toBe('2012-09-29');
    expect(await scheduledSync(makeEnv({ SOURCE_KILL_SWITCH: '1' }), '2026-09-26')).toEqual([]);
  });

  it('skips records whose recall number is a placeholder', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [FOOD, { ...DEVICE, recall_number: 'N/A' }] }), { status: 200 })));
    expect(await syncWindow(env, 'food', '2026-09-01', '2026-09-30')).toMatchObject({ fetched: 2, inserted: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM recall WHERE recall_number = 'N/A'").first<{ n: number }>()).toEqual({ n: 0 });
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
