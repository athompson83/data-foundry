import { runtimeSchema as z } from '@data-foundry/query-model';
import { escapeAttr, escapeHtml, layout, renderList } from './render.js';

const listingUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'rapidapi.com' && url.port === '' &&
    url.username === '' && url.password === '' && url.search === '' && url.hash === '' &&
    /^\/[a-zA-Z0-9_-]+\/api\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname);
}, 'Listing URL must be an actual HTTPS RapidAPI API listing without credentials or query parameters');

const policyUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
}, 'Policy URLs must be HTTPS without credentials, query parameters or fragments');
const approvedPolicy = z.strictObject({ approved: z.literal(true), url: policyUrl });

/**
 * The direct self-service channel (ADR-0014). `api_origin` is the bare HTTPS
 * origin of the direct API deployment that owns `/v1/billing/*`; `path_prefix`
 * is an optional vertical path segment in front of `/v1` when the canonical API
 * host routes vertical-scoped paths (ADR-0012). Empty means the billing routes
 * sit at the origin root, which is what the per-vertical edge Worker serves.
 */
const apiOrigin = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value;
}, 'Direct checkout api_origin must be a bare HTTPS origin without path, trailing slash, credentials, query or fragment');
const DirectCheckoutSchema = z.strictObject({
  api_origin: apiOrigin,
  path_prefix: z.string().max(100).regex(/^(\/[a-z0-9][a-z0-9_-]*)*$/, 'Direct checkout path_prefix must be empty or lowercase /segments without a trailing slash'),
});
export type DirectCheckout = ReturnType<typeof DirectCheckoutSchema.parse>;

/**
 * The plan code the direct billing API accepts. Mirrors `planCode` in
 * `@data-foundry/billing` (which `apps/web` may not import): the lowercased
 * plan name with runs of other characters collapsed to `-`.
 */
export function planCode(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const PLAN_CODE = /^[a-z][a-z0-9_-]{0,62}$/;

/** The checkout form action for a configured direct channel. */
export function directCheckoutAction(checkout: DirectCheckout): string {
  return `${checkout.api_origin}${checkout.path_prefix}/v1/billing/checkout`;
}

export const ProductOfferSchema = z.strictObject({
  title: z.string().min(1).max(160),
  lookup_entity_type: z.string().regex(/^[a-z][a-z0-9_]*$/),
  audience: z.string().min(1).max(300),
  summary: z.string().min(1).max(500),
  availability: z.enum(['prelaunch', 'available']),
  listing_url: listingUrl.nullable(),
  direct_checkout: DirectCheckoutSchema.optional(),
  terms_policy: approvedPolicy.optional(),
  privacy_policy: approvedPolicy.optional(),
  support_contact: z.strictObject({ approved: z.literal(true), email: z.string().email().max(254) }).optional(),
  coverage: z.string().min(1).max(1200),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
  plans: z.array(z.object({ name: z.string().min(1).max(50), monthly_usd: z.number().nonnegative(), included_requests: z.number().int().positive() })).min(1).max(8),
}).refine((offer) => offer.availability !== 'available' || ((offer.listing_url !== null || offer.direct_checkout !== undefined) && offer.terms_policy !== undefined && offer.privacy_policy !== undefined && offer.support_contact !== undefined), 'Available plans require a marketplace listing or direct checkout, and explicitly approved terms, privacy and support configuration')
  .refine((offer) => {
    if (offer.direct_checkout === undefined) return true;
    const codes = offer.plans.filter((plan) => plan.monthly_usd > 0).map((plan) => planCode(plan.name));
    return codes.every((code) => PLAN_CODE.test(code)) && new Set(codes).size === codes.length;
  }, 'Direct checkout requires every paid plan name to yield a unique valid plan code');
export type ProductOffer = ReturnType<typeof ProductOfferSchema.parse>;

export function productNavigation(prefix: string): string {
  return `<nav class="product-nav" aria-label="Dataset navigation"><a href="${escapeAttr(prefix)}">Overview</a><a href="${escapeAttr(prefix)}/search">Browse data</a><a href="${escapeAttr(prefix)}/docs">Developer guide</a><a href="${escapeAttr(prefix)}/pricing">Pricing</a></nav>`;
}

export function offerIntro(offer: ProductOffer, prefix: string): string {
  return `${productNavigation(prefix)}<section class="hero"><p class="eyebrow">${escapeHtml(offer.audience)}</p><h1>${escapeHtml(offer.title)}</h1><p class="lede">${escapeHtml(offer.summary)}</p><div class="actions"><a class="button" href="${escapeAttr(prefix)}/search">Look up equipment</a><a class="button secondary" href="${escapeAttr(prefix)}/docs">Start integrating</a></div><p class="evidence">${offer.availability === 'prelaunch' ? 'Preparing for launch. Plans and coverage are being validated.' : offer.listing_url === null ? 'Subscribe directly from the pricing page.' : 'Confirm current availability and terms on the marketplace listing.'}</p></section>`;
}

export function coverageContent(offer: ProductOffer): string {
  return `<section><h2>Coverage and limitations</h2><p>${escapeHtml(offer.coverage)}</p>${renderList(offer.limitations.map(escapeHtml))}</section>`;
}

/** Direct purchase is offered only for an available offer with a configured direct channel (policies are enforced by the schema). */
export function directCheckoutAvailable(offer: ProductOffer): boolean {
  return offer.availability === 'available' && offer.direct_checkout !== undefined;
}

function checkoutForm(checkout: DirectCheckout, planName: string): string {
  const code = planCode(planName);
  const id = `checkout-email-${code}`;
  return `<form class="checkout" method="post" action="${escapeAttr(directCheckoutAction(checkout))}"><input type="hidden" name="plan" value="${escapeAttr(code)}"><label for="${escapeAttr(id)}">Billing email (optional)</label><input id="${escapeAttr(id)}" type="email" name="email" autocomplete="email" maxlength="254"><button type="submit" aria-label="Subscribe to the ${escapeAttr(planName)} plan">Subscribe</button></form>`;
}

function afterCheckout(): string {
  return '<section><h2>After checkout</h2><p>Stripe returns you to a claim page that shows your API key <strong>once</strong>. Copy it immediately; it cannot be recovered, and reloading the page does not issue a second key. Send it as <code>Authorization: Bearer &lt;key&gt;</code>.</p><p>To change plan, update payment details or cancel, call <code>POST /v1/billing/portal</code> with the key as a Bearer token and open the returned Stripe billing-portal link.</p></section>';
}

/**
 * Developer documentation for the direct billing API (ADR-0014), rendered on
 * the vertical's docs page only when a direct channel is configured.
 */
export function billingDocsContent(offer: ProductOffer): string {
  const checkout = offer.direct_checkout;
  if (checkout === undefined) return '';
  const base = `${checkout.api_origin}${checkout.path_prefix}/v1/billing`;
  const paid = offer.plans.find((plan) => plan.monthly_usd > 0);
  const example = paid === undefined ? 'developer' : planCode(paid.name);
  const status = directCheckoutAvailable(offer)
    ? ''
    : '<p class="notice">Direct subscriptions are not open yet. These endpoints are documented ahead of launch; no plan is purchasable until this service is announced as available.</p>';
  const block = (text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`;
  return `<h2>Direct subscriptions and billing</h2>${status}<p>Self-service plans are sold through Stripe on the direct API host. Marketplace keys are billed by the marketplace and cannot use these routes.</p>
<h3>List plans</h3><p><code>GET /v1/billing/plans</code> returns each purchasable plan's code, price and monthly request allowance. No key is required.</p>${block(`curl -s ${base}/plans`)}
<h3>Start checkout</h3><p><code>POST /v1/billing/checkout</code> accepts JSON or a form. JSON answers <code>201</code> with <code>data.checkout_url</code>; a form post answers <code>303</code> and redirects to Stripe Checkout. <code>email</code> is optional and pre-fills Checkout.</p>${block(`curl -s -X POST ${base}/checkout \
  -H 'content-type: application/json' \
  -d '{"plan":"${example}","email":"you@example.com"}'`)}
<h3>Claim the key</h3><p>Checkout redirects to <code>GET /v1/billing/claim?session_id=…</code>, which shows the API key once. A second visit answers <code>409 ALREADY_CLAIMED</code> rather than issuing another key.</p>
<h3>Manage or cancel</h3><p><code>POST /v1/billing/portal</code> with the key as a Bearer token answers <code>201</code> with <code>data.portal_url</code>, a Stripe billing-portal link for plan changes, payment details and cancellation.</p>${block(`curl -s -X POST ${base}/portal \
  -H "authorization: Bearer $DATA_FOUNDRY_API_KEY"`)}
<h3>Monthly allowance</h3><p>Each plan's allowance is a hard stop, never an overage charge. When a self-service key has used its allowance for the calendar month (UTC), data requests answer <code>429</code> with error code <code>ALLOWANCE_EXHAUSTED</code> until the next month or an upgrade:</p>${block(`HTTP/1.1 429 Too Many Requests
retry-after: <seconds until the next UTC month>
x-ratelimit-limit: <monthly allowance>
x-ratelimit-remaining: 0
x-ratelimit-reset: <ISO-8601 start of the next UTC month>

{"error":{"code":"ALLOWANCE_EXHAUSTED","message":"…"}}`)}<p>Respect <code>retry-after</code>; retrying sooner will not succeed. Upgrade through the billing portal to raise the allowance immediately.</p>`;
}

export function renderProductPage(offer: ProductOffer, prefix: string, origin: string, page: 'pricing' | 'terms' | 'privacy' | 'support') {
  let title: string;
  let body: string;
  if (page === 'pricing') {
    title = offer.availability === 'prelaunch' ? 'Proposed plans' : 'Plans';
    const direct = directCheckoutAvailable(offer) ? offer.direct_checkout! : undefined;
    const lead = offer.availability === 'prelaunch'
      ? 'These are pricing hypotheses for validation, not subscriptions available for purchase.'
      : direct !== undefined
        ? 'Subscribe directly below. Payment is handled by Stripe Checkout.' + (offer.listing_url === null ? '' : ' The marketplace listing controls price, included requests and subscription terms for marketplace subscriptions.')
        : 'The marketplace listing controls current price, included requests and subscription terms.';
    const marketplace = offer.listing_url === null
      ? (direct === undefined ? '<p class="notice">A marketplace listing is not configured yet. Paid access is not available through this page.</p>' : '')
      : `<p><a class="button" href="${escapeAttr(offer.listing_url)}" rel="external noreferrer">View listing on RapidAPI</a></p>`;
    const contract = direct === undefined
      ? '<p>Validate your model coverage before subscribing. Authentication, request limits and cancellation follow the marketplace contract; direct and marketplace credentials are separate.</p>'
      : '<p>Validate your model coverage before subscribing. A direct subscription issues a direct API key for this dataset; marketplace subscriptions authenticate through the marketplace instead. Direct and marketplace credentials are separate.</p>';
    body = `<p>${escapeHtml(lead)}</p><div class="plan-grid">${offer.plans.map((plan) => `<article class="plan"><h2>${escapeHtml(plan.name)}</h2><p class="price">$${plan.monthly_usd}<span> / month</span></p><p>${plan.included_requests.toLocaleString('en-US')} included requests</p><p>Hard stop at the allowance. No automatic overage.</p>${direct === undefined || plan.monthly_usd <= 0 ? '' : checkoutForm(direct, plan.name)}</article>`).join('')}</div>${marketplace}${direct === undefined ? '' : afterCheckout()}${contract}${coverageContent(offer)}`;
  } else {
    title = page === 'terms' ? 'Terms' : page === 'privacy' ? 'Privacy' : 'Support';
    const draft = page === 'terms'
      ? 'Service terms, data-use permissions, prohibited uses, cancellation and dispute provisions need an approved operating policy. Source rights and marketplace terms still apply. This draft grants no additional data license.'
      : page === 'privacy'
        ? 'The operator must approve the privacy notice, retention periods, subprocessors and privacy-request contact before launch. Never send personal or confidential records in a model lookup. This draft makes no claim that a retention policy has been approved.'
        : 'A monitored support address and response expectations must be approved before paid launch. For a future support request, retain the request ID, endpoint, timestamp and a non-sensitive model example. Never include API keys or authorization headers.';
    const policy = page === 'terms' ? offer.terms_policy : page === 'privacy' ? offer.privacy_policy : undefined;
    if (policy !== undefined) {
      body = `<p><a class="button" href="${escapeAttr(policy.url)}" rel="external noreferrer">Read the approved ${title.toLowerCase()} policy</a></p><p>The linked policy is the approved operating document for this service.</p>`;
    } else if (page === 'support' && offer.support_contact !== undefined) {
      body = `<p>Contact <a href="mailto:${escapeAttr(offer.support_contact.email)}">${escapeHtml(offer.support_contact.email)}</a> with the request ID, endpoint, timestamp and a non-sensitive model example. Never include API keys or authorization headers.</p>`;
    } else {
      body = `<div class="notice"><strong>Pending approval</strong><p>${escapeHtml(draft)}</p></div><p>This operating detail has not been approved. Paid launch remains pending approved terms, privacy and support information.</p>`;
    }
  }
  return { status: 200, html: layout({ title: `${title} — ${offer.title}`, description: `${title} for ${offer.title}`, canonicalUrl: `${origin}${prefix}/${page}`, robots: 'noindex,follow', bodyHtml: `${productNavigation(prefix)}<h1>${title}</h1>${body}<p><a href="${escapeAttr(prefix)}/terms">Terms</a> · <a href="${escapeAttr(prefix)}/privacy">Privacy</a> · <a href="${escapeAttr(prefix)}/support">Support</a></p>` }) };
}
