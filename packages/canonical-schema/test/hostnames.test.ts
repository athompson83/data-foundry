import { describe, expect, it } from 'vitest';
import {
  isUnsafeCanonicalProductionHostname,
  parseCanonicalProductionWorkerRoute,
} from '../src/hostnames.js';

describe('canonical production hostname policy', () => {
  it('accepts a valid custom public DNS hostname', () => {
    expect(isUnsafeCanonicalProductionHostname('api.datafoundry.io')).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '127.1',
    '0x7f000001',
    '[2001:4860:4860::8888]',
    '2001:4860:4860::8888',
  ])('rejects the IP literal %s', (hostname) => {
    expect(isUnsafeCanonicalProductionHostname(hostname)).toBe(true);
  });

  it.each([
    '-api.datafoundry.io',
    'api-.datafoundry.io',
    'api_.datafoundry.io',
    'api..datafoundry.io',
    'éxample.com',
    'api.123',
    '1.2.3.4.5',
    `${'a'.repeat(64)}.datafoundry.io`,
  ])('rejects the invalid LDH hostname %s', (hostname) => {
    expect(isUnsafeCanonicalProductionHostname(hostname)).toBe(true);
  });

  it.each([
    'example.com',
    'api.example.net',
    'nested.api.example.org',
    'service.alt',
    'printer.local',
    'service.example.onion',
    'router.home.arpa',
    'dns.resolver.arpa',
    'data-foundry-edge.workers.dev',
    'data-foundry-web.pages.dev',
    'preview.trycloudflare.com',
  ])('rejects the special-use or provider fallback hostname %s', (hostname) => {
    expect(isUnsafeCanonicalProductionHostname(hostname)).toBe(true);
  });
});

describe('canonical production Worker route parsing', () => {
  it('returns the exact host and pattern for a lowercase custom DNS host wildcard route', () => {
    expect(parseCanonicalProductionWorkerRoute('api.datafoundry.io/*')).toEqual({
      hostname: 'api.datafoundry.io',
      pattern: 'api.datafoundry.io/*',
    });
  });

  it.each([
    'API.datafoundry.io/*',
    'api.datafoundry.io./*',
    'https://api.datafoundry.io/*',
    'user@api.datafoundry.io/*',
    'api.datafoundry.io:443/*',
    'api.datafoundry.io/',
    'api.datafoundry.io/path/*',
    'api.datafoundry.io/*?preview=1',
    'api.datafoundry.io/*#fragment',
    '*.datafoundry.io/*',
    'api.example.com/*',
    'api.123/*',
    '1.2.3.4.5/*',
  ])('rejects the non-canonical Worker route %s', (route) => {
    expect(parseCanonicalProductionWorkerRoute(route)).toBeNull();
  });
});
