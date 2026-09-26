/**
 * Self-service paid access over Stripe (ADR-0014).
 *
 *   GET  /v1/billing/plans           the purchasable plan ladder (public)
 *   POST /v1/billing/checkout        start a Stripe Checkout subscription
 *   GET  /v1/billing/claim           Checkout's success page: issue the key once
 *   POST /v1/billing/stripe-webhook  subscription lifecycle from Stripe (signed)
 *   POST /v1/billing/portal          a Stripe billing-portal link (API key auth)
 *
 * A paid key is an ordinary `API_PAID`/`DIRECT` key for this deployment's one
 * vertical, with a monthly request allowance. Everything the rights engine,
 * authentication and metering already enforce still applies; billing only
 * decides who holds a key and how many requests it may make.
 *
 * The API key is shown exactly once, on the claim page Checkout redirects to.
 * Provisioning is idempotent on the Checkout session id, so the webhook and the
 * redirect can arrive in either order and a reload never mints a second key.
 */
import { hashApiKey, looksLikeApiKey, mintApiKey, readBearerToken, type KeyEnvironment } from '@data-foundry/api-keys';
import {
  BillingConfigurationError,
  StripeApiError,
  StripeClient,
  findPlanByCode,
  findPlanByPriceId,
  resolvePurchasablePlans,
  storedSubscriptionStatus,
  subscriptionGrantsAccess,
  verifyStripeSignature,
  type CheckoutSessionSummary,
  type FetchLike,
  type PurchasablePlan,
  type StoredSubscriptionStatus,
  type SubscriptionSummary,
} from '@data-foundry/billing';
import type { SqlDriver, SqlExecutor } from '@data-foundry/canonical-store';
import type { BillingConfig } from './env.js';
import type { RuntimePlan } from './composition.js';

export const BILLING_PATH_PREFIX = '/v1/billing/';

export interface BillingContext {
  readonly config: BillingConfig;
  readonly plans: readonly RuntimePlan[];
  readonly verticalSlug: string;
  readonly verticalId: string;
  readonly keyEnvironment: KeyEnvironment;
  readonly driver: SqlDriver;
  readonly now: Date;
  /** Swappable for tests; production uses the global `fetch`. */
  readonly fetch?: FetchLike;
}

type BillingErrorCode =
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'BAD_REQUEST'
  | 'UNKNOWN_PLAN'
  | 'CHECKOUT_INCOMPLETE'
  | 'CHECKOUT_MISMATCH'
  | 'ALREADY_CLAIMED'
  | 'UNAUTHORIZED'
  | 'NO_SUBSCRIPTION'
  | 'INVALID_SIGNATURE'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function billingError(status: number, code: BillingErrorCode, message: string): Response {
  return json(status, { error: { code, message } });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function htmlPage(status: number, title: string, bodyHtml: string): Response {
  const page =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow">' +
    `<title>${escapeHtml(title)}</title>` +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}' +
    'code{display:block;padding:.75rem;background:#f3f3f3;border-radius:6px;word-break:break-all;font-size:15px}' +
    '@media (prefers-color-scheme:dark){body{background:#111;color:#eee}code{background:#222}}</style>' +
    `</head><body>${bodyHtml}</body></html>`;
  return new Response(page, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function stripe(context: BillingContext): StripeClient {
  return new StripeClient({
    secretKey: context.config.secretKey,
    ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
  });
}

function purchasablePlans(context: BillingContext): readonly PurchasablePlan[] {
  return resolvePurchasablePlans(context.plans, context.config.priceIdsJson);
}

// ---------------------------------------------------------------------------
// Provisioning (shared by the claim redirect and the webhook)
// ---------------------------------------------------------------------------

interface SubscriptionRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly key_claimed_at: string | Date | null;
}

type ProvisionOutcome =
  | { readonly ok: true; readonly subscription: SubscriptionRow; readonly plan: PurchasablePlan }
  | { readonly ok: false; readonly status: number; readonly code: BillingErrorCode; readonly message: string };

/**
 * Validates a completed Checkout session against this deployment and returns
 * the plan it bought. A session created by another deployment (another
 * vertical, or a sandbox) is refused rather than provisioned here.
 */
function checkedSession(
  context: BillingContext,
  session: CheckoutSessionSummary,
  plans: readonly PurchasablePlan[],
): { ok: true; plan: PurchasablePlan; subscription: SubscriptionSummary } | Extract<ProvisionOutcome, { ok: false }> {
  if (session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.paymentStatus ?? '')) {
    return { ok: false, status: 409, code: 'CHECKOUT_INCOMPLETE', message: 'This checkout has not completed payment.' };
  }
  if (session.metadata['vertical_slug'] !== context.verticalSlug) {
    return { ok: false, status: 409, code: 'CHECKOUT_MISMATCH', message: 'This checkout was not created for this API.' };
  }
  const subscription = session.subscription;
  if (subscription === null || session.customerId === null) {
    return { ok: false, status: 409, code: 'CHECKOUT_INCOMPLETE', message: 'This checkout has no subscription yet.' };
  }
  const plan =
    (subscription.priceId === null ? null : findPlanByPriceId(plans, subscription.priceId)) ??
    findPlanByCode(plans, session.metadata['plan_code'] ?? '');
  if (plan === null) {
    return { ok: false, status: 409, code: 'CHECKOUT_MISMATCH', message: 'This checkout bought a plan this API does not sell.' };
  }
  return { ok: true, plan, subscription };
}

function periodEnd(subscription: SubscriptionSummary): string | null {
  return subscription.currentPeriodEnd === null ? null : new Date(subscription.currentPeriodEnd * 1000).toISOString();
}

/** Creates tenant, subscription and allowance once per Checkout session. */
async function ensureProvisioned(
  tx: SqlExecutor,
  context: BillingContext,
  session: CheckoutSessionSummary,
  plan: PurchasablePlan,
  subscription: SubscriptionSummary,
): Promise<SubscriptionRow> {
  const existing = await tx.query<SubscriptionRow>(
    `select id, tenant_id, key_claimed_at
       from api_subscriptions
      where provider = 'STRIPE' and provider_checkout_session_id = $1
      for update`,
    [session.id],
  );
  if (existing[0] !== undefined) return existing[0];

  const status: StoredSubscriptionStatus = storedSubscriptionStatus(subscription.status) ?? 'INCOMPLETE';
  const tenantSlug = `stripe-${subscription.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 120);
  const tenants = await tx.query<{ id: string }>(
    `insert into api_tenants (slug, name, status, billing_ref, contact_email)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      tenantSlug,
      session.customerEmail ?? 'Self-service customer',
      subscriptionGrantsAccess(status) ? 'ACTIVE' : 'SUSPENDED',
      session.customerId,
      session.customerEmail,
    ],
  );
  const tenantId = tenants[0]!.id;
  const rows = await tx.query<SubscriptionRow>(
    `insert into api_subscriptions
       (tenant_id, vertical_id, provider, provider_customer_id, provider_subscription_id,
        provider_checkout_session_id, plan_code, status, current_period_end)
     values ($1, $2, 'STRIPE', $3, $4, $5, $6, $7, $8)
     returning id, tenant_id, key_claimed_at`,
    [
      tenantId,
      context.verticalId,
      session.customerId,
      subscription.id,
      session.id,
      plan.code,
      status,
      periodEnd(subscription),
    ],
  );
  await tx.query(
    `insert into api_tenant_allowances (tenant_id, plan_code, monthly_request_allowance)
     values ($1, $2, $3)`,
    [tenantId, plan.code, plan.includedRequests],
  );
  return rows[0]!;
}

/** Provisions (idempotently) and issues the key for a completed Checkout, once. */
async function claimFromSession(
  context: BillingContext,
  sessionId: string,
): Promise<ProvisionOutcome & { readonly secret?: string }> {
  const plans = purchasablePlans(context);
  const session = await stripe(context).retrieveCheckoutSession(sessionId);
  const checked = checkedSession(context, session, plans);
  if (!checked.ok) return checked;

  return context.driver.transaction(async (tx) => {
    const row = await ensureProvisioned(tx, context, session, checked.plan, checked.subscription);
    if (row.key_claimed_at !== null) {
      return {
        ok: false as const,
        status: 409,
        code: 'ALREADY_CLAIMED' as const,
        message: 'The API key for this purchase was already issued. Keys are shown only once.',
      };
    }
    const minted = await mintApiKey(context.keyEnvironment);
    await tx.query(
      `insert into api_keys
         (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
       values ($1, $2, $3, $4, $5, 'API_PAID', 'DIRECT')`,
      [row.tenant_id, minted.tokenHash, minted.tokenPrefix, `self-service ${checked.plan.code}`, context.verticalId],
    );
    await tx.query(
      `update api_subscriptions set key_claimed_at = $2, updated_at = $2 where id = $1`,
      [row.id, context.now.toISOString()],
    );
    return { ok: true as const, subscription: row, plan: checked.plan, secret: minted.secret };
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function listPlans(context: BillingContext): Response {
  const plans = purchasablePlans(context);
  return json(200, {
    data: plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      monthly_usd: plan.monthlyUsd,
      included_requests: plan.includedRequests,
      overage: 'none — requests stop at the allowance until the next calendar month or an upgrade',
    })),
  });
}

async function readCheckoutInput(request: Request): Promise<{ plan: string; email: string | null; form: boolean } | null> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  const raw = await request.text();
  if (raw.length > 4096) return null;
  let plan: unknown;
  let email: unknown;
  let form = false;
  if (contentType.startsWith('application/json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      plan = parsed['plan'];
      email = parsed['email'];
    } catch {
      return null;
    }
  } else if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    plan = params.get('plan');
    email = params.get('email');
    form = true;
  } else {
    return null;
  }
  if (typeof plan !== 'string' || plan.length > 64) return null;
  const normalizedEmail =
    typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
  if (normalizedEmail !== null && !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(normalizedEmail)) return null;
  return { plan: plan.trim().toLowerCase(), email: normalizedEmail, form };
}

async function startCheckout(request: Request, context: BillingContext): Promise<Response> {
  const input = await readCheckoutInput(request);
  if (input === null) {
    return billingError(400, 'BAD_REQUEST', 'Send {"plan": "<code>", "email": "<optional>"} as JSON or a form.');
  }
  const plan = findPlanByCode(purchasablePlans(context), input.plan);
  if (plan === null) return billingError(404, 'UNKNOWN_PLAN', 'No purchasable plan has that code. See GET /v1/billing/plans.');
  const session = await stripe(context).createCheckoutSession({
    priceId: plan.providerPriceId,
    successUrl: `${context.config.publicOrigin}/v1/billing/claim?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: context.config.returnUrl,
    customerEmail: input.email ?? undefined,
    metadata: { vertical_slug: context.verticalSlug, plan_code: plan.code },
  });
  if (session.url === null) {
    return billingError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider did not return a checkout page.');
  }
  if (input.form) {
    return new Response(null, { status: 303, headers: { location: session.url, 'cache-control': 'no-store' } });
  }
  return json(201, { data: { checkout_url: session.url, plan: plan.code } });
}

async function claimKey(request: Request, context: BillingContext): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get('session_id') ?? '';
  const html = wantsHtml(request);
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,255}$/.test(sessionId)) {
    return html
      ? htmlPage(400, 'Invalid checkout', '<h1>Invalid checkout link</h1><p>This link does not identify a checkout.</p>')
      : billingError(400, 'BAD_REQUEST', 'A valid session_id is required.');
  }
  const outcome = await claimFromSession(context, sessionId);
  if (!outcome.ok) {
    return html
      ? htmlPage(outcome.status, 'API key', `<h1>API key not issued</h1><p>${escapeHtml(outcome.message)}</p>`)
      : billingError(outcome.status, outcome.code, outcome.message);
  }
  const secret = outcome.secret ?? '';
  if (html) {
    return htmlPage(
      201,
      'Your API key',
      '<h1>Your API key</h1>' +
        `<p>Plan: <strong>${escapeHtml(outcome.plan.name)}</strong> — ${outcome.plan.includedRequests.toLocaleString('en-US')} requests per calendar month.</p>` +
        '<p><strong>Copy it now. It is shown only once and cannot be recovered.</strong></p>' +
        `<code>${escapeHtml(secret)}</code>` +
        `<p>Send it as <code>Authorization: Bearer ${escapeHtml(secret.slice(0, 12))}…</code></p>` +
        '<p>Manage or cancel your subscription with <code>POST /v1/billing/portal</code> using this key.</p>',
    );
  }
  return json(201, {
    data: {
      api_key: secret,
      plan: outcome.plan.code,
      monthly_request_allowance: outcome.plan.includedRequests,
      notice: 'Shown once. Store it securely; it cannot be recovered.',
    },
  });
}

interface StripeEvent {
  readonly id: string;
  readonly type: string;
  readonly object: Record<string, unknown>;
}

function parseEvent(payload: string): StripeEvent | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const data = parsed['data'] as { object?: unknown } | undefined;
    if (typeof parsed['id'] !== 'string' || typeof parsed['type'] !== 'string') return null;
    if (data?.object === null || typeof data?.object !== 'object') return null;
    return { id: parsed['id'], type: parsed['type'], object: data.object as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function applySubscriptionChange(
  tx: SqlExecutor,
  context: BillingContext,
  subscription: SubscriptionSummary,
): Promise<void> {
  const status = storedSubscriptionStatus(subscription.status);
  if (status === null) return;
  const rows = await tx.query<{ id: string; tenant_id: string }>(
    `update api_subscriptions
        set status = $2, current_period_end = $3, updated_at = $4
      where provider = 'STRIPE' and provider_subscription_id = $1 and vertical_id = $5
      returning id, tenant_id`,
    [subscription.id, status, periodEnd(subscription), context.now.toISOString(), context.verticalId],
  );
  const row = rows[0];
  // Not provisioned here yet (another vertical, or Checkout not completed):
  // the claim path reads the live status from Stripe when it provisions.
  if (row === undefined) return;
  await tx.query(
    `update api_tenants
        set status = $2, updated_at = $3
      where id = $1 and status <> 'CLOSED'`,
    [row.tenant_id, subscriptionGrantsAccess(status) ? 'ACTIVE' : 'SUSPENDED', context.now.toISOString()],
  );
  const plan = subscription.priceId === null ? null : findPlanByPriceId(purchasablePlans(context), subscription.priceId);
  if (plan !== null) {
    await tx.query(
      `update api_subscriptions set plan_code = $2 where id = $1`,
      [row.id, plan.code],
    );
    await tx.query(
      `update api_tenant_allowances
          set plan_code = $2, monthly_request_allowance = $3, updated_at = $4
        where tenant_id = $1`,
      [row.tenant_id, plan.code, plan.includedRequests, context.now.toISOString()],
    );
  }
}

async function handleWebhook(request: Request, context: BillingContext): Promise<Response> {
  const payload = await request.text();
  const verification = await verifyStripeSignature(
    payload,
    request.headers.get('stripe-signature'),
    context.config.webhookSecret,
    Math.floor(context.now.getTime() / 1000),
  );
  if (!verification.ok) return billingError(400, 'INVALID_SIGNATURE', 'The webhook signature did not verify.');
  const event = parseEvent(payload);
  if (event === null) return billingError(400, 'BAD_REQUEST', 'Not a Stripe event.');

  // Anything that needs the payment provider is fetched before the
  // transaction opens, so no database transaction waits on a network call.
  let completedSession: { session: CheckoutSessionSummary; plan: PurchasablePlan; subscription: SubscriptionSummary } | null = null;
  let changedSubscription: SubscriptionSummary | null = null;
  if (event.type === 'checkout.session.completed') {
    const sessionId = typeof event.object['id'] === 'string' ? event.object['id'] : '';
    const metadata = event.object['metadata'] as Record<string, unknown> | undefined;
    // Sessions for other verticals share the Stripe account; acknowledge and ignore them.
    if (metadata?.['vertical_slug'] === context.verticalSlug && sessionId !== '') {
      const session = await stripe(context).retrieveCheckoutSession(sessionId);
      const checked = checkedSession(context, session, purchasablePlans(context));
      if (checked.ok) completedSession = { session, plan: checked.plan, subscription: checked.subscription };
    }
  } else if (event.type.startsWith('customer.subscription.')) {
    changedSubscription = parseSubscriptionObject(event.object);
  }

  // The event id and its effect commit together: a failure rolls both back and
  // Stripe's redelivery is processed; a redelivery after success is a no-op.
  const duplicate = await context.driver.transaction(async (tx) => {
    const fresh = await tx.query<{ provider_event_id: string }>(
      `insert into billing_webhook_events (provider, provider_event_id, event_type)
       values ('STRIPE', $1, $2)
       on conflict (provider, provider_event_id) do nothing
       returning provider_event_id`,
      [event.id, event.type],
    );
    if (fresh.length === 0) return true;
    if (completedSession !== null) {
      await ensureProvisioned(tx, context, completedSession.session, completedSession.plan, completedSession.subscription);
    }
    if (changedSubscription !== null) await applySubscriptionChange(tx, context, changedSubscription);
    return false;
  });
  if (duplicate) return json(200, { received: true, duplicate: true });
  return json(200, { received: true });
}

function parseSubscriptionObject(object: Record<string, unknown>): SubscriptionSummary | null {
  const status = typeof object['status'] === 'string' ? object['status'] : null;
  const id = typeof object['id'] === 'string' ? object['id'] : null;
  if (status === null || id === null) return null;
  const items = object['items'] as { data?: unknown } | undefined;
  const first = Array.isArray(items?.data) ? (items.data[0] as Record<string, unknown> | undefined) : undefined;
  const price = first?.['price'] as Record<string, unknown> | undefined;
  const periodEndValue =
    typeof first?.['current_period_end'] === 'number'
      ? (first['current_period_end'] as number)
      : typeof object['current_period_end'] === 'number'
        ? (object['current_period_end'] as number)
        : null;
  return {
    id,
    status,
    customerId: typeof object['customer'] === 'string' ? object['customer'] : null,
    priceId: typeof price?.['id'] === 'string' ? (price['id'] as string) : null,
    currentPeriodEnd: periodEndValue,
    metadata: {},
  };
}

async function openPortal(request: Request, context: BillingContext): Promise<Response> {
  const token = readBearerToken(request.headers.get('authorization'));
  if (token === null || !looksLikeApiKey(token)) {
    return billingError(401, 'UNAUTHORIZED', 'Send your API key as a Bearer token.');
  }
  const rows = await context.driver.query<{ provider_customer_id: string }>(
    `select subscription.provider_customer_id
       from api_keys key
       join api_subscriptions subscription on subscription.tenant_id = key.tenant_id
      where key.token_hash = $1
        and key.revoked_at is null
        and subscription.vertical_id = $2
      order by subscription.created_at desc
      limit 1`,
    [await hashApiKey(token), context.verticalId],
  );
  const customerId = rows[0]?.provider_customer_id;
  if (customerId === undefined) {
    return billingError(404, 'NO_SUBSCRIPTION', 'This key has no self-service subscription.');
  }
  const url = await stripe(context).createBillingPortalSession(customerId, context.config.returnUrl);
  return json(201, { data: { portal_url: url } });
}

/** Returns a response for `/v1/billing/*`, or `null` for any other path. */
export async function serveBilling(request: Request, context: BillingContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const route = path.slice(BILLING_PATH_PREFIX.length);
  const routes: Record<string, { method: string; run: () => Promise<Response> | Response }> = {
    plans: { method: 'GET', run: () => listPlans(context) },
    checkout: { method: 'POST', run: () => startCheckout(request, context) },
    claim: { method: 'GET', run: () => claimKey(request, context) },
    'stripe-webhook': { method: 'POST', run: () => handleWebhook(request, context) },
    portal: { method: 'POST', run: () => openPortal(request, context) },
  };
  const entry = routes[route];
  if (entry === undefined) return billingError(404, 'NOT_FOUND', 'No such billing route.');
  if (method !== entry.method) {
    return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: `Use ${entry.method}.` } }), {
      status: 405,
      headers: { ...JSON_HEADERS, allow: entry.method },
    });
  }
  try {
    return await entry.run();
  } catch (error) {
    if (error instanceof StripeApiError) {
      console.error('[edge] billing provider error', { route, status: error.status, code: error.stripeCode });
      if (error.status === 400 && error.stripeCode === 'invalid_session_id') {
        return billingError(400, 'BAD_REQUEST', 'A valid session_id is required.');
      }
      if (error.status === 404 || error.stripeCode === 'resource_missing') {
        return billingError(404, 'NOT_FOUND', 'The payment provider does not know that checkout.');
      }
      return billingError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider is unavailable. Try again shortly.');
    }
    if (error instanceof BillingConfigurationError) {
      console.error('[edge] billing configuration', { route, code: 'BILLING_CONFIGURATION' });
      return billingError(503, 'SERVICE_UNAVAILABLE', 'Billing is not available on this deployment.');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Monthly allowance (the published "hard stop")
// ---------------------------------------------------------------------------

export interface AllowanceState {
  readonly allowance: number;
  readonly used: number;
}

/**
 * The tenant's allowance and this UTC calendar month's usage, or `null` when
 * no allowance applies (operator-provisioned and marketplace keys).
 *
 * Usage is counted asynchronously by the usage consumer, so a burst can run a
 * few requests past the allowance before the counter catches up. The stop is
 * hard in the sense that matters: it never becomes an overage charge.
 */
export async function readAllowance(
  executor: SqlExecutor,
  tenantId: string,
  now: Date,
): Promise<AllowanceState | null> {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const rows = await executor.query<{ allowance: number; used: string | number | null }>(
    `select allowance.monthly_request_allowance as allowance,
            counter.request_count as used
       from api_tenant_allowances allowance
       left join api_usage_monthly_counters counter
         on counter.tenant_id = allowance.tenant_id and counter.period_month = $2::date
      where allowance.tenant_id = $1`,
    [tenantId, month],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { allowance: Number(row.allowance), used: Number(row.used ?? 0) };
}

export function allowanceExhaustedResponse(request: Request, state: AllowanceState, now: Date): Response {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const body = JSON.stringify({
    error: {
      code: 'ALLOWANCE_EXHAUSTED',
      message:
        `This key has used its ${state.allowance.toLocaleString('en-US')} included requests for this calendar month. ` +
        'Upgrade through POST /v1/billing/portal, or wait for the allowance to reset.',
    },
  });
  const retryAfter = Math.max(1, Math.ceil((nextMonth.getTime() - now.getTime()) / 1000));
  return new Response(request.method.toUpperCase() === 'HEAD' ? null : body, {
    status: 429,
    headers: {
      ...JSON_HEADERS,
      'retry-after': String(retryAfter),
      'x-ratelimit-limit': String(state.allowance),
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': nextMonth.toISOString(),
    },
  });
}
