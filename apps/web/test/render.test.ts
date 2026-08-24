/**
 * `layout()`'s JSON-LD escaping. No real page today puts ingested text into
 * `structuredData` (the current `Dataset` payload is built from vertical
 * name/description strings this repo controls), but `layout` is exported and
 * generic — a future caller that does put ingested text there must not be
 * able to break out of the `<script>` element with it.
 */
import { describe, expect, it } from 'vitest';
import { layout } from '../src/render.js';

describe('layout — JSON-LD escaping', () => {
  it('does not let a structuredData value close the script element early', () => {
    const html = layout({
      title: 't',
      description: 'd',
      canonicalUrl: 'https://example.test/',
      robots: 'index,follow',
      bodyHtml: '<p>x</p>',
      structuredData: { name: '</script><script>alert(1)</script>' },
    });
    expect(html).not.toContain('</script><script>alert(1)</script>');
    // The escaped form must still be valid JSON a consumer can parse back.
    const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!) as { name: string };
    expect(parsed.name).toBe('</script><script>alert(1)</script>');
  });

  it('renders no script tag at all when structuredData is undefined', () => {
    const html = layout({
      title: 't',
      description: 'd',
      canonicalUrl: 'https://example.test/',
      robots: 'index,follow',
      bodyHtml: '<p>x</p>',
    });
    expect(html).not.toContain('application/ld+json');
  });
});
