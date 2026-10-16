import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueKey } from '../src/account.js';
import type { Env } from '../src/env.js';
import worker from '../src/index.js';
import { ingestRecords } from '../src/product-sync.js';
import { lookupProductCode } from '../src/product-api.js';
import { csvCell, parseInventory, reportCsv, screenInventory } from '../src/screening.js';
import { printableReport, SCREENING_JS } from '../src/screening-page.js';
import { expireScreeningReports } from '../src/screening-routes.js';
import { handleStripeWebhook } from '../src/stripe.js';
import { createTestBucket, createTestDatabase } from './d1-sqlite.js';
import { CPSC, HC } from './fixtures.js';

let env: Env; let key: string; let otherKey: string;
const now = new Date().toISOString();
const csv = 'item,gtin,model\nHeater,089301008588,\nReview heater,,DXH70CFAVX\nUnknown,,ZZUNKNOWN99\nNo label code,,';
const request = (path: string, method = 'GET', input?: unknown, token = key) => worker.fetch(new Request('https://data.aroqon.com' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) }), env);
async function create(tier = 'standard', brand = '') { const response = await request('/screening/reports', 'POST', { csv, tier, brand }); expect(response.status).toBe(201); return response.json() as Promise<{ id: string; result: Awaited<ReturnType<typeof screenInventory>> }>; }
async function freshness() { for (const agency of ['CPSC', 'HC']) await env.DB.prepare("INSERT INTO sync_run (category, window_from, window_to, started_at, finished_at, status) VALUES (?, 'full', 'full', ?, ?, 'SUCCEEDED')").bind('product:' + agency, now, now).run(); }

beforeEach(async () => {
  env = { DB: createTestDatabase().db, RAW_ARTIFACTS: createTestBucket(), PRODUCT_RECALLS_OPEN: '1', SALES_OPEN: '1', SCREENING_SALES_OPEN: '1', STRIPE_SECRET_KEY: 'sk_test_fixture', PUBLIC_ORIGIN: 'https://data.aroqon.com' };
  for (const id of ['one', 'two']) await env.DB.prepare("INSERT INTO customer (id, stripe_customer_id, plan, status, created_at, updated_at) VALUES (?, ?, 'evaluate', 'active', ?, ?)").bind(id, 'cus_' + id, now, now).run();
  key = await issueKey(env.DB, 'one', null); otherKey = await issueKey(env.DB, 'two', null);
  await ingestRecords(env, 'CPSC', [CPSC], 'full', now); await ingestRecords(env, 'HC', [HC], 'full', now); await freshness();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('inventory screening', () => {
  it('parses quoted CSV without losing barcode leading zeros', () => {
    expect(parseInventory('\uFEFFitem,gtin,model\r\n"Box, ""A""",089301008588,')).toEqual([{ item: 'Box, "A"', gtin: '089301008588', model: '' }]);
  });
  it.each(['', '   '])('rejects an empty branded name before reserving or charging (%j)', async brand => {
    const response = await request('/screening/reports', 'POST', { csv, tier: 'branded', brand });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { message: string } }).error.message).toContain('business name');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM screening_report').first()).toEqual({ n: 0 });
  });
  it.each(['item,item\na,b', 'item,unknown\na,b', 'item,gtin\n"broken,1', 'item,gtin\na', 'item\n', 'item\n' + 'a\n'.repeat(51), 'item,model\nBox,' + 'x'.repeat(65)])('rejects malformed or out-of-bounds CSV', value => expect(() => parseInventory(value)).toThrow());
  it('distinguishes four outcomes and retains evidence and remedy information in the free preview', async () => {
    const report = await create();
    expect(report.result.items.map(item => item.outcome)).toEqual(['matched_notice', 'possible_match', 'no_match_in_coverage', 'insufficient_information']);
    expect(report.result.items[0]?.notices[0]).toMatchObject({ id: 'cpsc-25203', remedy: { classes: ['repair', 'new-instructions', 'stop-use'] }, provenance: { raw_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(report.result.coverage_note).toContain('CPSC full-history reconciliation is incomplete');
    expect(JSON.stringify(report.result)).not.toContain('800-964-4328');
  });
  it('will not report a negative when source freshness is missing', async () => {
    await env.DB.prepare('DELETE FROM sync_run').run();
    const report = await create();
    expect(report.result.items[2]?.outcome).toBe('insufficient_information');
    expect(report.result.items[0]?.outcome).toBe('matched_notice');
  });
  it('applies identifier kind before the lookup cap and caches barcode/model fields separately', async () => {
    const code = '089301008588';
    const crowd = Array.from({ length: 101 }, (_, index) => ({ ...CPSC, RecallID: 20000 + index, RecallNumber: String(60000 + index), RecallDate: '2026-01-01T00:00:00',
      URL: CPSC.URL + '-' + index, ProductUPCs: [], Description: 'This recall involves heaters; the model is supplied in the structured product field.', Products: [{ ...CPSC.Products[0]!, Model: code }] }));
    await ingestRecords(env, 'CPSC', crowd, 'full', now);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM product_recall_key WHERE kind = 'model' AND value = ?").bind(code).first()).toEqual({ n: 101 });
    const ambiguous = await lookupProductCode(env.DB, env.RAW_ARTIFACTS, code, false);
    expect(ambiguous['truncated']).toBe(true);
    expect((ambiguous['data'] as Array<{ recall: { id: string } }>).some(match => match.recall.id === 'cpsc-25203')).toBe(false);
    const result = await screenInventory(env, [{ item: 'Barcode', gtin: code, model: '' }, { item: 'Numeric model', gtin: '', model: code }]);
    expect(result.items[0]).toMatchObject({ outcome: 'matched_notice', truncated: false });
    expect(result.items[0]!.notices.some(notice => notice.id === 'cpsc-25203')).toBe(true);
    expect(result.items[1]).toMatchObject({ outcome: 'possible_match', truncated: true });
    expect(result.items[1]!.notices).toHaveLength(100);
    expect(result.items[1]!.notices.every(notice => notice.matched_on.every(on => on.kind === 'model'))).toBe(true);
  });
  it('invalid barcodes do not silently become clear results or model matches', async () => {
    const result = await screenInventory(env, [{ item: 'Bad UPC', gtin: '089301008589', model: '' }]);
    expect(result.items[0]?.outcome).toBe('insufficient_information');
  });
  it('persists and reloads the same snapshot, isolated by account', async () => {
    const report = await create(); const path = '/screening/reports/' + report.id;
    expect((await (await request(path)).json() as { result: unknown }).result).toEqual(report.result);
    expect((await request(path, 'GET', undefined, otherKey)).status).toBe(404);
    expect((await request(path + '/csv', 'GET', undefined, otherKey)).status).toBe(404);
    expect((await request('/screening/reports', 'GET', undefined, otherKey)).headers.get('cache-control')).toBe('private, no-store');
    expect((await request(path + '/csv')).status).toBe(402);
  });
  it('bounds daily preview work atomically and keeps an opaque error', async () => {
    await Promise.all(Array.from({ length: 5 }, () => create()));
    expect((await request('/screening/reports', 'POST', { csv })).status).toBe(429);
  });
  it('honors withdrawal on stored and paid contents and rejects marketplace-shaped requests', async () => {
    const report = await create(); env = { ...env, PRODUCT_RECALLS_KILL_SWITCH: '1' };
    expect((await request('/screening/reports/' + report.id)).status).toBe(503);
    const res = await worker.fetch(new Request('https://data.aroqon.com/screening/reports', { headers: { authorization: 'Bearer ' + key, 'x-rapidapi-proxy-secret': 'wrong' } }), env);
    expect(res.status).toBe(403);
  });
  it('escapes spreadsheet formulas and HTML in branded outputs without removing attribution', async () => {
    expect(csvCell(' =HYPERLINK("evil")')).toBe('"\' =HYPERLINK(""evil"")"');
    const report = await create(); const html = printableReport(report.result, 'branded', '<script>alert(1)</script>', report.id);
    expect(html).not.toContain('<script>alert'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('Open Government Licence'); expect(html).toContain('Remedy review');
    const download = reportCsv(report.result);
    expect(download).toContain('Open Government Licence'); expect(download).toContain('Not affiliated with or endorsed'); expect(download).toContain('source_sync_at_check');
    expect(() => new Function(SCREENING_JS)).not.toThrow();
  });
  it('deletes and expires only private report content', async () => {
    const report = await create(); expect((await request('/screening/reports/' + report.id + '/delete', 'POST')).status).toBe(200);
    expect((await request('/screening/reports/' + report.id)).status).toBe(404);
    const another = await create(); await env.DB.prepare("UPDATE screening_report SET expires_at = '2000-01-01' WHERE id = ?").bind(another.id).run(); await expireScreeningReports(env);
    expect(await env.DB.prepare('SELECT result_json FROM screening_report WHERE id = ?').bind(another.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM product_recall').first()).toEqual({ n: 2 });
  });
  it('removes expired failed reservations including brand metadata', async () => {
    await env.DB.prepare("INSERT INTO screening_report (id,customer_id,tier,brand,created_at,expires_at) VALUES ('failed','one','branded','Private label','2000-01-01','2000-01-08')").run();
    await expireScreeningReports(env);
    expect(await env.DB.prepare("SELECT * FROM screening_report WHERE id = 'failed'").first()).toBeNull();
  });
});

describe('one-time report purchases', () => {
  async function checkoutFixture(tier = 'standard') {
    const report = await create(tier, tier === 'branded' ? 'Example firm' : '');
    const session = { id: 'cs_test_screening', mode: 'payment', status: 'open', payment_status: 'unpaid', customer: 'cus_one', currency: 'usd', amount_total: tier === 'standard' ? 2900 : 4900, url: 'https://checkout.stripe.com/c/pay/cs_test_screening', metadata: { product: 'screening-report-v1', report_id: report.id, tier, attempt: '0' }, livemode: false,
      payment_intent: { status: 'succeeded', latest_charge: { paid: true, refunded: false, disputed: false, amount_refunded: 0 } } };
    const fetcher = vi.fn(async () => Response.json(session)); vi.stubGlobal('fetch', fetcher);
    return { report, session, fetcher, path: '/screening/reports/' + report.id };
  }
  it('prices both options on the server and reuses an open checkout', async () => {
    const { path, fetcher } = await checkoutFixture('branded');
    expect((await request(path + '/checkout', 'POST')).status).toBe(200);
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init[1].body));
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('4900'); expect(body.get('mode')).toBe('payment');
    expect(new Headers(init[1].headers).get('idempotency-key')).toMatch(/^screening:/);
    await request(path + '/checkout', 'POST'); expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('reconciles an abandoned checkout before allowing inventory deletion', async () => {
    const { path, report, session, fetcher } = await checkoutFixture();
    await env.DB.prepare('UPDATE screening_report SET checkout_started_at = ? WHERE id = ?').bind(new Date().toISOString(), report.id).run();
    expect((await request(path + '/delete', 'POST')).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE screening_report SET checkout_started_at = ? WHERE id = ?').bind(new Date(Date.now() - 24 * 3600_000).toISOString(), report.id).run();
    session.status = 'expired';
    fetcher.mockImplementation(async () => Response.json(session));
    fetcher.mockImplementationOnce(async () => Response.json({ data: [session], has_more: false }));
    expect((await request(path + '/delete', 'POST')).status).toBe(200);
    expect(await env.DB.prepare('SELECT result_json, checkout_session_id FROM screening_report WHERE id = ?').bind(report.id).first()).toEqual({ result_json: null, checkout_session_id: session.id });
  });
  it('unlocks only verified payment and rejects refunds, disputes, wrong amounts and wrong customers', async () => {
    const { path, session } = await checkoutFixture(); await request(path + '/checkout', 'POST');
    expect((await request(path + '/csv')).status).toBe(402);
    session.status = 'complete'; session.payment_status = 'paid';
    expect((await request(path + '/csv')).status).toBe(200);
    session.payment_intent.latest_charge.refunded = true; expect((await request(path + '/csv')).status).toBe(402); session.payment_intent.latest_charge.refunded = false;
    session.payment_intent.latest_charge.disputed = true; expect((await request(path + '/print')).status).toBe(402); session.payment_intent.latest_charge.disputed = false;
    session.amount_total = 1; expect((await request(path + '/csv')).status).toBe(402); session.amount_total = 2900;
    session.customer = 'cus_two'; expect((await request(path + '/csv')).status).toBe(402);
  });
  it('one-time purchases survive subscription cancellation and webhook replays do not extend retention', async () => {
    const { path, report, session } = await checkoutFixture(); await request(path + '/checkout', 'POST'); session.status = 'complete'; session.payment_status = 'paid';
    await request(path + '/verify', 'POST'); const first = await env.DB.prepare('SELECT expires_at FROM screening_report WHERE id = ?').bind(report.id).first();
    await env.DB.prepare("UPDATE customer SET status = 'canceled' WHERE id = 'one'").run();
    expect((await request(path + '/csv')).status).toBe(200);
    expect(await env.DB.prepare('SELECT expires_at FROM screening_report WHERE id = ?').bind(report.id).first()).toEqual(first);
  });
  it('fails closed on billing errors and separate sales gates', async () => {
    const { path, fetcher } = await checkoutFixture(); env = { ...env, SCREENING_SALES_OPEN: '0' };
    expect((await request(path + '/checkout', 'POST')).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
    expect((await request(path)).status).toBe(200);
  });
  it('uses the same idempotency key under concurrent checkout requests', async () => {
    const { path, fetcher } = await checkoutFixture();
    const responses = await Promise.all([request(path + '/checkout', 'POST'), request(path + '/checkout', 'POST')]);
    expect(responses.map(value => value.status)).toEqual([200, 200]);
    const writes = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).filter(([, init]) => init.method === 'POST');
    expect(new Set(writes.map(([, init]) => new Headers(init.headers).get('idempotency-key'))).size).toBe(1);
    expect(new Set(writes.map(([, init]) => String(init.body))).size).toBe(1);
  });
  it('does not cross live/test boundaries or accept an alternate report id', async () => {
    const { path, session } = await checkoutFixture(); await request(path + '/checkout', 'POST'); session.status = 'complete'; session.payment_status = 'paid';
    session.livemode = true; expect((await request(path + '/csv')).status).toBe(402); session.livemode = false;
    session.metadata.report_id = crypto.randomUUID(); expect((await request(path + '/csv')).status).toBe(402);
  });
  it('recovers missed payment confirmation before expiration cleanup', async () => {
    const { path, session, report } = await checkoutFixture(); await request(path + '/checkout', 'POST'); session.status = 'complete'; session.payment_status = 'paid';
    await env.DB.prepare("UPDATE screening_report SET expires_at = '2000-01-01' WHERE id = ?").bind(report.id).run();
    await expireScreeningReports(env);
    expect((await request(path + '/csv')).status).toBe(200);
    expect(await env.DB.prepare('SELECT paid_at FROM screening_report WHERE id = ?').bind(report.id).first()).toEqual({paid_at:expect.any(String)});
  });
  it('refuses new checkout of an expiring preview and never sells internal acceptance fixtures', async () => {
    const { path, report, fetcher } = await checkoutFixture();
    await env.DB.prepare('UPDATE screening_report SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() + 10 * 60_000).toISOString(), report.id).run();
    const expiring = await request(path + '/checkout', 'POST');
    expect(expiring.status).toBe(400); expect((await expiring.json() as { error: { message: string } }).error.message).toContain('Run a new check'); expect(fetcher).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE screening_report SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() + 86400_000).toISOString(), report.id).run();
    await env.DB.prepare("UPDATE customer SET stripe_customer_id = 'cus_acceptance_internal_20261016', updated_at = ? WHERE id = 'one'").bind(new Date().toISOString()).run();
    expect((await request(path + '/checkout', 'POST')).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
  it('fulfills signed one-time webhook deliveries idempotently and rejects an unsigned claim', async () => {
    const { path, report, session } = await checkoutFixture(); await request(path + '/checkout', 'POST'); session.status = 'complete'; session.payment_status = 'paid';
    env = { ...env, STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_screening_fixture' };
    const payload = JSON.stringify({ id:'evt_screening',type:'checkout.session.completed',data:{object:{id:session.id,mode:'payment',metadata:{product:'screening-report-v1'}}} });
    expect((await handleStripeWebhook(env,new Request('https://data.aroqon.com/stripe/webhook',{method:'POST',body:payload}))).status).toBe(400);
    const timestamp = Math.floor(Date.now()/1000);
    const signingKey = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(timestamp + '.' + payload)))].map(value=>value.toString(16).padStart(2,'0')).join('');
    for (let i=0;i<2;i++) expect((await handleStripeWebhook(env,new Request('https://data.aroqon.com/stripe/webhook',{method:'POST',body:payload,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}}))).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM stripe_event').first()).toEqual({n:1});
    expect(await env.DB.prepare('SELECT paid_at FROM screening_report WHERE id = ?').bind(report.id).first()).toEqual({paid_at:expect.any(String)});
  });
  it('withholds a paid report on revoked keys and provider failure', async () => {
    const { path, session, fetcher } = await checkoutFixture(); await request(path + '/checkout', 'POST'); session.status='complete';session.payment_status='paid';
    fetcher.mockImplementation(async () => { throw new Error('provider unavailable'); });
    expect((await request(path + '/csv')).status).toBe(503);
    await env.DB.prepare("UPDATE api_key SET revoked_at = ? WHERE customer_id = 'one'").bind(now).run();
    expect((await request(path + '/csv')).status).toBe(401);
  });
});
