import { beforeEach, describe, expect, it } from 'vitest';

import { currentUsage, issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

const NOW = '2026-10-16T08:00:00.000Z';
const BEFORE = '2026-10-16T06:00:00.000Z';
type State = { last_successful_sync: string | null; latest_attempt: null | {
  status: string; started_at: string; finished_at: string | null; window_from: string; window_to: string;
} };
type Stats = { source_sync: Record<string, State>; last_successful_sync: unknown };
const request = (path: string, headers?: Record<string, string>) => new Request(`https://api.data.aroqon.com${path}`, headers ? { headers } : {});
function env(): Env {
  return { DB: createTestDatabase().db, RAW_ARTIFACTS: createTestBucket(), PRODUCT_RECALLS_OPEN: '1' };
}
async function run(e: Env, category: string, status: string, at = NOW, window = 'full'): Promise<void> {
  await e.DB.prepare('INSERT INTO sync_run (category, window_from, window_to, started_at, finished_at, status, error, artifact_keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(category, window, '2026-10-16', at, status === 'RUNNING' ? null : at, status, 'private upstream error', '["private/raw-key"]')
    .run();
}

beforeEach(() => {
  const responses = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = { default: {
    match: async (req: Request) => responses.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void responses.set(req.url, res),
  } };
});

describe('public source sync visibility', () => {
  it('shows a newer FDA failure without advancing its successful refresh clock', async () => {
    const e = env();
    await run(e, 'food', 'SUCCEEDED', BEFORE, '2026-09-01');
    await run(e, 'food', 'FAILED', NOW, '2026-09-01');
    await run(e, 'product:CPSC', 'SUCCEEDED');
    const response = await worker.fetch(request('/v1/recalls/stats'), e);
    const body = await response.json() as Stats;
    expect(body.last_successful_sync).toBe(BEFORE);
    expect(body.source_sync['food']).toEqual({ last_successful_sync: BEFORE, latest_attempt: {
      status: 'FAILED', started_at: NOW, finished_at: NOW, window_from: '2026-09-01', window_to: '2026-10-16',
    } });
    expect(Object.keys(body.source_sync)).toEqual(['food', 'drug', 'device']);
    expect(JSON.stringify(body)).not.toMatch(/private|artifact_keys|"error"|"id"/);
    expect(response.headers.get('cache-control')).toBe('public, max-age=600');
  });

  it('uses only completed agency passes for product success, never successful subwindows', async () => {
    const e = env();
    await run(e, 'product:CPSC', 'SUCCEEDED', BEFORE);
    await run(e, 'product:CPSC', 'FAILED');
    await run(e, 'product-window:CPSC', 'SUCCEEDED');
    await run(e, 'product:unknown', 'SUCCEEDED');
    const body = await (await worker.fetch(request('/v1/product-recalls/stats'), e)).json() as Stats;
    expect(body.source_sync['CPSC']).toMatchObject({ last_successful_sync: BEFORE, latest_attempt: { status: 'FAILED' } });
    expect(Object.keys(body.source_sync)).toEqual(['CPSC', 'HC']);
    expect(body.last_successful_sync).toMatchObject({ CPSC: BEFORE });
    expect(body.source_sync['HC']).toEqual({ last_successful_sync: null, latest_attempt: null });
  });

  it('reports a running pass and resolves equal start clocks by the durable run order', async () => {
    const e = env();
    await run(e, 'product:HC', 'FAILED');
    await run(e, 'product:HC', 'RUNNING');
    const body = await (await worker.fetch(request('/v1/product-recalls/stats'), e)).json() as Stats;
    expect(body.source_sync['HC']).toEqual({ last_successful_sync: null, latest_attempt: {
      status: 'RUNNING', started_at: NOW, finished_at: null, window_from: 'full', window_to: '2026-10-16',
    } });
  });

  it('keeps never-run sources explicit without inventing a successful refresh', async () => {
    const e = env();
    const body = await (await worker.fetch(request('/v1/recalls/stats'), e)).json() as Stats;
    expect(body.last_successful_sync).toBeNull();
    expect(body.source_sync).toEqual(Object.fromEntries(['food', 'drug', 'device'].map((name) => [name, { last_successful_sync: null, latest_attempt: null }])));
  });

  it('shares the channel payload and cached reads without consuming direct allowance', async () => {
    const e = { ...env(), RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: 'p'.repeat(48) };
    await e.DB.prepare("INSERT INTO customer (id, plan, status, created_at, updated_at) VALUES ('stats', 'evaluate', 'active', 'now', 'now')").run();
    const key = await issueKey(e.DB, 'stats', null);
    await run(e, 'product:HC', 'SUCCEEDED');
    const path = '/v1/product-recalls/stats';
    const direct = await worker.fetch(request(path, { authorization: `Bearer ${key}` }), e);
    const gateway = await worker.fetch(request(path, { 'x-rapidapi-proxy-secret': e.RAPIDAPI_PROXY_SECRET, 'x-rapidapi-user': 'subscriber' }), e);
    expect(gateway.status).toBe(200);
    expect(await gateway.json()).toEqual(await direct.json());
    expect(await currentUsage(e.DB, 'stats')).toBe(0);
    const withdrawn = await worker.fetch(request(path), { ...e, PRODUCT_RECALLS_KILL_SWITCH: '1' });
    expect(withdrawn.status).toBe(503);
    expect((await worker.fetch(request(path, { 'x-rapidapi-user': 'subscriber' }), e)).status).toBe(401);
  });

  it.each(['', '?channel=rapidapi'])('types the complete stats and source-attempt contracts: %s', async (query) => {
    const doc = await (await worker.fetch(request('/openapi.json' + query), env())).json() as {
      paths: Record<string, { get: { responses: Record<string, { content: { 'application/json': { schema: { properties: Record<string, unknown>; required: string[] } } } }> } }>;
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    for (const path of ['/v1/recalls/stats', '/v1/product-recalls/stats']) {
      const schema = doc.paths[path]!.get.responses['200']!.content['application/json'].schema;
      expect(schema.required).toContain('source_sync');
      expect(schema.properties).toHaveProperty('last_successful_sync');
      expect(schema.properties).toHaveProperty('attribution');
    }
    expect(doc.components.schemas['SourceSync']).toMatchObject({ properties: { latest_attempt: { anyOf: [
      { type: 'null' }, { type: 'object', properties: { status: { enum: ['RUNNING', 'SUCCEEDED', 'FAILED'] } } },
    ] } } });
  });

  it('isolates cached contracts by Worker version while keeping ordinary reads cached', async () => {
    const e = { ...env(), CF_VERSION_METADATA: { id: 'v1', tag: 'first', timestamp: BEFORE } };
    await run(e, 'food', 'SUCCEEDED', BEFORE);
    const path = '/v1/recalls/stats';
    await worker.fetch(request(path), e);
    await run(e, 'food', 'FAILED');
    const cached = await (await worker.fetch(request(path), e)).json() as Stats;
    expect(cached.source_sync['food']!.latest_attempt!.status).toBe('SUCCEEDED');
    const fresh = await (await worker.fetch(request(path), { ...e, CF_VERSION_METADATA: { ...e.CF_VERSION_METADATA, id: 'v2' } })).json() as Stats;
    expect(fresh.source_sync['food']!.latest_attempt!.status).toBe('FAILED');
  });

  it('withdraws source-status guidance with its datasets across human and agent references', async () => {
    const e = env();
    for (const path of ['/docs', '/llms-full.txt']) {
      const read = async (gates: Partial<Env>) => (await worker.fetch(new Request('https://data.aroqon.com' + path), { ...e, ...gates })).text();
      expect(await read({})).toContain('source_sync');
      expect(await read({ SOURCE_KILL_SWITCH: '1', PRODUCT_RECALLS_OPEN: '0' })).not.toContain('source_sync');
    }
    const fdaOnly = await (await worker.fetch(new Request('https://data.aroqon.com/docs'), { ...e, PRODUCT_RECALLS_OPEN: '0' })).text();
    expect(fdaOnly).not.toContain('product agency (<code>CPSC</code>');
  });
});
