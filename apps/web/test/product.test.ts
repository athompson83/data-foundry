import { FieldMetadataRegistry } from '@data-foundry/query-model';
import { parseSearchForm } from '../src/search-form.js';
import { describe, expect, it } from 'vitest';
import runtime from '../generated/hvac.web-runtime.json' with { type: 'json' };
import { billingDocsContent, directCheckoutAvailable, offerIntro, planCode, ProductOfferSchema, renderProductPage } from '../src/product.js';

describe('optional marketplace offer', () => {
  it.each(['https://rapidapi.com.evil.invalid/user/api/data', 'http://rapidapi.com/user/api/data', 'https://key@rapidapi.com/user/api/data', 'https://rapidapi.com/user/api/data?key=value', 'https://rapidapi.com/user/api/data#key', 'https://rapidapi.com/', 'javascript:alert(1)'])('rejects an unsafe or non-listing URL %s', (listing_url) => {
    expect(ProductOfferSchema.safeParse({ ...runtime.product, listing_url }).success).toBe(false);
  });
  it('requires a configured listing before claiming marketplace availability', () => {
    expect(ProductOfferSchema.safeParse({ ...runtime.product, availability: 'available', listing_url: null }).success).toBe(false);
  });
  it('renders an explicitly configured valid listing safely', () => {
    const offer = ProductOfferSchema.parse({ ...runtime.product, listing_url: 'https://rapidapi.com/synthetic-test/api/synthetic-data' });
    expect(renderProductPage(offer, '/example', 'https://example.test', 'pricing').html).toContain('href="https://rapidapi.com/synthetic-test/api/synthetic-data"');
  });
});


describe('approved operating policies', () => {
  const policies = {
    terms_policy: { approved: true, url: 'https://data.aroqon.com/policies/terms' },
    privacy_policy: { approved: true, url: 'https://data.aroqon.com/policies/privacy' },
    support_contact: { approved: true, email: 'fixture-contact@example.com' },
  };
  it('refuses available status with listing but incomplete approved policies', () => {
    expect(ProductOfferSchema.safeParse({ ...runtime.product, availability: 'available', listing_url: 'https://rapidapi.com/synthetic-test/api/synthetic-data' }).success).toBe(false);
  });
  it('uses approved URLs and contact instead of pending drafts when explicitly configured', () => {
    const offer = ProductOfferSchema.parse({ ...runtime.product, ...policies, availability: 'available', listing_url: 'https://rapidapi.com/synthetic-test/api/synthetic-data' });
    expect(renderProductPage(offer, '/hvac', 'https://data.aroqon.com', 'terms').html).toContain('href="https://data.aroqon.com/policies/terms"');
    expect(renderProductPage(offer, '/hvac', 'https://data.aroqon.com', 'privacy').html).toContain('href="https://data.aroqon.com/policies/privacy"');
    const support = renderProductPage(offer, '/hvac', 'https://data.aroqon.com', 'support').html;
    expect(support).toContain('mailto:fixture-contact@example.com');
    expect(support).not.toContain('Pending approval');
  });
  it('refuses unapproved policies and credential-bearing policy URLs', () => {
    expect(ProductOfferSchema.safeParse({ ...runtime.product, terms_policy: { approved: false, url: policies.terms_policy.url } }).success).toBe(false);
    expect(ProductOfferSchema.safeParse({ ...runtime.product, privacy_policy: { approved: true, url: 'https://credential@data.aroqon.com/privacy' } }).success).toBe(false);
  });
});


describe('browse filter input', () => {
  it('does not count blank browser controls against the active filter limit', () => {
    const fields = Array.from({ length: 13 }, (_, index) => ({ field: `field_${index}`, value_type: 'string' as const, filter: { type: 'multi_select' as const, facet_count: true } }));
    const registry = new FieldMetadataRegistry(fields);
    const params = new URLSearchParams(fields.map((field): [string, string] => [`filter.${field.field}`, '']));
    params.set('filter.field_12', 'selected');
    expect(parseSearchForm(params, registry, ['equipment']).filters).toEqual([{ property: 'field_12', op: 'in', values: ['selected'] }]);
    for (const field of fields) params.set(`filter.${field.field}`, 'selected');
    expect(() => parseSearchForm(params, registry, ['equipment'])).toThrow('Too many filters');
  });
});

describe('direct self-service checkout', () => {
  const policies = {
    terms_policy: { approved: true, url: 'https://data.aroqon.com/policies/terms' },
    privacy_policy: { approved: true, url: 'https://data.aroqon.com/policies/privacy' },
    support_contact: { approved: true, email: 'fixture-contact@example.com' },
  };
  const direct_checkout = { api_origin: 'https://api.data.aroqon.com', path_prefix: '' };
  const available = { ...runtime.product, ...policies, availability: 'available', listing_url: null, direct_checkout };
  const pricing = (input: unknown) => renderProductPage(ProductOfferSchema.parse(input), '/hvac', 'https://data.aroqon.com', 'pricing').html;
  const forms = (html: string) => html.match(/<form [^>]*>/g) ?? [];

  it('keeps the shipped HVAC offer prelaunch with no direct channel and no purchase form', () => {
    const offer = ProductOfferSchema.parse(runtime.product);
    expect(offer.availability).toBe('prelaunch');
    expect(offer.direct_checkout).toBeUndefined();
    expect(directCheckoutAvailable(offer)).toBe(false);
    expect(forms(renderProductPage(offer, '/hvac', 'https://data.aroqon.com', 'pricing').html)).toEqual([]);
    expect(billingDocsContent(offer)).toBe('');
  });

  it('accepts direct checkout as the only available channel when policies are approved', () => {
    expect(ProductOfferSchema.safeParse(available).success).toBe(true);
    expect(ProductOfferSchema.safeParse({ ...available, listing_url: 'https://rapidapi.com/synthetic-test/api/synthetic-data' }).success).toBe(true);
    expect(ProductOfferSchema.safeParse({ ...available, direct_checkout: { ...direct_checkout, path_prefix: '/v1/hvac' } }).success).toBe(true);
  });

  it('refuses available status with neither channel, or with direct checkout but incomplete policies', () => {
    const { direct_checkout: _omit, ...noChannel } = available;
    expect(ProductOfferSchema.safeParse(noChannel).success).toBe(false);
    const { support_contact: _support, ...noSupport } = available;
    expect(ProductOfferSchema.safeParse(noSupport).success).toBe(false);
    expect(ProductOfferSchema.safeParse({ ...runtime.product, availability: 'available', direct_checkout }).success).toBe(false);
  });

  it.each([
    'http://api.data.aroqon.com',
    'https://api.data.aroqon.com/',
    'https://api.data.aroqon.com/v1',
    'https://key@api.data.aroqon.com',
    'https://api.data.aroqon.com?x=1',
    'javascript:alert(1)',
  ])('rejects an unsafe or non-origin api_origin %s', (api_origin) => {
    expect(ProductOfferSchema.safeParse({ ...available, direct_checkout: { ...direct_checkout, api_origin } }).success).toBe(false);
  });

  it.each(['hvac', '/hvac', '/v1/hvac/', '/v1/HVAC', '/v1/"><script>', '/v1/a b', '/v2/hvac'])('rejects an invalid path_prefix %s', (path_prefix) => {
    expect(ProductOfferSchema.safeParse({ ...available, direct_checkout: { ...direct_checkout, path_prefix } }).success).toBe(false);
  });

  it('rejects unknown direct checkout keys and paid plans whose codes are invalid or collide', () => {
    expect(ProductOfferSchema.safeParse({ ...available, direct_checkout: { ...direct_checkout, price_id: 'price_x' } }).success).toBe(false);
    expect(ProductOfferSchema.safeParse({ ...available, plans: [{ name: 'Pro Plan', monthly_usd: 10, included_requests: 1 }, { name: 'pro-plan', monthly_usd: 20, included_requests: 2 }] }).success).toBe(false);
    expect(ProductOfferSchema.safeParse({ ...available, plans: [{ name: '42', monthly_usd: 10, included_requests: 1 }] }).success).toBe(false);
  });

  it('renders one accessible POST form per paid plan with the configured action and no form for the free plan', () => {
    const html = pricing(available);
    const found = forms(html);
    expect(found).toHaveLength(3);
    for (const form of found) expect(form).toBe('<form class="checkout" method="post" action="https://api.data.aroqon.com/v1/billing/checkout">');
    for (const code of ['developer', 'growth', 'scale']) {
      expect(html).toContain(`<input type="hidden" name="plan" value="${code}">`);
      expect(html).toContain(`<label for="checkout-email-${code}">Billing email (optional)</label><input id="checkout-email-${code}" type="email" name="email"`);
    }
    expect(html).not.toContain('value="evaluate"');
    expect(html.match(/<button type="submit"[^>]*>Subscribe<\/button>/g)).toHaveLength(3);
    expect(html.match(/Hard stop at the allowance\. No automatic overage\./g)).toHaveLength(4);
    expect(html).toContain('<h2>After checkout</h2>');
    expect(html).toContain('POST /v1/billing/portal');
    expect(html).not.toContain('Paid access is not available through this page');
    expect(html).not.toContain('<script');
  });

  it('prefixes the action with a configured vertical path', () => {
    const html = pricing({ ...available, direct_checkout: { ...direct_checkout, path_prefix: '/v1/hvac' } });
    expect(html).toContain('action="https://api.data.aroqon.com/v1/hvac/billing/checkout"');
  });

  it('renders direct forms alongside a marketplace listing when both channels are configured', () => {
    const html = pricing({ ...available, listing_url: 'https://rapidapi.com/synthetic-test/api/synthetic-data' });
    expect(forms(html)).toHaveLength(3);
    expect(html).toContain('href="https://rapidapi.com/synthetic-test/api/synthetic-data"');
  });

  it('renders no purchase form while direct checkout is configured but prelaunch', () => {
    const html = pricing({ ...runtime.product, direct_checkout });
    expect(forms(html)).toEqual([]);
    expect(html).toContain('not subscriptions available for purchase');
    expect(html).not.toContain('After checkout');
  });

  it('escapes plan names in the form and derives the billing plan code', () => {
    const html = pricing({ ...available, plans: [{ name: 'Free', monthly_usd: 0, included_requests: 10 }, { name: 'Pro <b>"Plus"</b>', monthly_usd: 10, included_requests: 100 }] });
    expect(planCode('Pro <b>"Plus"</b>')).toBe('pro-b-plus-b');
    expect(html).toContain('value="pro-b-plus-b"');
    expect(html).toContain('aria-label="Subscribe to the Pro &lt;b&gt;&quot;Plus&quot;&lt;/b&gt; plan"');
    expect(html).not.toContain('<b>"Plus"');
    expect(forms(html)).toHaveLength(1);
  });

  it('documents the billing API and allowance response only when a direct channel is configured', () => {
    const docs = billingDocsContent(ProductOfferSchema.parse(available));
    expect(docs).toContain('curl -s https://api.data.aroqon.com/v1/billing/plans');
    expect(docs).toContain('https://api.data.aroqon.com/v1/billing/checkout');
    expect(docs).toContain('{&quot;plan&quot;:&quot;developer&quot;');
    expect(docs).toContain('https://api.data.aroqon.com/v1/billing/portal');
    expect(docs).toContain('GET /v1/billing/claim');
    expect(docs).toContain('ALLOWANCE_EXHAUSTED');
    for (const header of ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining: 0', 'x-ratelimit-reset']) expect(docs).toContain(header);
    expect(docs).not.toContain('not open yet');
    expect(billingDocsContent(ProductOfferSchema.parse({ ...runtime.product, direct_checkout }))).toContain('Direct subscriptions are not open yet');
  });
});

describe('hero lookup button', () => {
  it('uses the configured lookup_cta and keeps the HVAC default', () => {
    const base = ProductOfferSchema.parse(runtime.product);
    expect(offerIntro(base, '/hvac')).toContain('>Look up equipment</a>');
    const vehicles = ProductOfferSchema.parse({ ...runtime.product, lookup_cta: 'Look up a vehicle' });
    expect(offerIntro(vehicles, '/vehicles')).toContain('>Look up a vehicle</a>');
  });
});
