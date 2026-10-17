import { afterEach, describe, expect, it, vi } from 'vitest';

import { issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

const NOW = '2026-10-16T12:00:00.000Z';
const SECRET = 'rapidapi-proxy-secret-0123456789';
const dataPaths = ['/v1/recalls', '/v1/product-recalls', '/v1/lookup?code=AC2601'];
const request = (path: string, key?: string, extra: Record<string, string> = {}) => new Request(`https://api.data.aroqon.com${path}`, {
  headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra },
});

async function fixture(spent = false): Promise<{ env: Env; key: string }> {
  const env: Env = { DB: createTestDatabase().db, RAW_ARTIFACTS: createTestBucket(), PRODUCT_RECALLS_OPEN: '1', RAPIDAPI_ENABLED: '1', RAPIDAPI_PROXY_SECRET: SECRET };
  await env.DB.prepare("INSERT INTO customer (id, plan, status, created_at, updated_at) VALUES ('quota', 'evaluate', 'active', 'now', 'now')").run();
  if (spent) await env.DB.prepare("INSERT INTO usage_month (customer_id,month,requests) VALUES ('quota',?,100)").bind(`${new Date().toISOString().slice(0, 7)}-01`).run();
  return { env, key: await issueKey(env.DB, 'quota', null) };
}

afterEach(() => vi.useRealTimers());

describe('direct monthly quota reset', () => {
  it.each([
    ['2026-10-16T12:00:00.000Z', '2026-11-01T00:00:00.000Z', 1_339_200],
    ['2027-02-28T00:00:00.000Z', '2027-03-01T00:00:00.000Z', 86_400],
    ['2028-02-28T00:00:00.000Z', '2028-03-01T00:00:00.000Z', 172_800],
    ['2026-12-31T23:59:59.250Z', '2027-01-01T00:00:00.000Z', 1],
  ])('tells an exhausted client when to retry at %s without changing usage', async (now, reset, seconds) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const { env, key } = await fixture(true);
    const response = await worker.fetch(request('/v1/recalls', key), env);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe(String(seconds));
    expect(response.headers.get('x-ratelimit-reset')).toBe(String(Date.parse(reset) / 1000));
    expect(response.headers.get('x-ratelimit-limit')).toBe('100');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('access-control-expose-headers')).toContain('retry-after');
    expect(await response.json()).toMatchObject({ error: { code: 'allowance_exhausted' } });
    expect(await env.DB.prepare('SELECT requests FROM usage_month').first()).toEqual({ requests: 100 });
  });

  it.each(dataPaths)('exposes reset headers to browser clients on %s, without charging account reads', async (path) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, key } = await fixture();
    const response = await worker.fetch(request(path, key), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-reset')).toBe(String(Date.parse('2026-11-01T00:00:00Z') / 1000));
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99');
    expect(response.headers.get('retry-after')).toBeNull();
    expect(response.headers.get('access-control-expose-headers')).toContain('x-ratelimit-reset');
    const account = await worker.fetch(request('/v1/account', key), env);
    expect(account.status).toBe(200);
    expect(account.headers.get('x-ratelimit-reset')).toBeNull();
    expect(await account.json()).toMatchObject({ month_requests: 1 });
  });

  it('resets the ledger at the UTC year boundary and reports the new month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-12-31T23:59:59.999Z');
    const { env, key } = await fixture(true);
    expect((await worker.fetch(request('/v1/recalls', key), env)).status).toBe(429);
    vi.setSystemTime('2027-01-01T00:00:00.000Z');
    const response = await worker.fetch(request('/v1/recalls', key), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ratelimit-reset')).toBe(String(Date.parse('2027-02-01T00:00:00Z') / 1000));
    expect(response.headers.get('x-ratelimit-remaining')).toBe('99');
    expect(response.headers.get('retry-after')).toBeNull();
    expect((await env.DB.prepare('SELECT month,requests FROM usage_month ORDER BY month').all()).results).toEqual([
      { month: '2026-12-01', requests: 100 }, { month: '2027-01-01', requests: 1 },
    ]);
  });

  it('keeps marketplace responses separate even when the presented direct key is exhausted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { env, key } = await fixture(true);
    const response = await worker.fetch(request('/v1/recalls', key, { 'x-rapidapi-proxy-secret': SECRET, 'x-rapidapi-user': 'quota-fixture', 'x-rapidapi-subscription': 'BASIC' }), env);
    expect(response.status).toBe(200);
    for (const header of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) expect(response.headers.get(header)).toBeNull();
    expect(await env.DB.prepare('SELECT requests FROM usage_month').first()).toEqual({ requests: 100 });
  });

  it('documents all seven metered direct operations without assigning direct reset headers to free/account/marketplace calls', async () => {
    const { env } = await fixture();
    type Contract = { paths: Record<string, { get?: { responses: Record<string, { headers?: Record<string, unknown> }> } }> };
    const direct = await (await worker.fetch(request('/openapi.json'), env)).json() as Contract;
    const metered = Object.entries(direct.paths).filter(([path, item]) => !path.startsWith('/v1/account') && item.get?.responses['429']);
    expect(metered).toHaveLength(7);
    for (const [, item] of metered) {
      expect(item.get?.responses['200']?.headers).toHaveProperty('X-RateLimit-Reset');
      expect(item.get?.responses['429']?.headers).toHaveProperty('Retry-After');
    }
    for (const path of ['/v1/datasets', '/v1/recalls/stats', '/v1/product-recalls/stats', '/v1/account']) expect(direct.paths[path]?.get?.responses['200']?.headers).toBeUndefined();
    const marketplace = await (await worker.fetch(request('/openapi.json?channel=rapidapi'), env)).json();
    expect(JSON.stringify(marketplace)).not.toContain('X-RateLimit-Reset');
    expect(JSON.stringify(marketplace)).not.toContain('Retry-After');
  });
});
