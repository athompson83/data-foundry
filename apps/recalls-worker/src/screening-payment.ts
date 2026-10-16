/** One-time Checkout purchases; amounts and report identity are always server-owned. */
import { ACCEPTANCE_FIXTURE_ID, type AuthenticatedCustomer } from './account.js';
import type { Env } from './env.js';
import { SCREENING_TIERS, type ScreeningTier } from './screening.js';
import { stripe, StripeError } from './stripe.js';

export interface StoredReport {
  id: string; customer_id: string; tier: ScreeningTier; brand: string; created_at: string; expires_at: string;
  result_json: string | null; checkout_session_id: string | null; checkout_attempt: number;
  checkout_started_at: string | null; paid_at: string | null; deleted_at: string | null;
}
interface ReportCheckout {
  id: string; mode: string; status: string; payment_status: string; customer: string; currency: string;
  amount_total: number; url: string | null; metadata: Record<string, string>; livemode: boolean;
  payment_intent?: { status: string; latest_charge?: { paid: boolean; refunded: boolean; disputed: boolean; amount_refunded: number } } | string;
}
export const screeningSalesOpen = (env: Env): boolean => env.SALES_OPEN === '1' && env.SCREENING_SALES_OPEN === '1';
/** Only deliberately public local errors use this type; Stripe response text stays opaque. */
export class ScreeningCheckoutError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 503) { super(message); this.name = 'ScreeningCheckoutError'; }
}

/** After the fixed session expiry, reconcile an ambiguous attempt before allowing erasure. */
export async function recoverAbandonedCheckout(env: Env, report: StoredReport, customerId: string): Promise<string | null> {
  const started = Date.parse(report.checkout_started_at ?? '');
  if (!Number.isFinite(started) || Date.now() - started <= 23 * 3600_000) throw new StripeError('Checkout may still be in progress', 409);
  let cursor: string | undefined; let found: ReportCheckout | undefined;
  for (let page = 0; page < 10; page++) {
    const sessions = await stripe<{ data: ReportCheckout[]; has_more: boolean }>(env, 'GET', 'checkout/sessions', {
      customer: customerId, limit: 100, created: { gte: Math.floor(started / 1000) - 60 }, ...(cursor ? { starting_after: cursor } : {}),
    });
    for (const session of sessions.data) {
      if (session.metadata?.['report_id'] !== report.id || session.metadata?.['product'] !== 'screening-report-v1' || session.metadata?.['attempt'] !== String(report.checkout_attempt)) continue;
      if (found || !bound(session, { ...report, checkout_session_id: session.id }, customerId, env)) throw new StripeError('Ambiguous checkout identity', 503);
      found = session;
    }
    if (!sessions.has_more) {
      if (!found) return null; // The fixed expires_at has passed; an in-flight create cannot open a new valid session.
      await env.DB.prepare('UPDATE screening_report SET checkout_session_id = ? WHERE id = ? AND checkout_session_id IS NULL AND checkout_attempt = ?')
        .bind(found.id, report.id, report.checkout_attempt).run();
      if (found.status === 'complete') await reportPayment(env, { ...report, checkout_session_id: found.id }, customerId);
      return found.id;
    }
    cursor = sessions.data.at(-1)?.id;
    if (!cursor) break;
  }
  throw new StripeError('Checkout reconciliation incomplete; retry or contact support', 503);
}

function bound(session: ReportCheckout, report: StoredReport, customerId: string, env: Env): boolean {
  return session.id === report.checkout_session_id && session.mode === 'payment' && session.customer === customerId &&
    session.currency === 'usd' && session.amount_total === SCREENING_TIERS[report.tier].cents &&
    session.metadata['product'] === 'screening-report-v1' && session.metadata['report_id'] === report.id &&
    session.metadata['tier'] === report.tier && session.metadata['attempt'] === String(report.checkout_attempt) &&
    session.livemode === /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '');
}

export async function reportPayment(env: Env, report: StoredReport, stripeCustomerId: string): Promise<boolean> {
  if (!report.checkout_session_id) return false;
  const session = await stripe<ReportCheckout>(env, 'GET', `checkout/sessions/${encodeURIComponent(report.checkout_session_id)}`, { expand: ['payment_intent.latest_charge'] });
  const intent = session.payment_intent;
  const charge = typeof intent === 'object' ? intent.latest_charge : undefined;
  const paid = bound(session, report, stripeCustomerId, env) && session.status === 'complete' && session.payment_status === 'paid' &&
    typeof intent === 'object' && intent.status === 'succeeded' && charge?.paid === true && charge.refunded === false && charge.disputed === false && charge.amount_refunded === 0;
  if (paid) {
    // Replays do not renew retention. A refund never erases the accounting history.
    await env.DB.prepare("UPDATE screening_report SET paid_at = ?, expires_at = ? WHERE id = ? AND paid_at IS NULL AND deleted_at IS NULL AND result_json IS NOT NULL")
      .bind(new Date().toISOString(), new Date(Date.now() + 365 * 86400_000).toISOString(), report.id).run();
  }
  return paid;
}

/** Webhook and authenticated browser recovery share the same live verification. */
export async function fulfillScreeningSession(env: Env, sessionId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT r.*, c.stripe_customer_id FROM screening_report r JOIN customer c ON c.id = r.customer_id WHERE r.checkout_session_id = ?')
    .bind(sessionId).first<StoredReport & { stripe_customer_id: string }>();
  if (row) { await reportPayment(env, row, row.stripe_customer_id); return; }
  // A delivery before Checkout's id is persisted must be retried. Ignore unrelated one-time products.
  const session = await stripe<ReportCheckout>(env, 'GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.metadata?.['product'] === 'screening-report-v1') throw new StripeError('Screening checkout is not yet bound', 503);
}

export async function reportCheckout(env: Env, report: StoredReport, customer: AuthenticatedCustomer): Promise<{ url?: string; paid?: boolean }> {
  if (!screeningSalesOpen(env)) throw new ScreeningCheckoutError('Screening purchases are not open yet. Your free preview remains available.', 503);
  if (!customer.stripeCustomerId || ACCEPTANCE_FIXTURE_ID.test(customer.stripeCustomerId)) throw new ScreeningCheckoutError('A real direct billing account is required.', 400);
  if (Date.parse(report.expires_at) - Date.now() < 31 * 60_000) throw new ScreeningCheckoutError('This preview is expiring. Run a new check before purchasing.', 400);
  if (report.checkout_session_id) {
    const session = await stripe<ReportCheckout>(env, 'GET', `checkout/sessions/${encodeURIComponent(report.checkout_session_id)}`);
    if (!bound(session, report, customer.stripeCustomerId, env)) throw new StripeError('Checkout identity mismatch', 503);
    if (session.status === 'complete') return { paid: await reportPayment(env, report, customer.stripeCustomerId) };
    if (session.status === 'open' && session.url) return { url: session.url };
    if (session.status !== 'expired') throw new StripeError('Checkout is not available', 503);
    // Compare-and-swap: competing requests rotate the expired attempt only once.
    await env.DB.prepare('UPDATE screening_report SET checkout_session_id = NULL, checkout_started_at = NULL, checkout_attempt = checkout_attempt + 1 WHERE id = ? AND checkout_session_id = ?')
      .bind(report.id, session.id).run();
  }
  await env.DB.prepare('UPDATE screening_report SET checkout_started_at = COALESCE(checkout_started_at, ?) WHERE id = ?').bind(new Date().toISOString(), report.id).run();
  const current = await env.DB.prepare('SELECT * FROM screening_report WHERE id = ?').bind(report.id).first<StoredReport>();
  if (!current || current.deleted_at || !current.result_json) throw new ScreeningCheckoutError('This report is no longer available. Run a new preview.', 400);
  // Stripe retains idempotency keys for at least 24h. Do not silently recreate an ambiguous older attempt.
  if (Date.now() - Date.parse(current.checkout_started_at!) > 23 * 3600_000) throw new ScreeningCheckoutError('Checkout recovery needs support. Your preview remains available, or you can delete it after payment reconciliation.', 400);
  const session = await stripe<ReportCheckout>(env, 'POST', 'checkout/sessions', {
    mode: 'payment', customer: customer.stripeCustomerId, payment_method_types: ['card'],
    expires_at: Math.floor(Math.min(Date.parse(current.expires_at), Date.parse(current.checkout_started_at!) + 23 * 3600_000) / 1000),
    line_items: [{ price_data: { currency: 'usd', unit_amount: SCREENING_TIERS[current.tier].cents,
      product_data: { name: SCREENING_TIERS[current.tier].label, description: 'Up to 50 consumer-product inventory rows. Dated CSV and printable report; one year of access. Partial coverage, no safety certification.' } }, quantity: 1 }],
    metadata: { product: 'screening-report-v1', report_id: current.id, tier: current.tier, attempt: String(current.checkout_attempt) },
    success_url: `${env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com'}/screening?report=${current.id}`,
    cancel_url: `${env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com'}/screening?report=${current.id}`,
  }, `screening:${current.id}:${current.checkout_attempt}`);
  const checkoutUrl = session.url ? new URL(session.url) : null;
  if (!session.id || !checkoutUrl || checkoutUrl.hostname !== 'checkout.stripe.com' || checkoutUrl.protocol !== 'https:' || checkoutUrl.username || checkoutUrl.password) throw new StripeError('Checkout response invalid', 503);
  const saved = await env.DB.prepare('UPDATE screening_report SET checkout_session_id = ? WHERE id = ? AND checkout_attempt = ? AND deleted_at IS NULL AND result_json IS NOT NULL RETURNING id')
    .bind(session.id, current.id, current.checkout_attempt).first<{ id: string }>();
  if (!saved) {
    await stripe(env, 'POST', `checkout/sessions/${encodeURIComponent(session.id)}/expire`);
    throw new ScreeningCheckoutError('This report is no longer available. Run a new preview.', 400);
  }
  return { url: checkoutUrl.href };
}
