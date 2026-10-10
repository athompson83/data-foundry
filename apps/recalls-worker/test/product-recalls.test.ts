import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { renderLiteral, sha256Hex } from '../src/store.js';
import { ingestRecords, MIN_FULL_CPSC, MIN_FULL_HC_CONSUMER,
  cpscFullWindows, scheduledProductSync } from '../src/product-sync.js';
import { isIndexableNotice, prepareProductRecall, writeProductGroups, MAX_LITERAL_JSON_BYTES } from '../src/product-store.js';
import { PRODUCT_INDEXNOW_FEED } from '../src/product-pages.js';
import { pingChanged } from '../src/seo.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';
import { CPSC, HC, HC_ONLY, MEDICAL } from './fixtures.js';


function makeEnv(overrides: Partial<Env> = {}): Env & { bucket: ReturnType<typeof createTestBucket> } {
  const { db } = createTestDatabase();
  const bucket = createTestBucket();
  return { DB: db, RAW_ARTIFACTS: bucket, bucket, PUBLIC_ORIGIN: 'https://data.aroqon.com', API_ORIGIN: 'https://api.data.aroqon.com', PRODUCT_RECALLS_OPEN: '1', ...overrides };
}

const NOW = '2026-09-27T12:00:00.000Z';

async function seed(env: Env): Promise<void> {
  // Health Canada first: the CPSC citation must link whichever notice arrives first.
  await ingestRecords(env, 'HC', [HC, HC_ONLY, MEDICAL], 'full', NOW);
  await ingestRecords(env, 'CPSC', [CPSC], 'full', NOW);
}

async function key(env: Env): Promise<string> {
  await env.DB.prepare("INSERT INTO customer (id, email, plan, status, created_at, updated_at) VALUES ('c1', 'a@example.com', 'evaluate', 'active', 'now', 'now')").run();
  return issueKey(env.DB, 'c1', null);
}

const api = (path: string, apiKey?: string): Request => new Request(`https://api.data.aroqon.com${path}`, apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {});
const site = (path: string): Request => new Request(`https://data.aroqon.com${path}`);

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

describe('product-recall ingestion', () => {
  it('stores in-scope notices with evidence and skips other Health Canada organisations', async () => {
    const env = makeEnv();
    await seed(env);
    const rows = await env.DB.prepare('SELECT id, agency, indexable FROM product_recall ORDER BY id').all<{ id: string; agency: string; indexable: number }>();
    expect(rows.results).toEqual([
      { id: 'cpsc-25203', agency: 'CPSC', indexable: 1 },
      { id: 'hc-77184', agency: 'HC', indexable: 0 },
      { id: 'hc-82659', agency: 'HC', indexable: 0 },
    ]);
    const keys = await env.DB.prepare("SELECT kind, value FROM product_recall_key WHERE recall_id = 'cpsc-25203' AND kind IN ('gtin', 'model') ORDER BY kind").all();
    expect(keys.results).toEqual([
      { kind: 'gtin', value: '00089301008588' },
      { kind: 'model', value: 'DXH70CFAVX' },
    ]);
    expect([...env.bucket.objects.keys()].every((objectKey) => objectKey.startsWith('product-recalls/'))).toBe(true);
  });

  it('rewrites only changed records and never flip-flops on unchanged input', async () => {
    const env = makeEnv();
    await seed(env);
    const again = await ingestRecords(env, 'CPSC', [CPSC], 'full', '2026-09-28T00:00:00.000Z');
    expect(again).toMatchObject({ inserted: 0, changed: 0 });
    const changed = await ingestRecords(env, 'CPSC', [{ ...CPSC, LastPublishDate: '2025-05-01T00:00:00' }], 'full', '2026-09-29T00:00:00.000Z');
    expect(changed).toMatchObject({ inserted: 0, changed: 1 });
    const row = await env.DB.prepare("SELECT first_seen_at, changed_at FROM product_recall WHERE id = 'cpsc-25203'").first();
    expect(row).toEqual({ first_seen_at: NOW, changed_at: '2026-09-29T00:00:00.000Z' });
  });

  it('fails a CPSC response whose records are an error body rather than recalls', async () => {
    const env = makeEnv();
    await expect(ingestRecords(env, 'CPSC', [{ Message: 'An error has occurred.' }], 'window', NOW)).rejects.toThrow(/holds no recall notice/);
    const run = await env.DB.prepare("SELECT status FROM sync_run ORDER BY id DESC LIMIT 1").first<{ status: string }>();
    expect(run?.status).toBe('FAILED');
    await expect(ingestRecords(env, 'CPSC', [], 'window', NOW)).resolves.toMatchObject({ fetched: 0 });
  });

  it('refuses a truncated full list instead of treating it as the whole source', async () => {
    const env = makeEnv();
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('canada.ca') ? [HC] : [CPSC]), { status: 200 }));
    const results = await scheduledProductSync(env, { full: true, fetcher: fetcher as unknown as typeof fetch });
    expect(results.map((result) => result.error)).toEqual([expect.stringMatching(/CPSC full list/), expect.stringMatching(new RegExp(`only 1 consumer`))]);
    expect(MIN_FULL_HC_CONSUMER).toBeGreaterThan(1000);
  });

  it('reads the full CPSC list in bounded RecallDate windows, archiving each', async () => {
    const env = makeEnv();
    const windows = cpscFullWindows('2026-09-27');
    expect(windows[0]!.url).toContain('RecallDateStart=1900-01-01&RecallDateEnd=1989-12-31');
    expect(windows.at(-1)!.url).toContain('RecallDateStart=2026-01-01&RecallDateEnd=2026-12-31');
    expect(windows).toHaveLength(2 + 27);
    const fetcher = vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('canada.ca') ? [HC] : String(url).includes('RecallDateStart=2025-01-01') ? [CPSC] : []), { status: 200 }),
    );
    const [cpsc] = await scheduledProductSync(env, { full: true, today: '2026-09-27', fetcher: fetcher as unknown as typeof fetch });
    const cpscCalls = fetcher.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('saferproducts'));
    expect(cpscCalls).toHaveLength(windows.length);
    expect(cpscCalls.every((url) => url.includes('RecallDateStart='))).toBe(true);
    // Every window was read and ingested; the total is then checked against the full-list floor.
    expect(cpsc!.error).toMatch(/CPSC full list has only 1 records/);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM product_recall WHERE agency = 'CPSC'").first()).toEqual({ n: 1 });
    // A pass that fails its floor is never reported as a successful CPSC refresh, even though its windows ran.
    const runs = await env.DB.prepare("SELECT category, status FROM sync_run WHERE category LIKE 'product%CPSC' ORDER BY id").all<{ category: string; status: string }>();
    expect(runs.results.filter((run) => run.category === 'product:CPSC')).toEqual([{ category: 'product:CPSC', status: 'FAILED' }]);
    expect(runs.results.filter((run) => run.category === 'product-window:CPSC')).toHaveLength(windows.length);
    const stats = (await (await worker.fetch(api('/v1/product-recalls/stats'), env)).json()) as { last_successful_sync: Record<string, string | null> };
    expect(stats.last_successful_sync['CPSC'] ?? null).toBeNull();
    expect(Object.keys(stats.last_successful_sync)).not.toContain('product-window:CPSC');
  });

  it('records one successful CPSC refresh after every window of a complete pass', async () => {
    const env = makeEnv();
    const many = Array.from({ length: MIN_FULL_CPSC }, (_, index) => ({ ...CPSC, RecallNumber: String(40000 + index), Inconjunctions: [] }));
    const fetcher = vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('canada.ca') ? [HC] : String(url).includes('RecallDateStart=2025-01-01') ? many : []), { status: 200 }),
    );
    const [cpsc] = await scheduledProductSync(env, { full: true, today: '2026-09-27', fetcher: fetcher as unknown as typeof fetch });
    expect(cpsc!.error).toBeUndefined();
    expect(cpsc!.fetched).toBe(MIN_FULL_CPSC);
    const runs = await env.DB.prepare("SELECT status, fetched FROM sync_run WHERE category = 'product:CPSC'").all<{ status: string; fetched: number }>();
    expect(runs.results).toEqual([{ status: 'SUCCEEDED', fetched: MIN_FULL_CPSC }]);
  }, 60_000);

  it('reads the recent CPSC window and the Health Canada index on a normal run', async () => {
    const env = makeEnv();
    const many = Array.from({ length: MIN_FULL_HC_CONSUMER }, (_, index) => ({ ...HC_ONLY, NID: String(100000 + index), URL: `https://recalls-rappels.canada.ca/en/alert-recall/n-${index}` }));
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('canada.ca') ? [HC, ...many] : [CPSC]), { status: 200 }));
    const results = await scheduledProductSync(env, { full: false, today: '2026-09-27', fetcher: fetcher as unknown as typeof fetch });
    expect(results.map((result) => result.error)).toEqual([undefined, undefined]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('LastPublishDateStart=2026-08-28');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM product_recall').first()).toEqual({ n: MIN_FULL_HC_CONSUMER + 2 });
  });

  it('archives each whole response before parsing it, out-of-scope records included', async () => {
    const env = makeEnv();
    const many = Array.from({ length: MIN_FULL_HC_CONSUMER }, (_, index) => ({ ...HC_ONLY, NID: String(100000 + index), URL: `https://recalls-rappels.canada.ca/en/alert-recall/n-${index}` }));
    const food = { ...HC_ONLY, NID: '999', Organization: 'Food', URL: 'https://recalls-rappels.canada.ca/en/alert-recall/food' };
    const bodies = { hc: JSON.stringify([HC, food, ...many]), cpsc: JSON.stringify([CPSC]) };
    const fetcher = vi.fn(async (url: string) => new Response(String(url).includes('canada.ca') ? bodies.hc : bodies.cpsc, { status: 200 }));
    await scheduledProductSync(env, { full: false, today: '2026-09-27', fetcher: fetcher as unknown as typeof fetch });
    const archived = [...env.bucket.objects].filter(([key]) => key.startsWith('product-recalls/source/'));
    expect(archived.map(([key]) => key.replace(/[0-9a-f]{64}/, 'HASH')).sort()).toEqual(['product-recalls/source/cpsc/sha256-HASH.json', 'product-recalls/source/hc/sha256-HASH.json']);
    expect(archived.map(([, body]) => body).sort()).toEqual([bodies.cpsc, bodies.hc].sort());
    const runs = await env.DB.prepare("SELECT category, artifact_keys FROM sync_run WHERE category LIKE 'product:%' ORDER BY id").all<{ category: string; artifact_keys: string }>();
    for (const run of runs.results) expect(JSON.parse(run.artifact_keys)[0]).toMatch(/^product-recalls\/source\/(cpsc|hc)\/sha256-[0-9a-f]{64}\.json$/);
  });

  it('does not acquire under the kill switch', async () => {
    const env = makeEnv({ PRODUCT_RECALLS_KILL_SWITCH: '1' });
    const fetcher = vi.fn();
    expect(await scheduledProductSync(env, { full: true, fetcher: fetcher as unknown as typeof fetch })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('renders offline bulk statements under the D1 statement limit', async () => {
    const prepared = await prepareProductRecall('CPSC', CPSC);
    for (const group of writeProductGroups([{ prepared, rawRef: 'product-recalls/bulk/x.ndjson#0:10' }], NOW, MAX_LITERAL_JSON_BYTES)) {
      for (const statement of group) expect(new TextEncoder().encode(renderLiteral(statement)).byteLength).toBeLessThan(100_000);
    }
    expect(isIndexableNotice(prepared.recall)).toBe(true);
  });
});

describe('product-recall API', () => {
  it('links a joint recall both ways through the declared citation only', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    const cpsc = (await (await worker.fetch(api('/v1/product-recalls/cpsc-25203', apiKey), env)).json()) as { data: { linked_notices: unknown[] } };
    expect(cpsc.data.linked_notices).toEqual([{ id: 'hc-77184', agency: 'HC', title: HC.Title.trim(), url: HC.URL, relation: 'cites', basis: 'declared_citation' }]);
    const hc = (await (await worker.fetch(api('/v1/product-recalls/HC-77184', apiKey), env)).json()) as { data: { linked_notices: Array<{ id: string; relation: string }>; joint_with: string[] } };
    expect(hc.data.linked_notices).toEqual([expect.objectContaining({ id: 'cpsc-25203', relation: 'cited_by' })]);
    expect(hc.data.joint_with).toEqual(['CPSC']);
    const alone = (await (await worker.fetch(api('/v1/product-recalls/hc-82659', apiKey), env)).json()) as { data: { linked_notices: unknown[] } };
    expect(alone.data.linked_notices).toEqual([]);
  });

  it('looks up model numbers and UPCs exactly', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    for (const code of ['DXH70CFAVX', 'dxh-70cfavx', '089301008588', '0089301008588']) {
      const body = (await (await worker.fetch(api(`/v1/product-recalls/lookup?code=${code}`, apiKey), env)).json()) as { data: Array<{ recall: { id: string } }>; total_matches: number };
      expect(body.data.map((item) => item.recall.id), code).toEqual(['cpsc-25203']);
      expect(body.total_matches).toBe(1);
    }
    const none = (await (await worker.fetch(api('/v1/product-recalls/lookup?code=089301008589', apiKey), env)).json()) as { data: unknown[] };
    expect(none.data).toEqual([]);
  });

  it('indexes every distinct product type as a category, not only the first', async () => {
    const env = makeEnv();
    const multi = { ...CPSC, RecallNumber: '31000', Inconjunctions: [], Products: [{ Name: 'Heater', Type: 'Heaters' }, { Name: 'Tank adapter', Type: 'Propane Accessories' }] };
    await ingestRecords(env, 'CPSC', [multi], 'full', NOW);
    const apiKey = await key(env);
    for (const category of ['heaters', 'propane accessories']) {
      const body = (await (await worker.fetch(api(`/v1/product-recalls?category=${encodeURIComponent(category)}`, apiKey), env)).json()) as { data: Array<{ id: string }> };
      expect(body.data.map((item) => item.id), category).toEqual(['cpsc-31000']);
    }
  });

  it('returns match details only for the notices in the bounded page', async () => {
    const env = makeEnv();
    const many = Array.from({ length: 30 }, (_, index) => ({ ...CPSC, RecallNumber: String(30000 + index), Inconjunctions: [] }));
    await ingestRecords(env, 'CPSC', many, 'full', NOW);
    const apiKey = await key(env);
    type Body = { data: Array<{ matched_on: Array<{ kind: string; value: string }>; recall: { id: string } }>; total_matches: number; truncated: boolean };
    const body = (await (await worker.fetch(api('/v1/product-recalls/lookup?code=DXH70CFAVX&include=raw', apiKey), env)).json()) as Body;
    expect(body.total_matches).toBe(30);
    expect(body.truncated).toBe(true);
    expect(body.data).toHaveLength(25);
    for (const item of body.data) expect(item.matched_on).toEqual([{ kind: 'model', value: 'DXH70CFAVX' }]);
  });

  it('lists on the API root only the datasets that are served', async () => {
    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    const root = (await (await worker.fetch(api('/'), killed)).json()) as { datasets: Record<string, unknown> };
    expect(Object.keys(root.datasets)).toEqual(['product-recalls']);
    const both = (await (await worker.fetch(api('/'), makeEnv())).json()) as { datasets: Record<string, { docs: string }> };
    expect(Object.keys(both.datasets)).toEqual(['recalls', 'product-recalls']);
    expect(both.datasets['product-recalls']!.docs).toBe('https://data.aroqon.com/docs#product-recalls');
    // The registry key and stats path let a client (the local collector) map what is hosted to its member sources.
    expect(both.datasets['product-recalls']).toMatchObject({ registry: 'consumer-product-recalls-north-america', stats: 'https://api.data.aroqon.com/v1/product-recalls/stats' });
    expect(both.datasets['recalls']).toMatchObject({ registry: 'fda-recalls', stats: 'https://api.data.aroqon.com/v1/recalls/stats' });
  });

  it('filters by agency, hazard, facet, firm, text and link status, with a stable cursor', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    const ids = async (query: string): Promise<string[]> => ((await (await worker.fetch(api(`/v1/product-recalls?${query}`, apiKey), env)).json()) as { data: Array<{ id: string }> }).data.map((item) => item.id);
    expect(await ids('agency=HC')).toEqual(['hc-82659', 'hc-77184']);
    expect(await ids('hazard=choking')).toEqual(['hc-82659']);
    expect(await ids('facet=hvac')).toEqual(['hc-77184', 'cpsc-25203']);
    expect(await ids('firm=enerco')).toEqual(['cpsc-25203']);
    expect(await ids('q=propane heater')).toEqual(['hc-77184', 'cpsc-25203']);
    expect(await ids('linked=true')).toEqual(['hc-77184', 'cpsc-25203']);
    expect(await ids('from=2026-01-01')).toEqual(['hc-82659']);
    const first = (await (await worker.fetch(api('/v1/product-recalls?limit=1', apiKey), env)).json()) as { data: Array<{ id: string }>; next_cursor: string };
    const second = (await (await worker.fetch(api(`/v1/product-recalls?limit=1&cursor=${first.next_cursor}`, apiKey), env)).json()) as { data: Array<{ id: string }>; next_cursor: string };
    const third = (await (await worker.fetch(api(`/v1/product-recalls?limit=1&cursor=${second.next_cursor}`, apiKey), env)).json()) as { data: Array<{ id: string }> };
    // Newest first; notices on the same date in descending id order.
    expect([first.data[0]?.id, second.data[0]?.id, third.data[0]?.id]).toEqual(['hc-82659', 'hc-77184', 'cpsc-25203']);
    expect((await worker.fetch(api('/v1/product-recalls?hazard=gremlins', apiKey), env)).status).toBe(400);
  });

  it('serves verified raw evidence without contact text or images', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    const body = (await (await worker.fetch(api('/v1/product-recalls/cpsc-25203?include=raw', apiKey), env)).json()) as { data: { raw: Record<string, unknown>; provenance: { raw_sha256: string } } };
    expect(body.data.raw['RecallNumber']).toBe('25203');
    expect(body.data.raw['ConsumerContact']).toBeUndefined();
    expect(body.data.raw['Images']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('800-964-4328');
    const hc = (await (await worker.fetch(api('/v1/product-recalls/hc-77184?include=raw', apiKey), env)).json()) as { data: { raw: Record<string, unknown> } };
    expect(hc.data.raw['What you should do']).toBeUndefined();
  });

  it('reports what was withheld and a digest that matches the raw object returned', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    type Body = { data: { raw: Record<string, unknown>; raw_redaction: { removed_fields: string[]; presented_sha256: string }; provenance: { raw_sha256: string } } };
    for (const [id, withheld] of [['cpsc-25203', ['ConsumerContact']], ['hc-77184', ['What you should do']]] as const) {
      const body = (await (await worker.fetch(api(`/v1/product-recalls/${id}?include=raw`, apiKey), env)).json()) as Body;
      expect(body.data.raw_redaction.removed_fields).toEqual(expect.arrayContaining([...withheld]));
      expect(body.data.raw_redaction.presented_sha256).toBe(await sha256Hex(JSON.stringify(body.data.raw)));
      // The provenance digest stays that of the stored original, which differs once fields are withheld.
      expect(body.data.provenance.raw_sha256).not.toBe(body.data.raw_redaction.presented_sha256);
    }
    const plain = (await (await worker.fetch(api('/v1/product-recalls/cpsc-25203', apiKey), env)).json()) as { data: Record<string, unknown> };
    expect(plain.data['raw_redaction']).toBeUndefined();
  });

  it('answers 404, not 500, for malformed escapes in a notice id', async () => {
    const env = makeEnv();
    await seed(env);
    const apiKey = await key(env);
    for (const bad of ['%', '%ZZ', 'cpsc-%E0%A4%A']) {
      const response = await worker.fetch(api(`/v1/product-recalls/${bad}`, apiKey), env);
      expect(response.status, bad).toBe(404);
    }
    expect((await worker.fetch(api('/v1/product-recalls/CPSC-25203', apiKey), env)).status).toBe(200);
  });

  it('requires a key, and stays closed until opened or when killed', async () => {
    const env = makeEnv();
    await seed(env);
    expect((await worker.fetch(api('/v1/product-recalls'), env)).status).toBe(401);
    const stats = (await (await worker.fetch(api('/v1/product-recalls/stats'), env)).json()) as Record<string, unknown>;
    expect(stats).toMatchObject({ declared_cross_agency_links: 1, identifiers: { gtin: 1, model: 1 } });
    for (const overrides of [{ PRODUCT_RECALLS_OPEN: '0' }, { PRODUCT_RECALLS_KILL_SWITCH: '1' }]) {
      const closed = { ...env, ...overrides };
      // Refused before any key check, so the dataset's existence is not probed through auth errors.
      expect((await worker.fetch(api('/v1/product-recalls', 'rcl_live_unchecked'), closed)).status).toBe(503);
      expect((await worker.fetch(site('/product-recalls/cpsc-25203'), closed)).status).toBe(503);
      expect((await worker.fetch(site('/product-recalls'), closed)).status).toBe(503);
      expect(await (await worker.fetch(site('/llms.txt'), closed)).text()).not.toContain('product-recalls');
    }
  });
});

describe('product-recall pages', () => {
  it('serves notice pages from the API presenter, indexing only substantive notices', async () => {
    const env = makeEnv();
    await seed(env);
    const cpsc = await (await worker.fetch(site('/product-recalls/cpsc-25203'), env)).text();
    expect(cpsc).toContain('DXH70CFAVX');
    expect(cpsc).toContain('/product-recalls/hc-77184');
    expect(cpsc).not.toContain('noindex');
    expect(cpsc).toContain('"@type":"WebPage"');
    const hc = await (await worker.fetch(site('/product-recalls/hc-77184'), env)).text();
    expect(hc).toContain('noindex, follow');
    expect(hc).toContain('Open Government Licence');
    expect(hc).not.toContain('1-800-964-4328');
    expect((await worker.fetch(site('/product-recalls/cpsc-99999'), env)).status).toBe(404);
  });

  it('lists indexable notices in the sitemap and hubs, and announces the dataset to agents', async () => {
    const env = makeEnv();
    await seed(env);
    const index = await (await worker.fetch(site('/sitemap.xml'), env)).text();
    expect(index).toContain('/sitemaps/product-recalls-1.xml');
    const shard = await (await worker.fetch(site('/sitemaps/product-recalls-1.xml'), env)).text();
    expect(shard).toContain('/product-recalls/cpsc-25203');
    expect(shard).not.toContain('hc-');
    expect((await worker.fetch(site('/sitemaps/product-recalls-2.xml'), env)).status).toBe(404);
    expect(await (await worker.fetch(site('/product-recalls/browse/cpsc/2025'), env)).text()).toContain('/product-recalls/cpsc-25203');
    expect((await worker.fetch(site('/product-recalls/browse/cpsc/2025?page=2'), env)).status).toBe(404);
    expect(await (await worker.fetch(site('/llms.txt'), env)).text()).toContain('/v1/product-recalls/lookup');
    expect(await (await worker.fetch(site('/'), env)).text()).toContain('North American Consumer Product Recalls');
    const openapi = (await (await worker.fetch(api('/openapi.json'), env)).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(openapi.paths)).toEqual(expect.arrayContaining(['/v1/product-recalls', '/v1/product-recalls/lookup', '/v1/product-recalls/{id}']));
    const closedApi = (await (await worker.fetch(api('/openapi.json'), { ...env, PRODUCT_RECALLS_OPEN: '0' })).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(closedApi.paths).some((path) => path.startsWith('/v1/product-recalls'))).toBe(false);
  });

  it('announces changed, indexable notice pages to IndexNow under their own watermark', async () => {
    const env = makeEnv({ INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    await seed(env);
    await env.RAW_ARTIFACTS.put(PRODUCT_INDEXNOW_FEED.watermarkKey, JSON.stringify({ since: '2026-09-27T00:00:00.000Z' }));
    const sent: string[] = [];
    const fetcher = (async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const ctx = { publicOrigin: 'https://data.aroqon.com', apiOrigin: 'https://api.data.aroqon.com', supportEmail: 's@example.com' };
    // Seeded at 12:00; by 14:00 every edge copy has expired. Only the substantive CPSC notice is indexable, as in the sitemap.
    expect(await pingChanged(PRODUCT_INDEXNOW_FEED, ctx, env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, '2026-09-27T14:00:00.000Z', fetcher)).toEqual({ since: '2026-09-27T00:00:00.000Z', submitted: 1, status: [202], advanced: true });
    expect((JSON.parse(sent[0] as string) as { urlList: string[] }).urlList).toEqual(['https://data.aroqon.com/product-recalls/cpsc-25203']);
    expect(await (await env.RAW_ARTIFACTS.get(PRODUCT_INDEXNOW_FEED.watermarkKey))?.text()).toBe(JSON.stringify({ since: '2026-09-27T12:55:00.000Z' }));
    // The FDA feed's watermark is untouched.
    expect(await env.RAW_ARTIFACTS.get('state/indexnow-watermark.json')).toBeNull();
  });

  it('pings product pages on schedule only while the dataset is served, independently of the FDA kill switch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T14:00:00.000Z'));
    try {
      for (const [overrides, expected] of [
        [{ SOURCE_KILL_SWITCH: '1' }, 1],
        [{ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' }, 0],
        [{ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_KILL_SWITCH: '1' }, 0],
      ] as const) {
        const env = makeEnv({ INDEXNOW_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', ...overrides });
        await seed(env);
        await env.RAW_ARTIFACTS.put(PRODUCT_INDEXNOW_FEED.watermarkKey, JSON.stringify({ since: '2026-09-27T00:00:00.000Z' }));
        const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
        vi.stubGlobal('fetch', fetcher);
        await worker.scheduled({ scheduledTime: Date.parse('2026-09-27T12:17:00.000Z') }, env);
        const pings = fetcher.mock.calls.filter((call) => String((call as unknown[])[0]).includes('indexnow'));
        expect(pings.length, JSON.stringify(overrides)).toBe(expected);
        for (const call of pings) expect(String(((call as unknown[])[1] as { body: string }).body)).toContain('/product-recalls/cpsc-25203');
        vi.unstubAllGlobals();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('escapes notice text', async () => {
    const env = makeEnv();
    await ingestRecords(env, 'CPSC', [{ ...CPSC, Title: 'Acme <script>alert(1)</script> Recalls Heaters' }], 'full', NOW);
    const page = await (await worker.fetch(site('/product-recalls/cpsc-25203'), env)).text();
    expect(page).not.toContain('<script>alert(1)</script>');
  });
});
