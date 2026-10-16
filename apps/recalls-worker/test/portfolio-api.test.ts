import { describe, expect, it } from 'vitest';

import { currentUsage, issueKey, PLANS } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ingestRecords } from '../src/product-sync.js';
import { ndjsonBundle, prepareRecall, rawRef, writeRecallStatements } from '../src/store.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';
import { CPSC, FOOD, HC } from './fixtures.js';

function env(overrides: Partial<Env> = {}): Env {
  return { DB: createTestDatabase().db, RAW_ARTIFACTS: createTestBucket(), PRODUCT_RECALLS_OPEN: '1', ...overrides };
}

const request = (path: string, key?: string, init: RequestInit = {}): Request => new Request(`https://api.data.aroqon.com${path}`, {
  ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...init.headers },
});

async function seed(e: Env): Promise<string> {
  await ingestRecords(e, 'HC', [HC], 'full', '2026-10-15T00:00:00Z');
  await ingestRecords(e, 'CPSC', [CPSC], 'full', '2026-10-15T00:00:00Z');
  const item = await prepareRecall('food', FOOD);
  const bundle = ndjsonBundle([item.raw]);
  await e.RAW_ARTIFACTS.put('recalls/test.ndjson', bundle.body);
  const range = bundle.ranges[0]!;
  await e.DB.batch(writeRecallStatements(item, rawRef('recalls/test.ndjson', range.offset, range.length), '2026-10-15T00:00:00Z').map((s) => e.DB.prepare(s.sql).bind(...s.params)));
  await e.DB.prepare("INSERT INTO customer (id, plan, status, created_at, updated_at) VALUES ('portfolio', 'evaluate', 'active', 'now', 'now')").run();
  return issueKey(e.DB, 'portfolio', null);
}

describe('portfolio APIs', () => {
  it('lists the published catalog without a key, database reads, or usage charges', async () => {
    const e = env({ DB: { prepare: () => { throw new Error('discovery must not read the database'); } } as unknown as Env['DB'] });
    const response = await worker.fetch(request('/v1/datasets'), e);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    expect(body.data.map((d) => d['id'])).toEqual(['recalls', 'product-recalls']);
    expect(body.data[1]).toMatchObject({ documentation_url: 'https://data.aroqon.com/docs#product-recalls', stats_url: 'https://api.data.aroqon.com/v1/product-recalls/stats' });
    expect(body.data.every((d) => Array.isArray(d['sources']) && Array.isArray(d['fields']) && Array.isArray(d['limitations']))).toBe(true);
  });

  it.each([
    [{ SOURCE_KILL_SWITCH: '1' }, ['product-recalls']],
    [{ PRODUCT_RECALLS_KILL_SWITCH: '1' }, ['recalls']],
    [{ PRODUCT_RECALLS_OPEN: '0' }, ['recalls']],
    [{ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' }, []],
  ] as const)('withdraws gated datasets from discovery: %j', async (gates, ids) => {
    const response = await worker.fetch(request('/v1/datasets'), env(gates));
    expect((await response.json() as { data: Array<{ id: string }> }).data.map((d) => d.id)).toEqual(ids);
  });

  it.each(['012345678905', 'DXH70CFAVX'])('returns the existing lookup payloads with separate attribution and one usage unit: %s', async (code) => {
    const e = env();
    const key = await seed(e);
    const response = await worker.fetch(request(`/v1/lookup?code=${code}&include=raw`, key), e);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await currentUsage(e.DB, 'portfolio')).toBe(1);
    const body = await response.json() as { results: Array<Record<string, unknown>>; truncated: boolean; coverage_note: string };
    expect(body.results.map((r) => r['dataset'])).toEqual(['recalls', 'product-recalls']);
    for (const result of body.results) {
      const { dataset, ...payload } = result;
      const original = await worker.fetch(request(`/v1/${dataset}/lookup?code=${code}&include=raw`, key), e);
      expect(payload).toEqual(await original.json());
    }
    expect(body.results.some((r) => (r['data'] as unknown[]).length > 0)).toBe(true);
    expect(body.coverage_note).toMatch(/does not prove/i);
    expect(body.truncated).toBe(false);
  });

  it('fails closed for any unavailable requested dataset without charging; an explicit available subset works', async () => {
    const e = env({ SOURCE_KILL_SWITCH: '1' });
    const key = await seed(e);
    expect((await worker.fetch(request('/v1/lookup?code=DXH70CFAVX', key), e)).status).toBe(503);
    expect(await currentUsage(e.DB, 'portfolio')).toBe(0);
    const subset = await worker.fetch(request('/v1/lookup?code=DXH70CFAVX&datasets=product-recalls', key), e);
    expect(subset.status).toBe(200);
    expect((await subset.json() as { results: Array<{ dataset: string }> }).results.map((r) => r.dataset)).toEqual(['product-recalls']);
    expect(await currentUsage(e.DB, 'portfolio')).toBe(1);
    expect((await worker.fetch(request('/v1/lookup?code=AC2601', key), { ...e, SOURCE_KILL_SWITCH: '0', PRODUCT_RECALLS_OPEN: '0' })).status).toBe(503);
  });

  it.each(['', '?code=', '?code=!!!', '?code=a&datasets=product-recalls', '?code=' + 'a'.repeat(65), '?code=abc&datasets=unknown', '?code=abc&datasets=', '?code=abc&datasets=recalls,recalls', '?code=abc&include=wrong', '?code=abc&code=def', '?code=abc&dataset=recalls'])('rejects invalid or ambiguous inputs before metering: %s', async (query) => {
    const e = env();
    const key = await seed(e);
    expect((await worker.fetch(request(`/v1/lookup${query}`, key), e)).status).toBe(400);
    expect(await currentUsage(e.DB, 'portfolio')).toBe(0);
  });

  it('requires a valid active key and preserves the monthly hard stop and GET-only contract', async () => {
    const e = env();
    const key = await seed(e);
    const path = '/v1/lookup?code=AC2601';
    expect((await worker.fetch(request(path), e)).status).toBe(401);
    expect((await worker.fetch(request(path, 'rcl_live_' + 'x'.repeat(32)), e)).status).toBe(401);
    expect((await worker.fetch(request(path, key, { method: 'POST' }), e)).status).toBe(405);
    expect((await worker.fetch(request('/v1/datasets', undefined, { method: 'POST' }), e)).status).toBe(405);
    await e.DB.prepare("UPDATE customer SET status = 'suspended'").run();
    expect((await worker.fetch(request(path, key), e)).status).toBe(403);
    await e.DB.prepare("UPDATE customer SET status = 'active'").run();
    await e.DB.prepare("INSERT INTO usage_month (customer_id, month, requests) VALUES ('portfolio', ?, ?)").bind(new Date().toISOString().slice(0, 7) + '-01', PLANS.evaluate.requests).run();
    expect((await worker.fetch(request(path, key), e)).status).toBe(429);
    expect(await currentUsage(e.DB, 'portfolio')).toBe(100);
  });

  it('uses gateway authentication and leaves direct allowances untouched on RapidAPI', async () => {
    const e = env({ RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: 'secret-for-test-portfolio' });
    const key = await seed(e);
    const headers = { 'x-rapidapi-proxy-secret': e.RAPIDAPI_PROXY_SECRET!, 'x-rapidapi-user': 'portfolio-test', 'x-rapidapi-subscription': 'BASIC' };
    const response = await worker.fetch(request('/v1/lookup?code=DXH70CFAVX', undefined, { headers }), e);
    expect(response.status).toBe(200);
    expect(await currentUsage(e.DB, 'portfolio')).toBe(0);
    expect((await worker.fetch(request('/v1/lookup?code=DXH70CFAVX', key, { headers: { ...headers, 'x-rapidapi-proxy-secret': 'wrong' } }), e)).status).toBe(401);
  });

  it('reports truncation and exact per-dataset totals, with each existing raw response limit', async () => {
    const e = env();
    const key = await seed(e);
    const items = await Promise.all(Array.from({ length: 101 }, (_, i) => prepareRecall('food', { ...FOOD, recall_number: `F-${String(i + 10).padStart(4, '0')}-2026` })));
    const bundle = ndjsonBundle(items.map((item) => item.raw));
    await e.RAW_ARTIFACTS.put('recalls/many.ndjson', bundle.body);
    for (const [i, item] of items.entries()) {
      const range = bundle.ranges[i]!;
      await e.DB.batch(writeRecallStatements(item, rawRef('recalls/many.ndjson', range.offset, range.length), '2026-10-15T00:00:00Z').map((s) => e.DB.prepare(s.sql).bind(...s.params)));
    }
    for (const include of ['', '&include=raw']) {
      const response = await worker.fetch(request('/v1/lookup?code=AC2601' + include, key), e);
      expect(response.status).toBe(200);
      const body = await response.json() as { truncated: boolean; results: Array<{ dataset: string; data: unknown[]; total_matches: number; truncated: boolean }> };
      expect(body.truncated).toBe(true);
      expect(body.results[0]).toMatchObject({ dataset: 'recalls', total_matches: 102, truncated: true });
      expect(body.results[0]!.data).toHaveLength(include ? 10 : 100);
      expect(body.results[1]).toMatchObject({ dataset: 'product-recalls', data: [], total_matches: 0, truncated: false });
    }
  });

  it('returns an integrity error instead of partial success when raw evidence fails verification', async () => {
    const e = env();
    const key = await seed(e);
    await e.RAW_ARTIFACTS.put('recalls/test.ndjson', '{}');
    const response = await worker.fetch(request('/v1/lookup?code=AC2601&include=raw', key), e);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal_error', message: expect.any(String) } });
  });

  it.each([
    [{}, true, ['recalls', 'product-recalls']],
    [{ SOURCE_KILL_SWITCH: '1' }, true, ['product-recalls']],
    [{ PRODUCT_RECALLS_OPEN: '0' }, true, ['recalls']],
    [{ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' }, false, []],
  ] as const)('keeps OpenAPI discovery and lookup schemas consistent with gates: %j', async (gates, lookupPresent, ids) => {
    const response = await worker.fetch(request('/openapi.json'), env(gates));
    const doc = await response.json() as { paths: Record<string, { get: { security?: unknown[]; parameters: Array<{ name: string; schema: { items: { enum: string[] } } }> } }>; components: { schemas: Record<string, unknown> } };
    expect(doc.paths['/v1/datasets']!.get.security).toEqual([]);
    expect(!!doc.paths['/v1/lookup']).toBe(lookupPresent);
    if (lookupPresent) expect(doc.paths['/v1/lookup']!.get.parameters.find((p) => p.name === 'datasets')!.schema.items.enum).toEqual(ids);
    for (const match of JSON.stringify(doc).matchAll(/#\/components\/schemas\/([A-Za-z]+)/g)) expect(doc.components.schemas[match[1]!]).toBeDefined();
  });

  it('advertises the new interfaces on the API root, documentation and agent reference with current gates', async () => {
    const e = env();
    const root = await worker.fetch(request('/'), e);
    expect(root.headers.get('cache-control')).toBe('no-cache');
    expect(await root.json()).toMatchObject({ catalog: 'https://api.data.aroqon.com/v1/datasets', lookup: 'https://api.data.aroqon.com/v1/lookup' });
    const closed = { ...e, SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' };
    expect(await (await worker.fetch(request('/'), closed)).json()).not.toHaveProperty('lookup');
    for (const path of ['/docs', '/llms.txt', '/llms-full.txt']) {
      const live = await worker.fetch(new Request('https://data.aroqon.com' + path), e);
      const body = await live.text();
      expect(body).toContain('/v1/datasets');
      expect(body).toContain('/v1/lookup?code=');
      const withdrawn = await worker.fetch(new Request('https://data.aroqon.com' + path), closed);
      expect(await withdrawn.text()).not.toContain('/v1/lookup?code=');
    }
  });
});
