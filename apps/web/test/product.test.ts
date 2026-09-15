import { FieldMetadataRegistry } from '@data-foundry/query-model';
import { parseSearchForm } from '../src/search-form.js';
import { describe, expect, it } from 'vitest';
import runtime from '../generated/hvac.web-runtime.json' with { type: 'json' };
import { ProductOfferSchema, renderProductPage } from '../src/product.js';

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
