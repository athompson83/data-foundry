import { acceptanceLeaseExpired, consumeRequest, findCustomerByKey, presentedKey } from './account.js';
import { BadRequest } from './api.js';
import type { Env } from './env.js';
import { productsServed } from './intake.js';
import { resolveChannel } from './marketplace.js';
import { recoverAbandonedCheckout, reportCheckout, reportPayment, ScreeningCheckoutError, screeningSalesOpen, type StoredReport } from './screening-payment.js';
import { parseInventory, reportCsv, screenInventory, SCREENING_TIERS, type ScreeningResult, type ScreeningTier } from './screening.js';
import { printableReport } from './screening-page.js';
import { stripe, StripeError } from './stripe.js';

const PRIVATE = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' };
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: PRIVATE });
const error = (status: number, code: string, message: string) => reply({ error: { code, message } }, status);
const reportView = (row: StoredReport) => ({ id: row.id, tier: row.tier, brand: row.brand, created_at: row.created_at, expires_at: row.expires_at, purchased: !!row.paid_at });

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new BadRequest('Send application/json.');
  const reader = request.body?.getReader(); if (!reader) throw new BadRequest('A request body is required.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 100_000) { await reader.cancel(); throw new BadRequest('Request exceeds 100 KB.'); } chunks.push(next.value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* opaque parser error */ }
  throw new BadRequest('A JSON object is required.');
}

export async function screeningRoutes(request: Request, env: Env): Promise<Response> {
  try { return await route(request, env); }
  catch (cause) {
    if (cause instanceof BadRequest) return error(400, 'invalid_request', cause.message);
    if (cause instanceof ScreeningCheckoutError) return error(cause.status, 'checkout_unavailable', cause.message);
    if (cause instanceof StripeError) return error(503, 'billing_unavailable', 'Billing could not be verified. No report access was granted. Please retry or contact support.');
    // Never log inventory, payment objects, tokens or database errors containing them.
    console.error('screening_request_failed');
    return error(503, 'screening_unavailable', 'Screening is temporarily unavailable. Your saved reports can be reopened later.');
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  if ((await resolveChannel(env, request)).channel !== 'direct') return error(403, 'direct_account_required', 'Use a direct Data Foundry key. Marketplace subscriptions are separate.');
  const key = presentedKey(request);
  const customer = key ? await findCustomerByKey(env.DB, key) : null;
  if (!customer || customer.status === 'suspended' || acceptanceLeaseExpired(customer)) return error(401, 'invalid_key', 'Enter a current direct Data Foundry key.');
  const url = new URL(request.url);
  if (url.pathname === '/screening/reports') {
    if (request.method === 'GET') {
      const before = url.searchParams.get('before') ?? '9999';
      if (before !== '9999' && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) throw new BadRequest('Invalid report cursor.');
      const rows = await env.DB.prepare('SELECT * FROM screening_report WHERE customer_id = ? AND created_at < ? AND deleted_at IS NULL AND result_json IS NOT NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 51')
        .bind(customer.customerId, before, new Date().toISOString()).all<StoredReport>();
      return reply({ reports: rows.results.slice(0, 50).map(reportView), next: rows.results.length > 50 ? rows.results[49]?.created_at : null });
    }
    if (request.method !== 'POST') return error(405, 'method_not_allowed', 'GET or POST only.');
    if (!productsServed(env)) return error(503, 'dataset_unavailable', 'Consumer-product coverage is withdrawn. No screening was performed.');
    if (!['active', 'past_due'].includes(customer.status)) return error(403, 'subscription_inactive', 'An active direct account is required for a new preview. Purchased reports remain accessible.');
    const input = await body(request);
    if (Object.keys(input).some(name => !['csv', 'tier', 'brand'].includes(name))) throw new BadRequest('Only csv, tier and brand are accepted.');
    const items = parseInventory(input['csv']);
    const tier = input['tier'] ?? 'standard';
    if (tier !== 'standard' && tier !== 'branded') throw new BadRequest('Choose standard or branded.');
    const brand = input['brand'] ?? '';
    if (typeof brand !== 'string' || brand.length > 80 || /[\u0000-\u001f\u007f]/.test(brand) || (tier === 'standard' && brand)) throw new BadRequest('A brand name of up to 80 characters is available with branded reports.');
    if (tier === 'branded' && !brand.trim()) throw new BadRequest('Enter a business name for the branded report, or choose the $29 standard report.');
    const id = crypto.randomUUID(); const now = new Date();
    // Reserve first: concurrent expensive previews cannot bypass the five-per-day cap. Failed attempts count.
    const reserved = await env.DB.prepare(`INSERT INTO screening_report (id, customer_id, tier, brand, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM screening_report WHERE customer_id = ? AND created_at > ?) < 5 RETURNING id`)
      .bind(id, customer.customerId, tier, brand.trim(), now.toISOString(), new Date(now.getTime() + 7 * 86400_000).toISOString(), customer.customerId, new Date(now.getTime() - 86400_000).toISOString()).first<{ id: string }>();
    if (!reserved) return error(429, 'preview_limit', 'Five previews per rolling 24 hours. Reopen an existing report or try again tomorrow.');
    if (await consumeRequest(env.DB, customer, now) === null) return error(429, 'allowance_exhausted', 'Your direct API allowance is exhausted. Check Usage and billing.');
    const result = await screenInventory(env, items, now);
    const serialized = JSON.stringify(result);
    if (new TextEncoder().encode(serialized).length > 900_000) return error(422, 'report_too_large', 'Too many notices matched. Split the inventory into smaller batches. No report purchase is required.');
    await env.DB.prepare('UPDATE screening_report SET result_json = ? WHERE id = ?').bind(serialized, id).run();
    return reply({ id, result, tier, brand: brand.trim(), price_usd: SCREENING_TIERS[tier].cents / 100, sales_open: screeningSalesOpen(env) }, 201);
  }
  const match = /^\/screening\/reports\/([0-9a-f-]{36})(?:\/(checkout|verify|csv|print|delete))?$/.exec(url.pathname);
  if (!match) return error(404, 'not_found', 'Report not found.');
  const action = match[2] ?? 'view';
  if (request.method !== (['checkout', 'verify', 'delete'].includes(action) ? 'POST' : 'GET')) return error(405, 'method_not_allowed', 'Unsupported method.');
  const report = await env.DB.prepare('SELECT * FROM screening_report WHERE id = ? AND customer_id = ? AND deleted_at IS NULL')
    .bind(match[1]!, customer.customerId).first<StoredReport>();
  if (!report || !report.result_json || report.expires_at <= new Date().toISOString()) return error(404, 'not_found', 'Report not found or its retention period ended.');
  if (action === 'delete') {
    if (report.checkout_started_at && !report.checkout_session_id) {
      if (Date.now() - Date.parse(report.checkout_started_at) <= 23 * 3600_000 || !customer.stripeCustomerId) return error(409, 'checkout_pending', 'Checkout may still be in progress. Retry checkout, then delete; an abandoned attempt can be reconciled for deletion after 23 hours.');
      report.checkout_session_id = await recoverAbandonedCheckout(env, report, customer.stripeCustomerId);
    }
    // Close an outstanding payment link before removing the deliverable.
    if (report.checkout_session_id) {
      const session = await stripe<{ status: string }>(env, 'GET', `checkout/sessions/${encodeURIComponent(report.checkout_session_id)}`);
      if (session.status === 'open') await stripe(env, 'POST', `checkout/sessions/${encodeURIComponent(report.checkout_session_id)}/expire`);
    }
    await env.DB.prepare("UPDATE screening_report SET result_json = NULL, brand = '', deleted_at = ? WHERE id = ? AND customer_id = ?")
      .bind(new Date().toISOString(), report.id, customer.customerId).run();
    return reply({ deleted: true });
  }
  // Stored snapshots, including paid ones, must honor the current publication gate.
  if (!productsServed(env)) return error(503, 'dataset_unavailable', 'Consumer-product coverage is withdrawn. Report contents are temporarily unavailable.');
  if (action === 'checkout') return reply(await reportCheckout(env, report, customer));
  if (action === 'verify') return reply({ paid: !!customer.stripeCustomerId && await reportPayment(env, report, customer.stripeCustomerId) });
  const result = JSON.parse(report.result_json) as ScreeningResult;
  if (action === 'view') return reply({ ...reportView(report), result, price_usd: SCREENING_TIERS[report.tier].cents / 100, sales_open: screeningSalesOpen(env) });
  if (!customer.stripeCustomerId || !await reportPayment(env, report, customer.stripeCustomerId)) return error(402, 'payment_required', 'Purchase this report to download it. All safety findings remain visible in the free preview.');
  const csv = action === 'csv';
  return new Response(csv ? reportCsv(result) : printableReport(result, report.tier as ScreeningTier, report.brand, report.id), { headers: {
    ...PRIVATE, 'content-type': csv ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
    'content-disposition': `attachment; filename="data-foundry-${report.id}.${csv ? 'csv' : 'html'}"`,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}

/** Drop inventory content on the disclosed retention schedule; preserve payment references. */
export async function expireScreeningReports(env: Env): Promise<void> {
  const now = new Date().toISOString();
  // Reconcile missed webhooks before purging an unpaid snapshot. Billing outages retain content for recovery.
  const pending = await env.DB.prepare('SELECT r.*, c.stripe_customer_id FROM screening_report r JOIN customer c ON c.id = r.customer_id WHERE r.expires_at <= ? AND r.result_json IS NOT NULL AND r.checkout_session_id IS NOT NULL AND r.paid_at IS NULL LIMIT 50')
    .bind(now).all<StoredReport & { stripe_customer_id: string }>();
  for (const report of pending.results) {
    try {
      if (!await reportPayment(env, report, report.stripe_customer_id)) await env.DB.prepare("UPDATE screening_report SET result_json = NULL, brand = '' WHERE id = ? AND paid_at IS NULL AND expires_at <= ?").bind(report.id, now).run();
    } catch { console.error('screening_retention_billing_retry'); }
  }
  await env.DB.prepare("UPDATE screening_report SET result_json = NULL, brand = '' WHERE expires_at <= ? AND result_json IS NOT NULL AND (checkout_session_id IS NULL OR paid_at IS NOT NULL)").bind(now).run();
  // Failed reservations still count toward the rolling limit, then leave no private metadata behind.
  await env.DB.prepare('DELETE FROM screening_report WHERE expires_at <= ? AND result_json IS NULL AND checkout_session_id IS NULL AND checkout_started_at IS NULL AND paid_at IS NULL').bind(now).run();
}
