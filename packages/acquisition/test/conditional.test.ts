import { describe, expect, it } from 'vitest';
import {
  InMemoryValidatorCache,
  conditionalHeaders,
  hasValidators,
  matchesValidators,
  normalizeEtag,
  validatorsFromHeaders,
} from '../src/policy/conditional.js';
import { sha256Hex } from '../src/hashing.js';
import { HttpAcquisitionProvider } from '../src/providers/http.js';
import {
  BODY,
  ETAG,
  LAST_MODIFIED,
  makeHarness,
  makeRequest,
  requestHeader,
  stubFetch,
} from './helpers.js';

describe('conditional request primitives', () => {
  it('builds If-None-Match and If-Modified-Since', () => {
    expect(conditionalHeaders({ etag: ETAG, lastModified: LAST_MODIFIED })).toEqual({
      'if-none-match': ETAG,
      'if-modified-since': LAST_MODIFIED,
    });
  });

  it('sends nothing when there is nothing to send', () => {
    expect(conditionalHeaders(null)).toEqual({});
    expect(conditionalHeaders({})).toEqual({});
    expect(hasValidators({})).toBe(false);
    expect(hasValidators({ etag: ETAG })).toBe(true);
  });

  it('reads validators back off a response', () => {
    expect(
      validatorsFromHeaders({ etag: ETAG, 'last-modified': LAST_MODIFIED }, 'a'.repeat(64)),
    ).toEqual({ etag: ETAG, lastModified: LAST_MODIFIED, contentHash: 'a'.repeat(64) });
  });

  it('treats a weak ETag as the same entity', () => {
    expect(normalizeEtag('W/"v1"')).toBe('"v1"');
    expect(matchesValidators({ etag: 'W/"v1"' }, { etag: '"v1"' })).toBe(true);
  });

  it('matches on Last-Modified when no ETag is available', () => {
    expect(
      matchesValidators({ lastModified: LAST_MODIFIED }, { lastModified: LAST_MODIFIED }),
    ).toBe(true);
    expect(
      matchesValidators(
        { lastModified: LAST_MODIFIED },
        { lastModified: 'Tue, 11 Aug 2026 00:00:00 GMT' },
      ),
    ).toBe(false);
  });

  it('falls back to the content hash', () => {
    expect(matchesValidators({ contentHash: 'a'.repeat(64) }, { contentHash: 'a'.repeat(64) })).toBe(
      true,
    );
  });

  it('never claims a match when the caller sent no validators', () => {
    expect(matchesValidators(null, { etag: ETAG })).toBe(false);
    expect(matchesValidators({}, { etag: ETAG })).toBe(false);
  });

  it('only remembers validators worth replaying', async () => {
    const cache = new InMemoryValidatorCache();
    await cache.set('src', 'https://x.test/a', {});
    expect(cache.size).toBe(0);
    await cache.set('src', 'https://x.test/a', { etag: ETAG });
    expect(await cache.get('src', 'https://x.test/a')).toEqual({ etag: ETAG });
  });
});

describe('incremental refresh through a provider', () => {
  it('sends no conditional headers on a first acquisition', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: ETAG, 'last-modified': LAST_MODIFIED },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const result = await provider.fetch(makeRequest());

    expect(requestHeader(net.calls[0], 'if-none-match')).toBeUndefined();
    expect(result.outcome).toBe('FETCHED');
    expect(result.validators).toEqual({
      etag: ETAG,
      lastModified: LAST_MODIFIED,
      contentHash: sha256Hex(BODY),
    });
  });

  it('replays cached validators and short-circuits on 304', async () => {
    const harness = makeHarness();
    const net = stubFetch((_url, _init, call) =>
      call === 0
        ? {
            status: 200,
            headers: { 'content-type': 'application/json', etag: ETAG },
            body: BODY,
          }
        : { status: 304, headers: { etag: ETAG } },
    );
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await provider.fetch(makeRequest());
    const filesAfterFirst = harness.files.size;

    const second = await provider.fetch(makeRequest());

    expect(requestHeader(net.calls[1], 'if-none-match')).toBe(ETAG);
    expect(second.outcome).toBe('NOT_MODIFIED');
    expect(second.artifacts).toEqual([]);
    expect(second.stored).toEqual([]);
    expect(harness.files.size).toBe(filesAfterFirst);
    expect(second.validators.etag).toBe(ETAG);
  });

  it('lets the caller override the cached validators', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: ETAG },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await provider.fetch(makeRequest());
    await provider.fetch(makeRequest({ conditional: { etag: '"forced"' } }));

    expect(requestHeader(net.calls[1], 'if-none-match')).toBe('"forced"');
  });

  it('stores a new artifact when the content actually changed', async () => {
    const harness = makeHarness();
    const net = stubFetch((_url, _init, call) => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: call === 0 ? '"v1"' : '"v2"' },
      body: call === 0 ? BODY : '{"unit":"XC25"}',
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const first = await provider.fetch(makeRequest());
    const second = await provider.fetch(makeRequest());

    expect(second.outcome).toBe('FETCHED');
    expect(second.artifacts[0]?.content_hash).not.toBe(first.artifacts[0]?.content_hash);
    expect(second.stored[0]?.deduplicated).toBe(false);
    expect(await harness.validators.get('ahri-directory', first.request.url)).toEqual({
      etag: '"v2"',
      contentHash: sha256Hex('{"unit":"XC25"}'),
    });
  });

  it('deduplicates when an origin re-sends identical bytes with 200', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const first = await provider.fetch(makeRequest());
    const second = await provider.fetch(makeRequest());

    expect(second.stored[0]?.deduplicated).toBe(true);
    expect(second.stored[0]?.key).toBe(first.stored[0]?.key);
    expect(second.artifacts[0]?.id).toBe(first.artifacts[0]?.id);
    // One body and its sidecar, plus one retrieval record and its sidecar. The
    // second fetch re-confirmed the same day's retrieval, so it added nothing:
    // re-fetching identical bytes must not grow the store (finding #6).
    expect(harness.files.size).toBe(4);
  });
});
