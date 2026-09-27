import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { renderLiteral } from '../src/store.js';
import { ingestRecords, MIN_FULL_HC_CONSUMER, scheduledProductSync } from '../src/product-sync.js';
import { isIndexableNotice, prepareProductRecall, writeProductGroups, MAX_LITERAL_JSON_BYTES } from '../src/product-store.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

// Verbatim source records (CPSC Recall API and Health Canada open data), retrieved 2026-09-27.
const CPSC = {
  RecallID: 10220,
  RecallNumber: '25203',
  RecallDate: '2025-04-03T00:00:00',
  Description:
    'This recall involves DEWALT 70,000 BTU outdoor portable cordless forced air propane heaters model number DXH70CFAVX. The heaters are yellow and black. The model number is located on the hang tag. "DEWALT" is printed in black on the side of the bottom yellow portion of the units. ',
  URL: 'https://www.cpsc.gov/Recalls/2025/Enerco-Recalls-DEWALT-70000-BTU-Outdoor-Portable-Cordless-Forced-Air-Propane-Heaters-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-Lowes',
  Title: "Enerco Recalls DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters Due to Fire and Burn Hazards; Sold Exclusively at Lowe's",
  ConsumerContact: 'Enerco toll-free at 800-964-4328',
  LastPublishDate: '2025-04-03T00:00:00',
  Products: [{ Name: 'DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters', Description: '', Model: '', Type: '', CategoryID: '', NumberOfUnits: 'About 21,250 (In addition, about 500 were sold in Canada)' }],
  Inconjunctions: [{ URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire' }],
  Images: [{ URL: 'https://cpsc.gov/s3fs-public/heater.jpg', Caption: 'Recalled heater' }],
  Injuries: [{ Name: 'The firm has received 11 reports of overheating. No injuries have been reported.' }],
  Manufacturers: [],
  Retailers: [{ Name: "Lowe's stores nationwide and online at Lowes.com from May 2024 through January 2025 for about $200.", CompanyID: '' }],
  Importers: [{ Name: 'Enerco Group Inc., of Cleveland, Ohio', CompanyID: '' }],
  Distributors: [],
  SoldAtLabel: null,
  ManufacturerCountries: [{ Country: 'China' }],
  ProductUPCs: [{ UPC: '089301008588' }],
  Hazards: [
    {
      Name: "The recalled portable heaters' operating instructions can cause consumers to incorrectly depress the start button too quickly and prevent the fan from starting, causing the heaters to overheat, posing fire and burn hazards.",
      HazardType: '',
      HazardTypeID: '',
    },
  ],
  Remedies: [{ Name: 'Consumers should immediately stop using the recalled heaters and contact Enerco to request new instructions and a warning sticker describing how to start the heater using the power button.' }],
  RemedyOptions: [{ Option: 'Repair' }],
};

const HC = {
  NID: '77184',
  Title: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater recalled due to fire hazard ',
  URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire',
  Organization: 'Consumer product safety',
  Product: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater',
  Issue: 'Fire hazard',
  'What you should do':
    'Consumers should immediately stop using the recalled product.For more information, consumers can contact Enerco Group by telephone at 1-800-964-4328.Joint recall with Health Canada, the United States Consumer Product Safety Commission (US CPSC) and Enerco Group.Please note that the Canada Consumer Product Safety Act prohibits recalled products from being redistributed.',
  Category: 'Outdoor living',
  'Recall class': '',
  'Last updated': '2025-04-03',
  Archived: '0',
};

const HC_ONLY = { ...HC, NID: '82659', Title: "Make Believe Ideas Groovy Baby 'I Spy a Fly!' board book recalled due to choking hazard", URL: 'https://recalls-rappels.canada.ca/en/alert-recall/make-believe-ideas-groovy-baby-spy-fly-board-book-recalled-due-choking-hazard', Product: "Make Believe Ideas Groovy Baby 'I Spy a Fly!' board book", Issue: 'Choking hazard', Category: 'Toys and games', 'What you should do': '', 'Last updated': '2026-09-22' };
const MEDICAL = { ...HC, NID: '82681', Organization: 'Medical devices', Title: 'PERMA-HAND Silk Suture' };

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

  it('refuses a truncated full list instead of treating it as the whole source', async () => {
    const env = makeEnv();
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('canada.ca') ? [HC] : [CPSC]), { status: 200 }));
    const results = await scheduledProductSync(env, { full: true, fetcher: fetcher as unknown as typeof fetch });
    expect(results.map((result) => result.error)).toEqual([expect.stringMatching(/CPSC full list/), expect.stringMatching(new RegExp(`only 1 consumer`))]);
    expect(MIN_FULL_HC_CONSUMER).toBeGreaterThan(1000);
  });

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

  it('escapes notice text', async () => {
    const env = makeEnv();
    await ingestRecords(env, 'CPSC', [{ ...CPSC, Title: 'Acme <script>alert(1)</script> Recalls Heaters' }], 'full', NOW);
    const page = await (await worker.fetch(site('/product-recalls/cpsc-25203'), env)).text();
    expect(page).not.toContain('<script>alert(1)</script>');
  });
});
