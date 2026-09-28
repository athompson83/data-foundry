import { beforeEach, describe, expect, it } from 'vitest';

import { ACCEPTANCE_CUSTOMER_PATTERN, runAcceptance, type AcceptanceOptions } from '../scripts/acceptance.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ingestRecords } from '../src/product-sync.js';
import { ndjsonBundle, prepareRecall, rawRef, writeRecallStatements } from '../src/store.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';
import { CPSC, FOOD, HC } from './fixtures.js';

const ADMIN = 'z'.repeat(40);
const CUSTOMER = 'cus_acceptance_internal_20260928';
const NOW = '2026-09-27T12:00:00.000Z';
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

function makeEnv(): Env {
  const { db } = createTestDatabase();
  return { DB: db, RAW_ARTIFACTS: createTestBucket(), PUBLIC_ORIGIN: 'https://data.aroqon.com', API_ORIGIN: 'https://api.data.aroqon.com', PRODUCT_RECALLS_OPEN: '1', ADMIN_TOKEN: ADMIN, CF_VERSION_METADATA: { id: 'ver-1', tag: SHA.slice(0, 12), timestamp: NOW } };
}

async function seed(env: Env): Promise<void> {
  // Four CPSC and four Health Canada notices, so a three-row page has a next page.
  const cpsc = ['25203', '25204', '25205', '25206'].map((number, index) => ({ ...CPSC, RecallNumber: number, RecallID: 10220 + index, URL: `${CPSC.URL}-${number}` }));
  const hc = ['77184', '77185', '77186', '77187'].map((nid) => ({ ...HC, NID: nid, URL: `${HC.URL}-${nid}` }));
  await ingestRecords(env, 'HC', hc, 'full', NOW);
  await ingestRecords(env, 'CPSC', cpsc, 'full', NOW);
  const prepared = [await prepareRecall('food', FOOD), await prepareRecall('food', { ...FOOD, recall_number: 'F-0003-2026' })];
  const bundle = ndjsonBundle(prepared.map((item) => item.raw));
  await env.RAW_ARTIFACTS.put('recalls/test.ndjson', bundle.body);
  for (const [index, item] of prepared.entries()) {
    const range = bundle.ranges[index] as { offset: number; length: number };
    const statements = writeRecallStatements(item, rawRef('recalls/test.ndjson', range.offset, range.length), NOW);
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
  }
  await env.DB.prepare("INSERT INTO customer (id, email, stripe_customer_id, plan, status, created_at, updated_at) VALUES ('acceptance-20260928', 'acceptance-internal@aroqon.invalid', ?, 'developer', 'active', 'now', 'now')").bind(CUSTOMER).run();
}

function options(env: Env, overrides: Partial<AcceptanceOptions> = {}): AcceptanceOptions {
  return { apiOrigin: 'https://api.data.aroqon.com', publicOrigin: 'https://data.aroqon.com', adminToken: ADMIN, stripeCustomerId: CUSTOMER, expectedSha: SHA, fetch: (request) => worker.fetch(request, env), ...overrides };
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

describe('production acceptance script', () => {
  it('passes against the Worker, meters exactly its data requests, and revokes the key it used', async () => {
    const env = makeEnv();
    await seed(env);
    const evidence = await runAcceptance(options(env));
    expect(evidence.checks.filter((check) => !check.ok)).toEqual([]);
    expect(evidence.ok).toBe(true);
    expect(evidence.revocation).toEqual({ revoked: true, active_keys: 0, rejected_after: true });
    expect(evidence.metered_requests).toBeGreaterThanOrEqual(10);
    expect(await env.DB.prepare('SELECT requests FROM usage_month').first()).toEqual({ requests: evidence.metered_requests });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key WHERE revoked_at IS NULL').first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT status FROM customer').first()).toEqual({ status: 'active' });
    // The evidence never carries the key or the admin token.
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toMatch(/rcl_live_[A-Za-z0-9]{32}/);
    expect(serialized).not.toContain(ADMIN);
    // A second run is possible: acceptance is repeatable.
    expect((await runAcceptance(options(env))).ok).toBe(true);
  });

  it('revokes the key even when a check throws midway', async () => {
    const env = makeEnv();
    await seed(env);
    const failing = async (request: Request): Promise<Response> => {
      if (new URL(request.url).searchParams.get('agency') === 'HC') throw new Error('network down');
      return worker.fetch(request, env);
    };
    await expect(runAcceptance(options(env, { fetch: failing }))).rejects.toThrow('network down');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key WHERE revoked_at IS NULL').first()).toEqual({ n: 0 });
  });

  it('fails, and still revokes, when the served data is wrong', async () => {
    const env = makeEnv();
    await seed(env);
    const tampered = async (request: Request): Promise<Response> => {
      const response = await worker.fetch(request, env);
      if (!new URL(request.url).pathname.startsWith('/v1/product-recalls/cpsc-') || response.status !== 200) return response;
      const body = (await response.json()) as { data: { raw: Record<string, unknown> } };
      body.data.raw['Title'] = 'altered';
      return Response.json(body);
    };
    const evidence = await runAcceptance(options(env, { fetch: tampered }));
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.find((check) => check.name.startsWith('record cpsc-'))?.ok).toBe(false);
    expect(evidence.revocation.rejected_after).toBe(true);
  });

  it('refuses any customer that is not an internal acceptance fixture, before issuing a key', async () => {
    const env = makeEnv();
    await seed(env);
    await env.DB.prepare("INSERT INTO customer (id, email, stripe_customer_id, plan, status, created_at, updated_at) VALUES ('real', 'buyer@example.com', 'cus_RealBuyer12345', 'developer', 'active', 'now', 'now')").run();
    expect(ACCEPTANCE_CUSTOMER_PATTERN.test('cus_RealBuyer12345')).toBe(false);
    await expect(runAcceptance(options(env, { stripeCustomerId: 'cus_RealBuyer12345' }))).rejects.toThrow('Refusing');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key').first()).toEqual({ n: 0 });
  });

  it('refuses, before issuing a key, when the live version is not the commit being accepted', async () => {
    const env = makeEnv();
    await seed(env);
    await expect(runAcceptance(options(env, { expectedSha: '1'.repeat(40) }))).rejects.toThrow('is not 111111111111');
    const untagged = { ...env, CF_VERSION_METADATA: { id: 'ver-0', tag: '', timestamp: NOW } };
    await expect(runAcceptance(options(untagged, { fetch: (request) => worker.fetch(request, untagged) }))).rejects.toThrow('tag none');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key').first()).toEqual({ n: 0 });
    const evidence = await runAcceptance(options(env));
    expect(evidence.live_version).toEqual({ version_id: 'ver-1', tag: SHA.slice(0, 12), timestamp: NOW });
    expect(evidence.source_sha).toBe(SHA);
  });

  it('names an inactive fixture instead of failing obscurely, and still revokes', async () => {
    const env = makeEnv();
    await seed(env);
    await env.DB.prepare("UPDATE customer SET status = 'canceled'").run();
    const evidence = await runAcceptance(options(env));
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.find((check) => check.name === 'acceptance fixture is active')).toMatchObject({ ok: false, detail: expect.stringContaining('status=canceled') });
    expect(evidence.checks.some((check) => check.name.startsWith('CPSC'))).toBe(false);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key WHERE revoked_at IS NULL').first()).toEqual({ n: 0 });
  });

  it('fails when the serving version changes during the run', async () => {
    const env = makeEnv();
    await seed(env);
    let reads = 0;
    const redeployed = async (request: Request): Promise<Response> => {
      if (new URL(request.url).pathname === '/admin/version' && ++reads > 1) {
        return Response.json({ version_id: 'ver-2', tag: SHA.slice(0, 12), timestamp: NOW });
      }
      return worker.fetch(request, env);
    };
    const evidence = await runAcceptance(options(env, { fetch: redeployed }));
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.find((check) => check.name === 'live version unchanged for the whole run')?.ok).toBe(false);
  });

  it('fails when no sampled FDA recall has a code to look up', async () => {
    const env = makeEnv();
    await seed(env);
    const uncoded = async (request: Request): Promise<Response> => {
      const response = await worker.fetch(request, env);
      if (new URL(request.url).pathname !== '/v1/recalls' || response.status !== 200) return response;
      const body = (await response.json()) as { data: Array<Record<string, unknown>> };
      for (const row of body.data) row['codes'] = { gtins: [], ndcs: [], lots: [], serial_numbers: [], model_numbers: [], expiration_dates: [] };
      return Response.json(body);
    };
    const evidence = await runAcceptance(options(env, { fetch: uncoded }));
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.find((check) => check.name === 'FDA code lookup returns the recall that lists the code')).toMatchObject({ ok: false });
  });

  it('revokes by customer id when the reissue response is lost after the key was created', async () => {
    const env = makeEnv();
    await seed(env);
    const lossy = async (request: Request): Promise<Response> => {
      const response = await worker.fetch(request, env);
      if (new URL(request.url).pathname === '/admin/reissue-key') throw new Error('connection reset');
      return response;
    };
    await expect(runAcceptance(options(env, { fetch: lossy }))).rejects.toThrow('connection reset');
    // The Worker created a key, the script never saw it, and it is revoked anyway.
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key').first()).toEqual({ n: 1 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key WHERE revoked_at IS NULL').first()).toEqual({ n: 0 });
  });

  it('issues nothing when the admin token is wrong', async () => {
    const env = makeEnv();
    await seed(env);
    // The version check needs the operator token too, so nothing is issued.
    await expect(runAcceptance(options(env, { adminToken: 'y'.repeat(40) }))).rejects.toThrow('Refusing');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM api_key').first()).toEqual({ n: 0 });
  });
});
