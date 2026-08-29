import { describe, expect, it } from 'vitest';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import { classifyScheduledResult } from '../src/result-policy.js';

const targets = ACQUISITION_RUNTIMES['hvac']!.targets;
const browserTarget = targets.find(
  ({ source }) => source.acquisition_policy.method === 'BROWSER_RUN',
)!;
const httpTarget = targets.find(
  ({ source }) =>
    source.acquisition_policy.method !== 'BROWSER_RUN' &&
    source.acquisition_policy.method !== 'CRAWL4AI',
)!;

describe('scheduled result manifest policy', () => {
  it('classifies the exact request URL as the target', () => {
    expect(classifyScheduledResult(httpTarget, httpTarget.target_url)).toBe('TARGET');
  });

  it('rejects credentials even when the result exactly equals the claimed target', () => {
    const credentialUrl = 'https://user:secret@acme.example.com/catalog';
    expect(() => classifyScheduledResult({
      ...httpTarget,
      target_url: credentialUrl,
    }, credentialUrl)).toThrow(/result manifest/i);
  });

  it('allows an explicitly scoped browser child query without broadening the path', () => {
    expect(classifyScheduledResult(browserTarget, `${browserTarget.target_url}?page=2`)).toBe(
      'CHILD_RESOURCE',
    );
  });

  it.each([
    'https://attacker.example.net/products/coolsupply-listing.html?page=2',
    'https://www.coolsupply.example.com/account/export?page=2',
    'https://www.coolsupply.example.com/products/coolsupply-listing.html-elsewhere?page=2',
    'http://www.coolsupply.example.com/products/coolsupply-listing.html?page=2',
    'https://www.coolsupply.example.com/products/coolsupply-listing.html?page=2#redirected',
    'https://user:secret@www.coolsupply.example.com/products/coolsupply-listing.html?page=2',
    'https://www.coolsupply.example.com/products/coolsupply-listing.html/%2e%2e/account',
  ])('rejects an off-scope browser result before persistence: %s', (url) => {
    expect(() => classifyScheduledResult(browserTarget, url)).toThrow(/result manifest/i);
  });

  it('does not treat HTTP query variants as child resources', () => {
    expect(() => classifyScheduledResult(httpTarget, `${httpTarget.target_url}?page=2`)).toThrow(
      /result manifest/i,
    );
  });
});
