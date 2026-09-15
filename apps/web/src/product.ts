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

export const ProductOfferSchema = z.strictObject({
  title: z.string().min(1).max(160),
  lookup_entity_type: z.string().regex(/^[a-z][a-z0-9_]*$/),
  audience: z.string().min(1).max(300),
  summary: z.string().min(1).max(500),
  availability: z.enum(['prelaunch', 'available']),
  listing_url: listingUrl.nullable(),
  terms_policy: approvedPolicy.optional(),
  privacy_policy: approvedPolicy.optional(),
  support_contact: z.strictObject({ approved: z.literal(true), email: z.string().email().max(254) }).optional(),
  coverage: z.string().min(1).max(1200),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
  plans: z.array(z.object({ name: z.string().min(1).max(50), monthly_usd: z.number().nonnegative(), included_requests: z.number().int().positive() })).min(1).max(8),
}).refine((offer) => offer.availability !== 'available' || (offer.listing_url !== null && offer.terms_policy !== undefined && offer.privacy_policy !== undefined && offer.support_contact !== undefined), 'Available marketplace plans require a listing and explicitly approved terms, privacy and support configuration');
export type ProductOffer = ReturnType<typeof ProductOfferSchema.parse>;

export function productNavigation(prefix: string): string {
  return `<nav class="product-nav" aria-label="Dataset navigation"><a href="${escapeAttr(prefix)}">Overview</a><a href="${escapeAttr(prefix)}/search">Browse data</a><a href="${escapeAttr(prefix)}/docs">Developer guide</a><a href="${escapeAttr(prefix)}/pricing">Pricing</a></nav>`;
}

export function offerIntro(offer: ProductOffer, prefix: string): string {
  return `${productNavigation(prefix)}<section class="hero"><p class="eyebrow">${escapeHtml(offer.audience)}</p><h1>${escapeHtml(offer.title)}</h1><p class="lede">${escapeHtml(offer.summary)}</p><div class="actions"><a class="button" href="${escapeAttr(prefix)}/search">Look up equipment</a><a class="button secondary" href="${escapeAttr(prefix)}/docs">Start integrating</a></div><p class="evidence">${offer.availability === 'prelaunch' ? 'Preparing for launch. Plans and coverage are being validated.' : 'Confirm current availability and terms on the marketplace listing.'}</p></section>`;
}

export function coverageContent(offer: ProductOffer): string {
  return `<section><h2>Coverage and limitations</h2><p>${escapeHtml(offer.coverage)}</p>${renderList(offer.limitations.map(escapeHtml))}</section>`;
}

export function renderProductPage(offer: ProductOffer, prefix: string, origin: string, page: 'pricing' | 'terms' | 'privacy' | 'support') {
  let title: string;
  let body: string;
  if (page === 'pricing') {
    title = offer.availability === 'prelaunch' ? 'Proposed plans' : 'Plans';
    body = `<p>${offer.availability === 'prelaunch' ? 'These are pricing hypotheses for validation, not subscriptions available for purchase.' : 'The marketplace listing controls current price, included requests and subscription terms.'}</p><div class="plan-grid">${offer.plans.map((plan) => `<article class="plan"><h2>${escapeHtml(plan.name)}</h2><p class="price">$${plan.monthly_usd}<span> / month</span></p><p>${plan.included_requests.toLocaleString('en-US')} included requests</p><p>Hard stop at the allowance. No automatic overage.</p></article>`).join('')}</div>${offer.listing_url === null ? '<p class="notice">A marketplace listing is not configured yet. Paid access is not available through this page.</p>' : `<p><a class="button" href="${escapeAttr(offer.listing_url)}" rel="external noreferrer">View listing on RapidAPI</a></p>`}<p>Validate your model coverage before subscribing. Authentication, request limits and cancellation follow the marketplace contract; direct and marketplace credentials are separate.</p>${coverageContent(offer)}`;
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
