/**
 * Data Foundry Recall Intelligence Worker (ADR-0015).
 *
 *   data.aroqon.com      human pages, checkout, Stripe webhook
 *   api.data.aroqon.com  /v1 machine API
 *
 * One Worker, one D1 database, one R2 evidence prefix. The Cron trigger keeps
 * the dataset current from openFDA.
 */

import { consumeRequest, currentUsage, findCustomerByKey, isPlanId, issueFreeKey, issueKey, PLANS, replaceKey, presentedKey, type AuthenticatedCustomer } from './account.js';
import { BadRequest, getRecall, lookupCode, searchRecalls, stats } from './api.js';
import type { Env } from './env.js';
import { openApiDocument } from './openapi.js';
import { catalogPage, docsPage, messagePage, privacyPage, recallsLanding, termsPage, welcomePage, type PageContext } from './pages.js';
import { createCheckoutSession, createPortalSession, currentSubscription, handleStripeWebhook, retrieveCheckoutSession, StripeError, upsertCustomerFromSubscription } from './stripe.js';
import { scheduledSync, syncWindow } from './sync.js';
import { BROWSE_PATTERN, RECALL_API_PATTERN, RECALL_PAGE_PATTERN, SITEMAP_PATTERN, browseCount, browseInRange, browseIndex, browsePage, llmsFullTxt, llmsTxt, pagesSitemap, pingChangedRecalls, recallPage, recallSitemap, robotsTxt, sitemapIndex, type PresentedRecall } from './seo.js';
import { RECALL_CATEGORIES, type RecallCategory } from '@data-foundry/recall-structuring';

/** The Workers edge cache, declared locally like the other bindings. */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function context(env: Env): PageContext {
  return {
    publicOrigin: env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com',
    apiOrigin: env.API_ORIGIN ?? 'https://api.data.aroqon.com',
    supportEmail: env.SUPPORT_EMAIL ?? 'data@mail.proviciency.com',
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...SECURITY_HEADERS, ...extra },
  });
}

function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, extra);
}

async function authenticate(env: Env, request: Request): Promise<AuthenticatedCustomer | Response> {
  const key = presentedKey(request);
  if (!key) return apiError(401, 'missing_key', 'Send your key as "Authorization: Bearer rcl_live_…". Get one at https://data.aroqon.com/recalls#pricing', { 'www-authenticate': 'Bearer' });
  const customer = await findCustomerByKey(env.DB, key);
  if (!customer) return apiError(401, 'invalid_key', 'Unknown or revoked API key.', { 'www-authenticate': 'Bearer' });
  if (customer.status !== 'active' && customer.status !== 'past_due') return apiError(403, 'subscription_inactive', 'This subscription is not active. Resubscribe at https://data.aroqon.com/recalls#pricing');
  return customer;
}

async function meteredApi(env: Env, request: Request, url: URL): Promise<Response> {
  if (env.SOURCE_KILL_SWITCH === '1') return apiError(503, 'dataset_unavailable', 'The dataset is temporarily unavailable.');
  const auth = await authenticate(env, request);
  if (auth instanceof Response) return auth;
  const count = await consumeRequest(env.DB, auth);
  const limit = PLANS[auth.plan].requests;
  if (count === null) {
    return apiError(429, 'allowance_exhausted', `Your ${PLANS[auth.plan].name} allowance of ${limit} requests this month is used. Upgrade via POST /v1/account/billing-portal.`, {
      'x-ratelimit-limit': String(limit),
      'x-ratelimit-remaining': '0',
    });
  }
  const headers = { 'x-ratelimit-limit': String(limit), 'x-ratelimit-remaining': String(Math.max(0, limit - count)), 'cache-control': 'private, no-store' };
  const includeRaw = url.searchParams.get('include') === 'raw';

  if (url.pathname === '/v1/recalls') return json(await searchRecalls(env.DB, env.RAW_ARTIFACTS, url.searchParams), 200, headers);
  if (url.pathname === '/v1/recalls/lookup') {
    const code = url.searchParams.get('code');
    if (!code) throw new BadRequest('code is required');
    return json(await lookupCode(env.DB, env.RAW_ARTIFACTS, code, includeRaw), 200, headers);
  }
  const match = RECALL_API_PATTERN.exec(url.pathname);
  if (match) {
    const found = await getRecall(env.DB, env.RAW_ARTIFACTS, match[1] as string, includeRaw);
    return found ? json(found, 200, headers) : apiError(404, 'not_found', 'No recall with that number.', headers);
  }
  return apiError(404, 'not_found', 'Unknown endpoint. See https://data.aroqon.com/recalls/docs');
}

async function accountApi(env: Env, request: Request, url: URL): Promise<Response> {
  const auth = await authenticate(env, request);
  if (auth instanceof Response) {
    // A canceled customer may still open the billing portal to resubscribe.
    if (url.pathname !== '/v1/account/billing-portal' || auth.status !== 403) return auth;
    const key = presentedKey(request);
    const customer = key ? await findCustomerByKey(env.DB, key) : null;
    if (!customer?.stripeCustomerId) return auth;
    return json({ url: await createPortalSession(env, customer.stripeCustomerId) });
  }
  if (url.pathname === '/v1/account' && request.method === 'GET') {
    const used = await currentUsage(env.DB, auth.customerId);
    const plan = PLANS[auth.plan];
    return json({ plan: auth.plan, plan_name: plan.name, status: auth.status, month_requests: used, month_allowance: plan.requests, remaining: Math.max(0, plan.requests - used) }, 200, { 'cache-control': 'private, no-store' });
  }
  if (url.pathname === '/v1/account/rotate-key' && request.method === 'POST') {
    const key = await replaceKey(env.DB, auth.customerId, auth.keyId);
    return json({ api_key: key, note: 'The previous key is revoked. Store this one now; it is not shown again.' }, 200, { 'cache-control': 'no-store' });
  }
  if (url.pathname === '/v1/account/billing-portal' && request.method === 'POST') {
    if (!auth.stripeCustomerId) return apiError(409, 'no_billing_account', 'This key has no billing account.');
    return json({ url: await createPortalSession(env, auth.stripeCustomerId) });
  }
  return apiError(405, 'method_not_allowed', 'Unsupported method for this endpoint.');
}

async function checkout(env: Env, request: Request): Promise<Response> {
  const form = await request.formData();
  const plan = form.get('plan');
  if (!isPlanId(plan)) return html(messagePage(context(env), 'Unknown plan', 'Please choose a plan from the pricing table.'), 400);
  if (env.SALES_OPEN !== '1') {
    const ctx = context(env);
    return html(messagePage(ctx, 'Opening shortly', `Sign-ups open in a few hours while the dataset finishes loading. Email <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a> to be notified.`), 503);
  }
  const session = await createCheckoutSession(env, plan);
  if (!session.url) throw new StripeError('Checkout session has no URL', 502);
  return Response.redirect(session.url, 303);
}

async function welcome(env: Env, url: URL): Promise<Response> {
  const ctx = context(env);
  const sessionId = url.searchParams.get('session_id') ?? '';
  const session = await retrieveCheckoutSession(env, sessionId);
  if (session.status !== 'complete' || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) {
    return html(messagePage(ctx, 'Checkout not complete', 'We have not received confirmation of this checkout yet. If you completed payment, refresh this page in a few seconds.'), 402);
  }
  const subscription = session.subscription;
  if (!subscription || typeof subscription === 'string') throw new StripeError('Checkout session has no subscription', 502);
  const sessionSubscription = { id: subscription.id, customer: session.customer ?? '', status: subscription.status, items: subscription.items, metadata: session.metadata ?? {} };
  // Revisiting an old Checkout must not revive or overwrite state: apply the
  // customer's current subscription as Stripe reports it.
  const customerId = await upsertCustomerFromSubscription(
    env.DB,
    env,
    session.customer ? await currentSubscription(env, session.customer, sessionSubscription) : sessionSubscription,
    session.customer_details?.email ?? null,
  );
  if (!customerId) throw new StripeError('Subscription plan is not recognised', 502);
  const email = session.customer_details?.email ?? null;
  const customer = await env.DB.prepare('SELECT plan FROM customer WHERE id = ?').bind(customerId).first<{ plan: keyof typeof PLANS }>();
  const alreadyIssued = () => html(messagePage(ctx, 'Free key already issued', `A free Evaluate key was already issued to this email. Use that key, rotate it with <code>POST /v1/account/rotate-key</code>, or choose a paid plan. Questions: <a href="mailto:${ctx.supportEmail}">${ctx.supportEmail}</a>.`), 409);
  try {
    // One free key per email: each $0 checkout creates a fresh Stripe customer,
    // so without this the Evaluate allowance could be multiplied at will.
    if (customer?.plan === 'evaluate') {
      if (!email) return html(messagePage(ctx, 'Email required', 'A free key needs an email address. Please check out again with one.'), 400);
      const key = await issueFreeKey(env.DB, customerId, email, session.id);
      if (!key) return alreadyIssued();
      return html(welcomePage(ctx, key, PLANS.evaluate.name), 200, { 'cache-control': 'no-store' });
    }
    const key = await issueKey(env.DB, customerId, session.id);
    return html(welcomePage(ctx, key, PLANS[customer?.plan ?? 'evaluate'].name), 200, { 'cache-control': 'no-store' });
  } catch (error) {
    // Only the unique checkout_session_id conflict means "already issued" (a
    // concurrent reload won). Anything else is an operational failure and must
    // surface as a retryable error, not as misleading recovery guidance.
    const won = await env.DB.prepare('SELECT id FROM api_key WHERE checkout_session_id = ?').bind(session.id).first<{ id: string }>();
    if (won) return html(messagePage(ctx, 'Key already issued', 'An API key was already shown for this checkout.'), 409);
    throw error;
  }
}

function isAuthorizedAdmin(env: Env, request: Request): boolean {
  const token = env.ADMIN_TOKEN;
  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || token.length < 32 || presented.length !== token.length) return false;
  let diff = 0;
  for (let index = 0; index < token.length; index += 1) diff |= token.charCodeAt(index) ^ presented.charCodeAt(index);
  return diff === 0;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ctx = context(env);
  const apiHost = new URL(ctx.apiOrigin).host;
  const isApiHost = url.host === apiHost;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, x-api-key, content-type', 'access-control-max-age': '86400' } });
  }

  if (url.pathname.startsWith('/v1/')) {
    if (!isApiHost && url.host.endsWith('aroqon.com')) return Response.redirect(`${ctx.apiOrigin}${url.pathname}${url.search}`, 308);
    // The kill switch withdraws every dataset-derived response, cached or not.
    if (env.SOURCE_KILL_SWITCH === '1' && url.pathname.startsWith('/v1/recalls')) return apiError(503, 'dataset_unavailable', 'The dataset is temporarily unavailable.');
    if (url.pathname === '/v1/recalls/stats') {
      const cache = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
      const cacheKey = new Request(`${ctx.apiOrigin}/v1/recalls/stats`);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      const response = json(await stats(env.DB), 200, { 'cache-control': 'public, max-age=600' });
      await cache.put(cacheKey, response.clone());
      return response;
    }
    if (url.pathname.startsWith('/v1/account')) return accountApi(env, request, url);
    if (request.method !== 'GET') return apiError(405, 'method_not_allowed', 'Data endpoints accept GET only.');
    return meteredApi(env, request, url);
  }
  if (url.pathname === '/openapi.json') return json(openApiDocument(ctx), 200, { 'cache-control': 'public, max-age=3600' });

  if (url.pathname === '/admin/sync' && request.method === 'POST') {
    if (!isAuthorizedAdmin(env, request)) return apiError(404, 'not_found', 'Not found.');
    const category = url.searchParams.get('category') as RecallCategory | null;
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!category || !RECALL_CATEGORIES.includes(category) || !from || !to) throw new BadRequest('category, from and to are required');
    return json(await syncWindow(env, category, from, to));
  }

  if (url.pathname === '/admin/reissue-key' && request.method === 'POST') {
    // Lost-key recovery (docs/owner-actions/recalls-operations.md): an operator
    // who has verified the requester against the Stripe customer's email
    // revokes every key and issues one new key for that customer.
    if (!isAuthorizedAdmin(env, request)) return apiError(404, 'not_found', 'Not found.');
    const stripeCustomerId = url.searchParams.get('stripe_customer_id') ?? '';
    const customer = await env.DB.prepare('SELECT id, email, plan, status FROM customer WHERE stripe_customer_id = ?').bind(stripeCustomerId).first<{ id: string; email: string | null; plan: string; status: string }>();
    if (!customer) return apiError(404, 'not_found', 'No customer with that Stripe id.');
    const key = await replaceKey(env.DB, customer.id, null);
    return json({ api_key: key, email: customer.email, plan: customer.plan, status: customer.status }, 200, { 'cache-control': 'no-store' });
  }

  if (isApiHost) {
    if (url.pathname === '/') return json({ name: 'Data Foundry API', datasets: { recalls: { docs: `${ctx.publicOrigin}/recalls/docs`, openapi: `${ctx.apiOrigin}/openapi.json` } } });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    return apiError(404, 'not_found', 'Unknown endpoint. See https://data.aroqon.com/recalls/docs');
  }

  switch (url.pathname) {
    case '/':
      return html(catalogPage(ctx), 200, { 'cache-control': 'public, max-age=300' });
    case '/recalls':
      return html(recallsLanding(ctx), 200, { 'cache-control': 'public, max-age=300' });
    case '/recalls/docs':
    case '/docs':
      return html(docsPage(ctx), 200, { 'cache-control': 'public, max-age=300' });
    case '/terms':
      return html(termsPage(ctx), 200, { 'cache-control': 'public, max-age=3600' });
    case '/privacy':
      return html(privacyPage(ctx), 200, { 'cache-control': 'public, max-age=3600' });
    case '/recalls/checkout':
      if (request.method !== 'POST') return Response.redirect(`${ctx.publicOrigin}/recalls#pricing`, 303);
      return checkout(env, request);
    case '/recalls/welcome':
      return welcome(env, url);
    case '/stripe/webhook':
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'POST only.');
      return handleStripeWebhook(env, request);
    case '/robots.txt':
      return text(robotsTxt(ctx), 'text/plain', 3600);
    case '/llms.txt':
      return text(llmsTxt(ctx), 'text/markdown', 3600);
    case '/llms-full.txt':
      return text(llmsFullTxt(ctx), 'text/markdown', 3600);
    case '/sitemap.xml':
      if (env.SOURCE_KILL_SWITCH === '1') return withdrawn(ctx);
      return cached(cacheKey(ctx, url.pathname), () => sitemapIndex(ctx, env.DB).then((body) => text(body, 'application/xml', 3600)));
    case '/sitemaps/pages.xml':
      return text(pagesSitemap(ctx), 'application/xml', 3600);
    case '/recalls/browse':
      if (env.SOURCE_KILL_SWITCH === '1') return withdrawn(ctx);
      return cached(cacheKey(ctx, url.pathname), async () => html(await browseIndex(ctx, env.DB), 200, { 'cache-control': 'public, max-age=3600' }));
    default:
      return publicDataPage(env, ctx, request, url);
  }
}

function text(body: string, contentType: string, maxAge: number): Response {
  return new Response(body, { headers: { 'content-type': `${contentType}; charset=utf-8`, 'cache-control': `public, max-age=${maxAge}`, ...SECURITY_HEADERS } });
}

/**
 * The cache key is the canonical URL — the path plus only the parameters that
 * change the response — so nonce query strings cannot force D1 reads.
 */
function cacheKey(ctx: PageContext, pathname: string, page?: number): Request {
  return new Request(`${ctx.publicOrigin}${pathname}${page && page > 1 ? `?page=${page}` : ''}`, { method: 'GET' });
}

const withdrawn = (ctx: PageContext) => html(messagePage(ctx, 'Temporarily unavailable', 'This dataset is temporarily unavailable.'), 503, { 'cache-control': 'no-store' });

/** How long the Worker's own edge cache keeps a D1-backed page. */
const EDGE_TTL_SECONDS = 3600;

/**
 * Serve a D1-backed public page from the Workers edge cache, so crawler
 * traffic does not become D1 load. Only this cache, which sits behind the
 * kill-switch check, may hold a copy: clients and intermediaries get
 * `no-cache`, so a withdrawn dataset disappears on their next request.
 * `cacheMisses` also keeps 404s (unknown recalls, browse pages and sitemap
 * shards past the end) for the same hour, so a repeated miss cannot force
 * repeated D1 queries; a newly published recall's page appears within the hour.
 */
async function cached(key: Request, render: () => Promise<Response>, options: { cacheMisses?: boolean } = {}): Promise<Response> {
  const cache = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
  const forClient = (response: Response) => {
    const out = new Response(response.body, response);
    out.headers.set('cache-control', 'no-cache');
    return out;
  };
  const hit = await cache.match(key);
  if (hit) return forClient(hit);
  const response = await render();
  if (response.status === 200 || (options.cacheMisses && response.status === 404)) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set('cache-control', `public, max-age=${EDGE_TTL_SECONDS}`);
    await cache.put(key, stored);
  }
  return forClient(response);
}

const notFound = (ctx: PageContext) => html(messagePage(ctx, 'Not found', 'That page does not exist.'), 404);

/** Per-recall pages, year hubs, sitemap files and the IndexNow key file. */
async function publicDataPage(env: Env, ctx: PageContext, request: Request, url: URL): Promise<Response> {
  if (env.INDEXNOW_KEY && url.pathname === `/${env.INDEXNOW_KEY}.txt`) return text(env.INDEXNOW_KEY, 'text/plain', 86400);
  const isData = RECALL_PAGE_PATTERN.test(url.pathname) || BROWSE_PATTERN.test(url.pathname) || SITEMAP_PATTERN.test(url.pathname);
  if (!isData) return notFound(ctx);
  // The kill switch withdraws every dataset-derived response, pages included.
  if (env.SOURCE_KILL_SWITCH === '1') return withdrawn(ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'GET only.');

  const recall = RECALL_PAGE_PATTERN.exec(url.pathname);
  if (recall) {
    return cached(
      cacheKey(ctx, url.pathname),
      async () => {
        const found = await getRecall(env.DB, env.RAW_ARTIFACTS, recall[1] as string, false);
        if (!found) return notFound(ctx);
        return html(recallPage(ctx, found['data'] as PresentedRecall), 200, { 'cache-control': 'public, max-age=3600' });
      },
      { cacheMisses: true },
    );
  }
  const browse = BROWSE_PATTERN.exec(url.pathname);
  if (browse) {
    const pageParam = url.searchParams.get('page') ?? '1';
    const page = /^[1-9]\d{0,3}$/.test(pageParam) ? Number(pageParam) : 0;
    const [, category, year] = browse as unknown as [string, string, string];
    if (!page || !browseInRange(year, 1, 1)) return notFound(ctx);
    // Bound pagination by the data: one cached count per category and year, so
    // unique out-of-range page numbers cannot each become a D1 OFFSET query.
    const counted = await cached(cacheKey(ctx, `/recalls/browse/${category}/${year}/count`), async () => text(String(await browseCount(env.DB, category, year)), 'text/plain', 3600));
    const total = Number(await counted.text());
    if (!browseInRange(year, page, total)) return notFound(ctx);
    return cached(
      cacheKey(ctx, url.pathname, page),
      async () => {
        const body = await browsePage(ctx, env.DB, browse[1] as string, browse[2] as string, page);
        return body ? html(body, 200, { 'cache-control': 'public, max-age=3600' }) : notFound(ctx);
      },
      { cacheMisses: true },
    );
  }
  const sitemap = SITEMAP_PATTERN.exec(url.pathname) as RegExpExecArray;
  return cached(
    cacheKey(ctx, url.pathname),
    async () => {
      const body = await recallSitemap(ctx, env.DB, Number(sitemap[1]));
      return body ? text(body, 'application/xml', 3600) : notFound(ctx);
    },
    { cacheMisses: true },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof BadRequest) return apiError(400, 'invalid_request', error.message);
      if (error instanceof StripeError) {
        console.error('stripe_error', error.status, error.message);
        return apiError(error.status >= 500 || error.status === 503 ? 503 : 400, 'billing_error', error.status === 400 ? error.message : 'Billing is temporarily unavailable. Please try again shortly.');
      }
      console.error('unhandled_error', error instanceof Error ? error.message : String(error));
      return apiError(500, 'internal_error', 'Something went wrong. Please retry; if it persists contact data@mail.proviciency.com.');
    }
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const started = new Date().toISOString();
    const results = await scheduledSync(env);
    console.log('recall_sync', JSON.stringify(results));
    console.log('indexnow', JSON.stringify(await pingChangedRecalls(context(env), env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, started)));
  },
};
