/**
 * Extraction intake (ADR-0017): the server re-decides every candidate against the stored evidence,
 * whatever the collector claims, and publishes nothing until the quality gate is open.
 */

import { describe, expect, it } from 'vitest';

import { issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { MAX_INTAKE_BYTES } from '../src/intake.js';
import { ingestRecords } from '../src/product-sync.js';
import { sha256Hex } from '../src/store.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';

// A verbatim CPSC Recall API record shape (Hoppe's bore cleaner, recall 15-034), reduced to the fields the parser reads.
const CPSC = {
  RecallID: 6500,
  RecallNumber: '15034',
  RecallDate: '2014-11-19T00:00:00',
  Title: "Hoppe's Recalls Semi-Auto Bore Cleaner Due to Failure to Meet Child-Resistant Closure Requirement",
  Description:
    "This recall involves Hoppe's Semi-Auto Gun Bore Cleaner. This product is packaged in a brown 5-ounce plastic bottle with a blue and yellow label and black cap. The recalled item number is SA904 and can be found above the UPC code on the label. Lot 44871 is not affected. Model HB-22 kits are also included.",
  URL: 'https://www.cpsc.gov/Recalls/2015/Hoppes-Recalls-Semi-Auto-Bore-Cleaner',
  ConsumerContact: "Hoppe's toll-free at 800-221-9035",
  LastPublishDate: '2014-11-19T00:00:00',
  Products: [{ Name: "Hoppe's Semi-Auto Gun Bore Cleaner", Description: '', Model: '', Type: 'Cleaning products', CategoryID: '', NumberOfUnits: 'About 3,400' }],
  Inconjunctions: [],
  Images: [],
  Injuries: [],
  Manufacturers: [],
  Retailers: [],
  Importers: [],
  Distributors: [],
  SoldAtLabel: null,
  ManufacturerCountries: [],
  ProductUPCs: [],
  Hazards: [{ Name: 'The packaging is not child resistant, posing a risk of poisoning.', HazardType: '', HazardTypeID: '' }],
  Remedies: [{ Name: 'Consumers should immediately store the product out of reach of children.' }],
  RemedyOptions: [{ Option: 'Replace' }],
};

const ADMIN = 'a'.repeat(40);
const NOW = '2026-09-28T12:00:00.000Z';
const EXTRACTOR = { version: 'cpsc-product-identifiers@1/prompt-3', model: 'qwen3.5:4b', model_digest: 'sha256:2a654d98e6fb', prompt_sha256: 'b'.repeat(64) };

function makeEnv(overrides: Partial<Env> = {}): Env {
  const { db } = createTestDatabase();
  return { DB: db, RAW_ARTIFACTS: createTestBucket(), PUBLIC_ORIGIN: 'https://data.aroqon.com', API_ORIGIN: 'https://api.data.aroqon.com', PRODUCT_RECALLS_OPEN: '1', COLLECTOR_INTAKE_OPEN: '1', ADMIN_TOKEN: ADMIN, ...overrides };
}

async function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://api.data.aroqon.com${path}`, init), env);
}

async function mint(env: Env, sources = 'cpsc-recalls'): Promise<{ id: string; token: string }> {
  const response = await call(env, `/admin/ingest-credentials?label=local-collector&sources=${sources}`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; token: string };
}

async function rawSha(env: Env, id = 'cpsc-15034'): Promise<string> {
  return ((await env.DB.prepare('SELECT raw_sha256 FROM product_recall WHERE id = ?').bind(id).first<{ raw_sha256: string }>()) as { raw_sha256: string }).raw_sha256;
}

let counter = 0;
async function submit(env: Env, token: string, notices: unknown[], idempotencyKey?: string): Promise<Response> {
  const body = JSON.stringify({ task: 'cpsc-product-identifiers@1', extractor: EXTRACTOR, notices });
  return call(env, '/v1/intake/product-recalls/identifiers', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey ?? (await sha256Hex(`${counter++}`)) },
    body,
  });
}

async function customerKey(env: Env): Promise<string> {
  await env.DB.prepare("INSERT INTO customer (id, email, plan, status, created_at, updated_at) VALUES ('c1', 'a@example.com', 'developer', 'active', 'now', 'now')").run();
  return issueKey(env.DB, 'c1', null);
}

async function seeded(overrides: Partial<Env> = {}): Promise<{ env: Env; token: string; sha: string }> {
  const env = makeEnv(overrides);
  await ingestRecords(env, 'CPSC', [CPSC], 'full', NOW);
  const { token } = await mint(env);
  return { env, token, sha: await rawSha(env) };
}

const CANDIDATES = [
  { value: 'SA904', field: 'Description', label: 'item' },
  { value: 'HB-22', field: 'Description', label: 'model' },
  { value: '44871', field: 'Description', label: 'item' },
  { value: 'SA905', field: 'Description', label: 'item' },
  { value: 'SA904', field: 'ConsumerContact', label: 'item' },
];

describe('extraction intake', () => {
  it('is closed unless COLLECTOR_INTAKE_OPEN is "1"', async () => {
    const { env, token, sha } = await seeded();
    const closed = { ...env, COLLECTOR_INTAKE_OPEN: '0' };
    const response = await submit(closed, token, [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: CANDIDATES }]);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('intake_closed');
  });

  it('accepts only an ingestion credential: customer keys, the admin token and revoked credentials are refused', async () => {
    const { env, sha } = await seeded();
    const notices = [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: CANDIDATES }];
    expect((await submit(env, await customerKey(env), notices)).status).toBe(401);
    expect((await submit(env, ADMIN, notices)).status).toBe(401);
    const second = await mint(env);
    expect((await call(env, `/admin/ingest-credentials/revoke?id=${second.id}`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
    expect((await submit(env, second.token, notices)).status).toBe(401);
    // Minting needs the admin token.
    expect((await call(env, '/admin/ingest-credentials?label=x&sources=cpsc-recalls', { method: 'POST' })).status).toBe(404);
  });

  it('re-decides every candidate against the stored evidence and derives the label itself', async () => {
    const { env, token, sha } = await seeded();
    const response = await submit(env, token, [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: CANDIDATES }]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: number; duplicate_of_agency_fact: number; rejected: number; published: boolean; results: Array<{ candidates: Array<{ value: string; field: string; status: string; reason?: string; label?: string }> }> };
    const byValue = Object.fromEntries(body.results[0]!.candidates.map((candidate) => [`${candidate.value}@${candidate.field}`, candidate]));
    expect(byValue['SA904@Description']).toMatchObject({ status: 'accepted', label: 'item' });
    // HB-22 follows an explicit "Model" label, so the agency parser already indexes it.
    expect(byValue['HB-22@Description']).toMatchObject({ status: 'duplicate_of_agency_fact' });
    expect(byValue['44871@Description']).toMatchObject({ status: 'rejected', reason: 'non_product_label' });
    expect(byValue['SA905@Description']).toMatchObject({ status: 'rejected', reason: 'not_in_source' });
    expect(byValue['SA904@ConsumerContact']).toMatchObject({ status: 'rejected', reason: 'field_not_allowed' });
    expect(body).toMatchObject({ accepted: 1, duplicate_of_agency_fact: 1, rejected: 3, published: false });
    const stored = await env.DB.prepare('SELECT printed, label, source_field, span_start, span_end, model_digest, status FROM product_recall_extracted_key').all();
    expect(stored.results).toEqual([{ printed: 'SA904', label: 'item', source_field: 'Description', span_start: CPSC.Description.indexOf('SA904'), span_end: CPSC.Description.indexOf('SA904') + 5, model_digest: 'sha256:2a654d98e6fb', status: 'accepted' }]);
  });

  it('is idempotent: a replayed request returns the stored response, and a resubmission creates no duplicate', async () => {
    const { env, token, sha } = await seeded();
    const notices = [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: CANDIDATES }];
    const key = await sha256Hex('batch-1');
    const first = (await (await submit(env, token, notices, key)).json()) as { accepted: number };
    const again = (await (await submit(env, token, notices, key)).json()) as { accepted: number; idempotent_replay?: boolean };
    expect(again).toMatchObject({ accepted: first.accepted, idempotent_replay: true });
    const resubmitted = (await (await submit(env, token, notices)).json()) as { accepted: number; replayed: number };
    expect(resubmitted).toMatchObject({ accepted: 0, replayed: 1 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM product_recall_extracted_key').first<{ n: number }>();
    expect(count?.n).toBe(1);
    const submissions = await env.DB.prepare('SELECT COUNT(*) AS n FROM extraction_submission').first<{ n: number }>();
    expect(submissions?.n).toBe(2);
  });

  it('refuses candidates computed on other bytes, unknown notices and sources the credential does not list', async () => {
    const { env, token } = await seeded();
    const body = (await (await submit(env, token, [
      { recall_id: 'cpsc-15034', raw_sha256: 'c'.repeat(64), candidates: [CANDIDATES[0]] },
      { recall_id: 'cpsc-99999', raw_sha256: 'c'.repeat(64), candidates: [CANDIDATES[0]] },
      { recall_id: 'hc-77184', raw_sha256: 'c'.repeat(64), candidates: [CANDIDATES[0]] },
    ])).json()) as { accepted: number; results: Array<{ status: string }> };
    expect(body.accepted).toBe(0);
    expect(body.results.map((result) => result.status)).toEqual(['stale_source', 'unknown_notice', 'source_not_allowed']);
  });

  it('refuses after policy withdrawal: a withdrawn source, and the dataset kill switch', async () => {
    const { env, token, sha } = await seeded();
    const notices = [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: [CANDIDATES[0]] }];
    const withdrawn = (await (await submit({ ...env, INTAKE_WITHDRAWN_SOURCES: 'cpsc-recalls' }, token, notices)).json()) as { accepted: number; results: Array<{ status: string }> };
    expect(withdrawn).toMatchObject({ accepted: 0, results: [{ status: 'source_not_allowed' }] });
    const killed = await submit({ ...env, PRODUCT_RECALLS_KILL_SWITCH: '1' }, token, notices);
    expect(killed.status).toBe(503);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM product_recall_extracted_key').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('rejects malformed and oversized bodies', async () => {
    const { env, token, sha } = await seeded();
    expect((await submit(env, token, [])).status).toBe(400);
    const cloud = await call(env, '/v1/intake/product-recalls/identifiers', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'd'.repeat(64) },
      body: JSON.stringify({ task: 'cpsc-product-identifiers@1', extractor: { ...EXTRACTOR, model: 'gpt-oss:120b-cloud' }, notices: [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: [] }] }),
    });
    expect(cloud.status).toBe(400);
    const big = await call(env, '/v1/intake/product-recalls/identifiers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'e'.repeat(64) }, body: 'x'.repeat(MAX_INTAKE_BYTES + 1) });
    expect(big.status).toBe(413);
    const noKey = await call(env, '/v1/intake/product-recalls/identifiers', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    expect(noKey.status).toBe(400);
  });
});

describe('publication of extracted identifiers', () => {
  async function accepted(overrides: Partial<Env> = {}): Promise<{ env: Env; apiKey: string }> {
    const { env, token, sha } = await seeded(overrides);
    await submit(env, token, [{ recall_id: 'cpsc-15034', raw_sha256: sha, candidates: [CANDIDATES[0]] }]);
    return { env, apiKey: await customerKey(env) };
  }
  const get = (env: Env, apiKey: string, path: string) => call(env, path, { headers: { authorization: `Bearer ${apiKey}` } });

  it('serves nothing while the quality gate is closed', async () => {
    const { env, apiKey } = await accepted();
    const notice = (await (await get(env, apiKey, '/v1/product-recalls/cpsc-15034')).json()) as { data: Record<string, unknown> };
    expect(notice.data).not.toHaveProperty('extracted_identifiers');
    const lookup = (await (await get(env, apiKey, '/v1/product-recalls/lookup?code=SA904')).json()) as { total_matches: number };
    expect(lookup.total_matches).toBe(0);
  });

  it('serves accepted identifiers, labelled and with lineage, and matches them in lookup when open', async () => {
    const { env, apiKey } = await accepted({ EXTRACTED_IDENTIFIERS_OPEN: '1' });
    const notice = (await (await get(env, apiKey, '/v1/product-recalls/cpsc-15034')).json()) as { data: { identifiers: { model_numbers: string[] }; extracted_identifiers: Array<Record<string, unknown>> } };
    expect(notice.data.identifiers.model_numbers).toEqual(['HB-22']);
    expect(notice.data.extracted_identifiers).toEqual([
      expect.objectContaining({ value: 'SA904', key: 'SA904', label: 'item', method: 'local-model-proposal+deterministic-verification', source_field: 'Description', model: 'qwen3.5:4b', model_digest: 'sha256:2a654d98e6fb' }),
    ]);
    const lookup = (await (await get(env, apiKey, '/v1/product-recalls/lookup?code=sa-904')).json()) as { total_matches: number; data: Array<{ matched_on: unknown[]; recall: { id: string } }> };
    expect(lookup.total_matches).toBe(1);
    expect(lookup.data[0]).toMatchObject({ matched_on: [{ kind: 'extracted_model', value: 'SA904' }], recall: { id: 'cpsc-15034' } });
    // An agency-parsed model still resolves once, through the key index.
    const agency = (await (await get(env, apiKey, '/v1/product-recalls/lookup?code=HB-22')).json()) as { total_matches: number; data: Array<{ matched_on: unknown[] }> };
    expect(agency).toMatchObject({ total_matches: 1, data: [{ matched_on: [{ kind: 'model', value: 'HB22' }] }] });
  });

  it('stops serving a candidate when the source bytes change, and after withdrawal', async () => {
    const { env, apiKey } = await accepted({ EXTRACTED_IDENTIFIERS_OPEN: '1' });
    const withdrawn = await call(env, '/admin/extractions/withdraw?extractor_version=cpsc-product-identifiers@1/prompt-3', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(await withdrawn.json()).toEqual({ withdrawn: 1 });
    let notice = (await (await get(env, apiKey, '/v1/product-recalls/cpsc-15034')).json()) as { data: { extracted_identifiers: unknown[] } };
    expect(notice.data.extracted_identifiers).toEqual([]);
    // The row is kept for audit.
    expect(await env.DB.prepare("SELECT status FROM product_recall_extracted_key").first()).toEqual({ status: 'withdrawn' });

    const fresh = await accepted({ EXTRACTED_IDENTIFIERS_OPEN: '1' });
    await ingestRecords(fresh.env, 'CPSC', [{ ...CPSC, Description: `${CPSC.Description} Updated.` }], 'full', '2026-09-29T00:00:00.000Z');
    notice = (await (await get(fresh.env, fresh.apiKey, '/v1/product-recalls/cpsc-15034')).json()) as { data: { extracted_identifiers: unknown[] } };
    expect(notice.data.extracted_identifiers).toEqual([]);
  });
});
