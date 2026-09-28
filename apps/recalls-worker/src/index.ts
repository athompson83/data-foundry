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
import { docsPage, messagePage, privacyPage, termsPage, welcomePage, type PageContext } from './pages.js';
import { DATASETS, isPublished, publishedDatasets, salesOpen, type DatasetKey } from './catalog.js';
import { datasetPage, homePage, SITE_JS, type Coverage } from './site.js';
import { createCheckoutSession, createPortalSession, currentSubscription, handleStripeWebhook, retrieveCheckoutSession, StripeError, upsertCustomerFromSubscription } from './stripe.js';
import { scheduledSync, syncWindow } from './sync.js';
import { getProductRecall, lookupProductCode, PRODUCT_ID, productStats, searchProductRecalls } from './product-api.js';
import { FIRST_PRODUCT_YEAR, PRODUCT_BROWSE_PAGE_SIZE, PRODUCT_BROWSE_PATTERN, PRODUCT_PAGE_PATTERN, PRODUCT_SITEMAP_PAGE_SIZE, PRODUCT_SITEMAP_PATTERN, productBrowseIndex, productBrowsePage, productIndexableStats, productNoticePage, productSitemap } from './product-pages.js';
import { scheduledProductSync } from './product-sync.js';
import { createIngestCredential, handleIntake, IntakeRefused, revokeIngestCredential, withdrawExtractions } from './intake.js';
import { BROWSE_PATTERN, EDGE_TTL_SECONDS, RECALL_API_PATTERN, RECALL_PAGE_PATTERN, SITEMAP_PATTERN, browseCount, browseInRange, browseIndex, browsePage, indexableCount, shardInRange, llmsFullTxt, llmsTxt, pagesSitemap, pingChangedRecalls, recallPage, recallSitemap, robotsTxt, sitemapIndex, type PresentedRecall } from './seo.js';
import { RECALL_CATEGORIES, type RecallCategory } from '@data-foundry/recall-structuring';

/** The Workers edge cache, declared locally like the other bindings. */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** The CPSC/Health Canada dataset is served only when opened and not withdrawn. */
export function productsServed(env: Env): boolean {
  return env.PRODUCT_RECALLS_OPEN === '1' && env.PRODUCT_RECALLS_KILL_SWITCH !== '1';
}

/** Extracted identifiers (ADR-0017) are served only with the dataset, while their quality gate is open. */
export function extractedServed(env: Env): boolean {
  return productsServed(env) && env.EXTRACTED_IDENTIFIERS_OPEN === '1';
}

function context(env: Env): PageContext {
  return {
    publicOrigin: env.PUBLIC_ORIGIN ?? 'https://data.aroqon.com',
    apiOrigin: env.API_ORIGIN ?? 'https://api.data.aroqon.com',
    supportEmail: env.SUPPORT_EMAIL ?? 'data@mail.proviciency.com',
  };
}

/**
 * Output that depends on a dataset gate (llms files, the pages sitemap, docs, OpenAPI) is sent
 * `no-cache`, so withdrawing a dataset takes effect for every client on its next request.
 * It is rendered from strings, without a database read.
 */
const GATED = 'no-cache';

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
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'",
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
  if (!key) return apiError(401, 'missing_key', 'Send your key as "Authorization: Bearer rcl_live_…". Get one at https://data.aroqon.com/#pricing', { 'www-authenticate': 'Bearer' });
  const customer = await findCustomerByKey(env.DB, key);
  if (!customer) return apiError(401, 'invalid_key', 'Unknown or revoked API key.', { 'www-authenticate': 'Bearer' });
  if (customer.status !== 'active' && customer.status !== 'past_due') return apiError(403, 'subscription_inactive', 'This subscription is not active. Resubscribe at https://data.aroqon.com/#pricing');
  return customer;
}

async function meteredApi(env: Env, request: Request, url: URL): Promise<Response> {
  const products = url.pathname === '/v1/product-recalls' || url.pathname.startsWith('/v1/product-recalls/');
  if (products ? !productsServed(env) : env.SOURCE_KILL_SWITCH === '1') return apiError(503, 'dataset_unavailable', 'The dataset is temporarily unavailable.');
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
  const extracted = extractedServed(env);

  if (url.pathname === '/v1/product-recalls') return json(await searchProductRecalls(env.DB, env.RAW_ARTIFACTS, url.searchParams, extracted), 200, headers);
  if (url.pathname === '/v1/product-recalls/lookup') {
    const code = url.searchParams.get('code');
    if (!code) throw new BadRequest('code is required');
    return json(await lookupProductCode(env.DB, env.RAW_ARTIFACTS, code, includeRaw, extracted), 200, headers);
  }
  const product = /^\/v1\/product-recalls\/([^/]+)$/.exec(url.pathname);
  if (product) {
    // Ids are ASCII letters, digits and hyphens, so the raw segment is matched as is: a malformed
    // percent escape ("%", "%ZZ") is simply not an id, never a decode error.
    const id = (product[1] as string).toLowerCase();
    const found = PRODUCT_ID.test(id) ? await getProductRecall(env.DB, env.RAW_ARTIFACTS, id, includeRaw, extracted) : null;
    return found ? json(found, 200, headers) : apiError(404, 'not_found', 'No notice with that id. Ids look like cpsc-25203 or hc-77184.', headers);
  }
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
  return apiError(404, 'not_found', 'Unknown endpoint. See https://data.aroqon.com/docs');
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
    if (url.pathname === '/v1/product-recalls/stats') {
      if (!productsServed(env)) return apiError(503, 'dataset_unavailable', 'The dataset is temporarily unavailable.');
      const cache = (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;
      const cacheKey = new Request(`${ctx.apiOrigin}/v1/product-recalls/stats`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      const response = json(await productStats(env.DB), 200, { 'cache-control': 'public, max-age=600' });
      await cache.put(cacheKey, response.clone());
      return response;
    }
    if (url.pathname.startsWith('/v1/account')) return accountApi(env, request, url);
    if (url.pathname === '/v1/intake/product-recalls/identifiers') {
      // Ingestion credentials only: a customer key or the admin token is not accepted here, and this path never reads data.
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'POST only.');
      try {
        const result = await handleIntake(env, request);
        return json(result.body, result.status, { 'cache-control': 'no-store' });
      } catch (error) {
        if (error instanceof IntakeRefused) return apiError(error.status, error.code, error.message, { 'cache-control': 'no-store' });
        throw error;
      }
    }
    if (request.method !== 'GET') return apiError(405, 'method_not_allowed', 'Data endpoints accept GET only.');
    return meteredApi(env, request, url);
  }
  if (url.pathname === '/openapi.json') return json(openApiDocument(ctx, { fda: env.SOURCE_KILL_SWITCH !== '1', products: productsServed(env) }), 200, { 'cache-control': GATED });

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

  if (url.pathname === '/admin/ingest-credentials' && request.method === 'POST') {
    // Mint one ingestion-scoped credential (ADR-0017). The token is shown once; only its SHA-256 is stored.
    if (!isAuthorizedAdmin(env, request)) return apiError(404, 'not_found', 'Not found.');
    const sources = (url.searchParams.get('sources') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    return json(await createIngestCredential(env.DB, url.searchParams.get('label') ?? '', sources, new Date().toISOString()), 200, { 'cache-control': 'no-store' });
  }

  if (url.pathname === '/admin/ingest-credentials/revoke' && request.method === 'POST') {
    if (!isAuthorizedAdmin(env, request)) return apiError(404, 'not_found', 'Not found.');
    return json({ revoked: await revokeIngestCredential(env.DB, url.searchParams.get('id') ?? '', new Date().toISOString()) });
  }

  if (url.pathname === '/admin/extractions/withdraw' && request.method === 'POST') {
    if (!isAuthorizedAdmin(env, request)) return apiError(404, 'not_found', 'Not found.');
    return json({ withdrawn: await withdrawExtractions(env.DB, url.searchParams.get('extractor_version') ?? '', url.searchParams.get('recall_id'), new Date().toISOString()) });
  }

  if (isApiHost) {
    if (url.pathname === '/')
      return json({
        name: 'Data Foundry API',
        datasets: {
          // The same independent gates as the homepage, docs and OpenAPI: a withdrawn dataset is not listed.
          // `registry` names the pipeline registry entry, so a client (the local collector) can map what is hosted to its sources.
          ...(env.SOURCE_KILL_SWITCH !== '1' ? { recalls: { name: DATASETS.recalls.name, registry: DATASETS.recalls.registry, docs: `${ctx.publicOrigin}/docs#fda-recalls`, openapi: `${ctx.apiOrigin}/openapi.json`, stats: `${ctx.apiOrigin}${DATASETS.recalls.statsPath}` } } : {}),
          ...(productsServed(env) ? { 'product-recalls': { name: DATASETS['product-recalls'].name, registry: DATASETS['product-recalls'].registry, docs: `${ctx.publicOrigin}/docs#product-recalls`, openapi: `${ctx.apiOrigin}/openapi.json`, stats: `${ctx.apiOrigin}${DATASETS['product-recalls'].statsPath}` } } : {}),
        },
      });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    return apiError(404, 'not_found', 'Unknown endpoint. See https://data.aroqon.com/docs');
  }

  switch (url.pathname) {
    case '/': {
      const published = publishedDatasets(env);
      // The cache key names the published datasets and the sales gate, so a withdrawn dataset or a closed gate never
      // serves a cached page that still lists or sells it.
      const variant = `${published.map((entry) => entry.key).join('+') || 'none'}/${salesOpen(env) ? 'open' : 'closed'}`;
      return cached(cacheKey(ctx, `/_home/${variant}`), async () => {
        const datasets = await Promise.all(published.map(async (entry) => ({ entry, coverage: await coverage(env, entry.key) })));
        return html(homePage(ctx, { datasets, salesOpen: salesOpen(env) }), 200, { 'cache-control': 'public, max-age=300' });
      });
    }
    case '/assets/site.js':
      return new Response(SITE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', ...SECURITY_HEADERS } });
    case '/product-recalls':
      return datasetRoute(env, ctx, 'product-recalls');
    case '/product-recalls/browse':
      if (!productsServed(env)) return withdrawn(ctx);
      return cached(cacheKey(ctx, url.pathname), async () => html(await productBrowseIndex(ctx, env.DB), 200, { 'cache-control': 'public, max-age=3600' }));
    case '/recalls':
      return datasetRoute(env, ctx, 'recalls');
    case '/recalls/docs':
      return Response.redirect(`${ctx.publicOrigin}/docs`, 301);
    case '/docs':
      return html(docsPage(ctx, { fda: env.SOURCE_KILL_SWITCH !== '1', products: productsServed(env) }), 200, { 'cache-control': GATED });
    case '/terms':
      return html(termsPage(ctx), 200, { 'cache-control': 'public, max-age=3600' });
    case '/privacy':
      return html(privacyPage(ctx), 200, { 'cache-control': 'public, max-age=3600' });
    case '/recalls/checkout':
      if (request.method !== 'POST') return Response.redirect(`${ctx.publicOrigin}/#pricing`, 303);
      return checkout(env, request);
    case '/recalls/welcome':
      return welcome(env, url);
    case '/stripe/webhook':
      if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'POST only.');
      return handleStripeWebhook(env, request);
    case '/robots.txt':
      return text(robotsTxt(ctx), 'text/plain', 3600);
    case '/llms.txt':
      return text(llmsTxt(ctx, { fda: env.SOURCE_KILL_SWITCH !== '1', products: productsServed(env) }), 'text/markdown', GATED);
    case '/llms-full.txt':
      return text(llmsFullTxt(ctx, { fda: env.SOURCE_KILL_SWITCH !== '1', products: productsServed(env) }), 'text/markdown', GATED);
    case '/sitemap.xml': {
      const fda = env.SOURCE_KILL_SWITCH !== '1';
      const products = productsServed(env);
      if (!fda && !products) return withdrawn(ctx);
      // The cache key names the datasets included, so withdrawing one never serves a cached index that lists it.
      return cached(cacheKey(ctx, `${url.pathname}/${fda ? 'f' : ''}${products ? 'p' : ''}`), async () => {
        const productShards = products ? await productIndexableStats(env.DB) : null;
        const body = await sitemapIndex(ctx, env.DB, {
          fda,
          products: productShards ? { shards: Math.ceil(productShards.n / PRODUCT_SITEMAP_PAGE_SIZE), last: productShards.last } : null,
        });
        return text(body, 'application/xml', 3600);
      });
    }
    case '/sitemaps/pages.xml':
      return text(pagesSitemap(ctx, { fda: env.SOURCE_KILL_SWITCH !== '1', products: productsServed(env) }), 'application/xml', GATED);
    case '/recalls/browse':
      if (env.SOURCE_KILL_SWITCH === '1') return withdrawn(ctx);
      return cached(cacheKey(ctx, url.pathname), async () => html(await browseIndex(ctx, env.DB), 200, { 'cache-control': 'public, max-age=3600' }));
    default:
      return publicDataPage(env, ctx, request, url);
  }
}

function text(body: string, contentType: string, maxAge: number | typeof GATED): Response {
  return new Response(body, { headers: { 'content-type': `${contentType}; charset=utf-8`, 'cache-control': maxAge === GATED ? GATED : `public, max-age=${maxAge}`, ...SECURITY_HEADERS } });
}

/**
 * The cache key is the canonical URL — the path plus only the parameters that
 * change the response — so nonce query strings cannot force D1 reads.
 */
function cacheKey(ctx: PageContext, pathname: string, page?: number): Request {
  return new Request(`${ctx.publicOrigin}${pathname}${page && page > 1 ? `?page=${page}` : ''}`, { method: 'GET' });
}

const withdrawn = (ctx: PageContext) => html(messagePage(ctx, 'Temporarily unavailable', 'This dataset is temporarily unavailable.'), 503, { 'cache-control': 'no-store' });


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
  if (PRODUCT_PAGE_PATTERN.test(url.pathname) || PRODUCT_BROWSE_PATTERN.test(url.pathname) || PRODUCT_SITEMAP_PATTERN.test(url.pathname)) return productDataPage(env, ctx, request, url);
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
  // Bound shards by the data: one cached count, so unique shard numbers past
  // the end cannot each become a large-OFFSET D1 query.
  const counted = await cached(cacheKey(ctx, '/sitemaps/count'), async () => text(String(await indexableCount(env.DB)), 'text/plain', 3600));
  if (!shardInRange(Number(sitemap[1]), Number(await counted.text()))) return notFound(ctx);
  return cached(
    cacheKey(ctx, url.pathname),
    async () => {
      const body = await recallSitemap(ctx, env.DB, Number(sitemap[1]));
      return body ? text(body, 'application/xml', 3600) : notFound(ctx);
    },
    { cacheMisses: true },
  );
}

/** Public coverage for a dataset, from the same queries as its stats endpoint. */
async function coverage(env: Env, key: DatasetKey): Promise<Coverage | null> {
  try {
    if (key === 'recalls') {
      const s = (await stats(env.DB)) as { categories: Array<{ category: string; recalls: number; latest_report: string | null }>; last_successful_sync: string | null };
      return {
        records: s.categories.reduce((total, row) => total + row.recalls, 0),
        breakdown: s.categories.map((row) => `${row.category} ${row.recalls.toLocaleString('en-US')}`).join(' · '),
        latestRecord: s.categories.map((row) => row.latest_report).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
        lastSuccessfulSync: s.last_successful_sync,
      };
    }
    const s = (await productStats(env.DB)) as { agencies: Array<{ agency: string; notices: number; latest: string | null }>; last_successful_sync: Record<string, string> };
    const syncs = Object.values(s.last_successful_sync).sort();
    return {
      records: s.agencies.reduce((total, row) => total + row.notices, 0),
      breakdown: s.agencies.map((row) => `${row.agency === 'HC' ? 'Health Canada' : row.agency} ${row.notices.toLocaleString('en-US')}`).join(' · '),
      latestRecord: s.agencies.map((row) => row.latest).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
      // The oldest of the per-source last successes: every source has refreshed at least that recently.
      lastSuccessfulSync: syncs.length === s.agencies.length ? (syncs[0] ?? null) : null,
    };
  } catch (error) {
    console.error('coverage_error', key, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** A dataset's product page, withdrawn with the dataset. */
function datasetRoute(env: Env, ctx: PageContext, key: DatasetKey): Promise<Response> | Response {
  if (!isPublished(env, key)) return withdrawn(ctx);
  const entry = DATASETS[key];
  return cached(cacheKey(ctx, `/_dataset/${key}/${salesOpen(env) ? 'open' : 'closed'}`), async () =>
    html(datasetPage(ctx, entry, await coverage(env, key), salesOpen(env)), 200, { 'cache-control': 'public, max-age=300' }),
  );
}

/** Product-recall notice pages, year hubs and sitemap shards. */
async function productDataPage(env: Env, ctx: PageContext, request: Request, url: URL): Promise<Response> {
  if (!productsServed(env)) return withdrawn(ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'GET only.');
  const notice = PRODUCT_PAGE_PATTERN.exec(url.pathname);
  if (notice) {
    return cached(
      cacheKey(ctx, url.pathname),
      async () => {
        const body = await productNoticePage(ctx, env.DB, notice[1] as string);
        return body ? html(body, 200, { 'cache-control': 'public, max-age=3600' }) : notFound(ctx);
      },
      { cacheMisses: true },
    );
  }
  const browse = PRODUCT_BROWSE_PATTERN.exec(url.pathname);
  if (browse) {
    const pageParam = url.searchParams.get('page') ?? '1';
    const page = /^[1-9]\d{0,3}$/.test(pageParam) ? Number(pageParam) : 0;
    const [, agency, year] = browse as unknown as [string, string, string];
    if (!page || Number(year) < FIRST_PRODUCT_YEAR || Number(year) > new Date().getUTCFullYear()) return notFound(ctx);
    const counted = await cached(cacheKey(ctx, `/product-recalls/browse/${agency}/${year}/count`), async () => {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM product_recall WHERE agency = ? AND sort_date >= ? AND sort_date < ?').bind(agency.toUpperCase(), `${year}-01-01`, `${Number(year) + 1}-01-01`).first<{ n: number }>();
      return text(String(row?.n ?? 0), 'text/plain', 3600);
    });
    if ((page - 1) * PRODUCT_BROWSE_PAGE_SIZE >= Number(await counted.text())) return notFound(ctx);
    return cached(
      cacheKey(ctx, url.pathname, page),
      async () => {
        const body = await productBrowsePage(ctx, env.DB, agency, year, page);
        return body ? html(body, 200, { 'cache-control': 'public, max-age=3600' }) : notFound(ctx);
      },
      { cacheMisses: true },
    );
  }
  const shard = Number((PRODUCT_SITEMAP_PATTERN.exec(url.pathname) as RegExpExecArray)[1]);
  const counted = await cached(cacheKey(ctx, '/sitemaps/product-count'), async () => text(String((await productIndexableStats(env.DB)).n), 'text/plain', 3600));
  if ((shard - 1) * PRODUCT_SITEMAP_PAGE_SIZE >= Number(await counted.text())) return notFound(ctx);
  return cached(
    cacheKey(ctx, url.pathname),
    async () => {
      const body = await productSitemap(ctx, env.DB, shard);
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

  async scheduled(controller: { scheduledTime?: number } | undefined, env: Env): Promise<void> {
    const started = new Date().toISOString();
    const results = await scheduledSync(env);
    console.log('recall_sync', JSON.stringify(results));
    // The product-recall dataset loads while closed, so acquisition runs unless its kill switch is set.
    // The first run of each UTC day also re-reads the full CPSC list.
    const hour = new Date(controller?.scheduledTime ?? Date.now()).getUTCHours();
    console.log('product_recall_sync', JSON.stringify(await scheduledProductSync(env, { full: hour < 6 })));
    // A withdrawn dataset is not announced to search engines, and its IndexNow
    // watermark stays put so pending pages are retried after reactivation.
    if (env.SOURCE_KILL_SWITCH === '1') return;
    console.log('indexnow', JSON.stringify(await pingChangedRecalls(context(env), env.DB, env.RAW_ARTIFACTS, env.INDEXNOW_KEY, started)));
  },
};
