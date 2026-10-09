/**
 * `toWebRequest` translation: the `Accept` header must reach the router so it
 * can negotiate the Markdown representation for agents.
 */
import { describe, expect, it } from 'vitest';
import { toFetchResponse, toWebRequest } from '../src/adapter.js';

describe('toWebRequest', () => {
  it('forwards the Accept header so the router can negotiate Markdown', () => {
    const request = toWebRequest(
      new Request('https://data-foundry.test/', { headers: { accept: 'text/markdown' } }),
    );
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://data-foundry.test/');
    expect(request.headers?.['accept']).toBe('text/markdown');
  });

  it('omits headers entirely when no Accept header is present', () => {
    const request = toWebRequest(new Request('https://data-foundry.test/'));
    expect(request.headers).toBeUndefined();
  });
});

describe('toFetchResponse', () => {
  it('preserves the negotiated content type and vary header', () => {
    const response = toFetchResponse(
      {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept' },
        body: '# hi\n',
      },
      'GET',
    );
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('vary')).toBe('Accept');
  });
});
