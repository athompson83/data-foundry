import { beforeEach, describe, expect, it } from 'vitest';

import { DATASETS, publishedDatasets } from '../src/catalog.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ingestRecords } from '../src/product-sync.js';
import { ndjsonBundle, prepareRecall, rawRef, writeRecallStatements } from '../src/store.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

const FOOD = {
  recall_number: 'F-0001-2026',
  status: 'Ongoing',
  classification: 'Class I',
  recalling_firm: 'Acme Snacks LLC',
  distribution_pattern: 'Distributed to retailers in TX, OK and LA.',
  product_description: 'Acme Peanut Crunch Bars, 2 oz, UPC 0 12345 67890 5',
  product_quantity: '1,200 cases',
  reason_for_recall: 'Product contains undeclared peanuts.',
  report_date: '20260915',
};

const CPSC = {
  RecallID: 1,
  RecallNumber: '25203',
  RecallDate: '2025-04-03T00:00:00',
  Title: 'Enerco Recalls Propane Heaters Due to Fire Hazard',
  Description: 'This recall involves propane heaters model number DXH70CFAVX. The model number is located on the hang tag of every unit sold.',
  URL: 'https://www.cpsc.gov/Recalls/2025/example',
  Products: [{ Name: 'Heater', NumberOfUnits: 'About 21,250' }],
  Hazards: [{ Name: 'The heaters can overheat, posing fire and burn hazards.' }],
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  const { db } = createTestDatabase();
  return { DB: db, RAW_ARTIFACTS: createTestBucket(), PUBLIC_ORIGIN: 'https://data.aroqon.com', API_ORIGIN: 'https://api.data.aroqon.com', SALES_OPEN: '1', PRODUCT_RECALLS_OPEN: '1', ...overrides };
}

async function seed(env: Env): Promise<void> {
  const prepared = await prepareRecall('food', FOOD);
  const bundle = ndjsonBundle([prepared.raw]);
  await env.RAW_ARTIFACTS.put('recalls/test.ndjson', bundle.body);
  const statements = writeRecallStatements(prepared, rawRef('recalls/test.ndjson', 0, bundle.ranges[0]!.length), '2026-09-26T00:00:00.000Z');
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
  await ingestRecords(env, 'CPSC', [CPSC], 'full', '2026-09-27T12:00:00.000Z');
}

const site = (path: string): Request => new Request(`https://data.aroqon.com${path}`);
const page = async (env: Env, path: string): Promise<{ status: number; body: string; headers: Headers }> => {
  const response = await worker.fetch(site(path), env);
  return { status: response.status, body: await response.text(), headers: response.headers };
};

beforeEach(() => {
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => void store.set(request.url, response),
    },
  };
});

describe('homepage and catalog', () => {
  it('lists every published dataset with live coverage and working actions', async () => {
    const env = makeEnv();
    await seed(env);
    const { status, body } = await page(env, '/');
    expect(status).toBe(200);
    expect(body).toContain('<h1>Clean data for applications and AI agents.</h1>');
    expect(body).toContain('href="#datasets"');
    expect(body).toContain('href="/docs"');
    expect(body).toContain('href="/recalls"');
    expect(body).toContain('href="/product-recalls"');
    // Coverage comes from the data (1 FDA recall, 1 CPSC notice), not from copy.
    const rows = body.match(/<li class="catalog-row">[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<dt>Records</dt><dd>1</dd>');
    expect(rows[0]).toContain('<dt>Sources</dt><dd>FDA</dd>');
    expect(rows[0]).toContain('<dt>Last refresh</dt><dd>not yet recorded</dd>');
    expect(rows[1]).toContain('<dt>Sources</dt><dd>CPSC, Health Canada</dd>');
    expect(rows[1]).toMatch(/<dt>Last refresh<\/dt><dd>(\d{4}-\d\d-\d\d \d\d:\d\d UTC|not yet recorded)<\/dd>/);
    expect(rows[1]).toContain('<span class="tag">Consumer products</span>');
    expect(body).toContain('Snapshot of a real response, not live.');
  });

  it('shows only published datasets and follows each dataset gate', async () => {
    const closedProducts = makeEnv({ PRODUCT_RECALLS_OPEN: '0' });
    await seed(closedProducts);
    const home = await page(closedProducts, '/');
    expect(home.body).not.toContain('href="/product-recalls"');
    expect((await page(closedProducts, '/product-recalls')).status).toBe(503);

    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' });
    await seed(killed);
    const empty = await page(killed, '/');
    expect(empty.body).toContain('No dataset is available right now.');
    expect(empty.body).not.toContain('href="/recalls"');
    expect((await page(killed, '/recalls')).status).toBe(503);
    expect(publishedDatasets(killed)).toEqual([]);
  });

  it('offers checkout only while sales are open, and never a marketplace button', async () => {
    const open = makeEnv();
    await seed(open);
    for (const path of ['/', '/recalls', '/product-recalls']) {
      const { body } = await page(open, path);
      expect(body, path).toContain('action="/recalls/checkout"');
      expect(body, path).not.toMatch(/rapidapi/i);
    }
    const closed = makeEnv({ SALES_OPEN: '0' });
    await seed(closed);
    for (const path of ['/', '/recalls', '/product-recalls']) {
      const { body } = await page(closed, path);
      expect(body, path).not.toContain('action="/recalls/checkout"');
      expect(body, path).toContain('Sign-ups are not open yet.');
    }
  });

  it('describes only the published datasets in DataCatalog JSON-LD', async () => {
    const env = makeEnv({ PRODUCT_RECALLS_OPEN: '0' });
    const { body } = await page(env, '/');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(body)![1]!) as { '@type': string; dataset: Array<{ name: string }> };
    expect(ld['@type']).toBe('DataCatalog');
    expect(ld.dataset.map((dataset) => dataset.name)).toEqual(['FDA Recall Intelligence']);
  });

  it('drops a withdrawn dataset from the JSON-LD as well as the page', async () => {
    const env = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    await seed(env);
    const { body } = await page(env, '/');
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(body)![1]!) as { dataset: Array<{ name: string }> };
    expect(ld.dataset.map((dataset) => dataset.name)).toEqual(['North American Consumer Product Recalls']);
    expect(body).not.toContain('href="/recalls"');
  });
});

describe('withdrawing one dataset leaves no path into it', () => {
  it('drops a withdrawn dataset page from the static sitemap', async () => {
    const env = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    const pages = (await page(env, '/sitemaps/pages.xml')).body;
    expect(pages).not.toContain('<loc>https://data.aroqon.com/recalls</loc>');
    expect(pages).toContain('<loc>https://data.aroqon.com/product-recalls</loc>');
    const both = (await page(makeEnv(), '/sitemaps/pages.xml')).body;
    expect(both).toContain('<loc>https://data.aroqon.com/recalls</loc>');
  });

  it('never calls a parser-output sample a real response', async () => {
    const env = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    await seed(env);
    const home = (await page(env, '/')).body;
    expect(home).not.toContain('A real response captured');
    expect(home).toContain('Parser output · snapshot of');
    const product = (await page(env, '/product-recalls')).body;
    expect(product).toContain('<h2>Sample record</h2>');
    expect(product).not.toContain('Response · snapshot captured');
    const fda = (await page(makeEnv(), '/recalls')).body;
    expect(fda).toContain('Response · snapshot captured 2026-09-27');
  });

  it('omits a withdrawn dataset from /docs and the OpenAPI contract', async () => {
    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    const docs = (await page(killed, '/docs')).body;
    expect(docs).not.toContain('id="fda-recalls"');
    expect(docs).toContain('id="product-recalls-lookup"');
    expect(docs).toContain('id="account"');
    const openapi = (await (await worker.fetch(new Request('https://api.data.aroqon.com/openapi.json'), killed)).json()) as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(Object.keys(openapi.paths).filter((path) => path.startsWith('/v1/recalls'))).toEqual([]);
    expect(openapi.paths['/v1/product-recalls/lookup']).toBeDefined();
    expect(openapi.components.schemas['Recall']).toBeUndefined();
    const both = (await (await worker.fetch(new Request('https://api.data.aroqon.com/openapi.json'), makeEnv())).json()) as { paths: Record<string, unknown> };
    expect(both.paths['/v1/recalls/lookup']).toBeDefined();
    expect((await page(makeEnv(), '/docs')).body).toContain('id="fda-recalls"');
  });

  it('sends gate-dependent discovery output no-cache, so a withdrawal applies on the next request', async () => {
    const env = makeEnv();
    for (const path of ['/llms.txt', '/llms-full.txt', '/sitemaps/pages.xml', '/docs']) {
      expect((await page(env, path)).headers.get('cache-control'), path).toBe('no-cache');
    }
    const openapi = await worker.fetch(new Request('https://api.data.aroqon.com/openapi.json'), env);
    expect(openapi.headers.get('cache-control')).toBe('no-cache');
  });

  it('describes only served datasets to agents in llms.txt and llms-full.txt', async () => {
    const killed = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    for (const path of ['/llms.txt', '/llms-full.txt']) {
      const body = (await page(killed, path)).body;
      expect(body, path).not.toContain('/v1/recalls/lookup');
      expect(body, path).not.toContain('[FDA Recall Intelligence]');
      expect(body, path).toContain('/v1/product-recalls/lookup');
    }
    expect((await page(killed, '/llms-full.txt')).body).toContain('## Errors and limits');
    const both = (await page(makeEnv(), '/llms-full.txt')).body;
    expect(both).toContain('## Recall API reference');
    expect(both).toContain('## Product recall API reference');
    expect(both).not.toMatch(/about 87,000/);
    const none = (await page(makeEnv({ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' }), '/llms.txt')).body;
    expect(none).toContain('No dataset is available right now.');
  });

  it('sends product-recall readers to pricing that is served whatever the FDA state', async () => {
    const env = makeEnv({ SOURCE_KILL_SWITCH: '1' });
    await seed(env);
    const notice = (await page(env, '/product-recalls/cpsc-25203')).body;
    expect(notice).toContain('href="/#pricing"');
    expect(notice).not.toContain('/recalls#pricing');
    const home = await page(env, '/');
    expect(home.status).toBe(200);
    expect(home.body).toContain('id="pricing"');
  });
});

describe('dataset product pages', () => {
  it('separates the refresh schedule from the last successful refresh', async () => {
    const env = makeEnv();
    await seed(env);
    const fda = await page(env, '/recalls');
    expect(fda.body).toContain('We check openFDA every six hours.');
    // No FDA sync has run in this database: the page says so instead of implying freshness.
    expect(fda.body).toContain('<dt>Last successful refresh</dt><dd>not yet recorded</dd>');
    const products = await page(env, '/product-recalls');
    // The seeded sync is recorded at the wall-clock time, so only the timestamp's shape is fixed (a pinned date expires).
    expect(products.body).toMatch(/<dt>Last successful refresh<\/dt><dd>\d{4}-\d\d-\d\d \d\d:\d\d UTC<\/dd>|not yet recorded/);
  });

  it('links every endpoint to an anchor that exists in the docs', async () => {
    const env = makeEnv();
    const docs = (await page(env, '/docs')).body;
    for (const entry of Object.values(DATASETS)) {
      for (const endpoint of entry.endpoints) {
        const anchor = endpoint.docs.split('#')[1]!;
        expect(docs, anchor).toContain(`id="${anchor}"`);
      }
    }
  });

  it('keeps samples consistent with the API contract and free of credentials', () => {
    for (const entry of Object.values(DATASETS)) {
      const sample = JSON.parse(entry.sample.response) as { data: Record<string, unknown> };
      expect(sample.data).toBeTypeOf('object');
      expect(entry.sample.request).toContain('https://api.data.aroqon.com/v1/');
      expect(entry.sample.request).toContain('Authorization: Bearer $DATA_FOUNDRY_KEY');
      expect(entry.sample.request + entry.sample.response).not.toMatch(/rcl_live_[A-Za-z0-9]{8,}|sk_(live|test)_/);
      expect(entry.sample.note).toMatch(/^Snapshot/);
      // Only a response actually captured from the live API may be called one.
      if (entry.sample.origin !== 'live-api') expect(entry.sample.note).toContain('not a captured API response');
    }
    expect(JSON.parse(DATASETS.recalls.sample.response).data.recall_number).toBe('H-1275-2026');
    expect(JSON.parse(DATASETS['product-recalls'].sample.response).data.id).toBe('cpsc-25203');
  });

  it('serves the copy script under a CSP that allows only same-origin scripts, and hides copy buttons without it', async () => {
    const env = makeEnv();
    await seed(env);
    const home = await page(env, '/');
    expect(home.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(home.body).toContain('<script src="/assets/site.js" defer></script>');
    expect(home.body).toMatch(/<button type="button" class="copy" data-copy="[a-z-]+" hidden>/);
    const script = await worker.fetch(site('/assets/site.js'), env);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toContain('navigator.clipboard');
  });
});

describe('billing portal', () => {
  it('returns customers to the homepage, which is served whatever either dataset state', async () => {
    const { createPortalSession } = await import('../src/stripe.js');
    const bodies: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/test' }), { status: 200 });
    }) as typeof fetch;
    try {
      const env = makeEnv({ STRIPE_SECRET_KEY: 'sk_test_placeholder', SOURCE_KILL_SWITCH: '1' } as Partial<Env>);
      await createPortalSession(env, 'cus_test');
    } finally {
      globalThis.fetch = original;
    }
    expect(new URLSearchParams(bodies[0]).get('return_url')).toBe('https://data.aroqon.com/');
  });
});
