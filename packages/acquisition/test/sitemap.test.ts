import { describe, expect, it } from 'vitest';
import type { RobotsPolicy } from '@data-foundry/canonical-schema';
import { parseSitemapXml, planSitemapTargets, SitemapParseError } from '../src/policy/sitemap.js';

const SITEMAP_URL = 'https://recalls.example.gov/sitemap.xml';

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<!-- <url><loc>https://recalls.example.gov/commented-out</loc></url> -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://recalls.example.gov/notices/1?a=1&amp;b=2</loc><lastmod>2026-09-01</lastmod></url>
  <url>
    <loc><![CDATA[https://recalls.example.gov/notices/2]]></loc>
    <lastmod>2026-09-20T10:15:00+02:00</lastmod>
  </url>
  <url><loc>https://recalls.example.gov/notices/3</loc></url>
  <url><loc>https://recalls.example.gov/notices/4</loc><lastmod>last tuesday</lastmod></url>
  <url><loc>https://elsewhere.example.com/notices/5</loc></url>
  <url><loc>https://recalls.example.gov/notices/2</loc></url>
  <url><lastmod>2026-09-01</lastmod></url>
  <url><loc>not a url</loc></url>
  <sitemap><loc>https://recalls.example.gov/nested.xml</loc></sitemap>
</urlset>`;

function robots(overrides: Partial<RobotsPolicy> = {}): RobotsPolicy {
  return {
    respect_robots: true,
    user_agent: 'DataFoundryBot',
    crawl_delay_seconds: null,
    disallowed_paths: [],
    allowed_paths: [],
    robots_url: null,
    snapshot_hash: null,
    snapshot_at: null,
    ...overrides,
  };
}

describe('parseSitemapXml', () => {
  it('reads a urlset, decoding entities and CDATA, normalising lastmod and reporting every dropped entry', () => {
    const parsed = parseSitemapXml(URLSET, { sitemapUrl: SITEMAP_URL });

    expect(parsed.kind).toBe('urlset');
    expect(parsed.entries).toEqual([
      { loc: 'https://recalls.example.gov/notices/1?a=1&b=2', lastmod: '2026-09-01T00:00:00.000Z' },
      { loc: 'https://recalls.example.gov/notices/2', lastmod: '2026-09-20T08:15:00.000Z' },
      { loc: 'https://recalls.example.gov/notices/3', lastmod: null },
      { loc: 'https://recalls.example.gov/notices/4', lastmod: null },
    ]);
    expect(parsed.issues).toEqual([
      'entry 4: unparseable <lastmod> ignored',
      "entry 5: https://elsewhere.example.com is not the sitemap's origin",
      'entry 6: duplicate <loc>',
      'entry 7: missing <loc>',
      'entry 8: <loc> is not an absolute URL',
      'entry 9: <sitemap> inside <urlset> ignored',
    ]);
  });

  it('reads a namespaced sitemap index', () => {
    const index = `<sm:sitemapindex xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sm:sitemap><sm:loc>https://recalls.example.gov/sitemap-2026.xml</sm:loc><sm:lastmod>2026-09</sm:lastmod></sm:sitemap>
    </sm:sitemapindex>`;
    expect(parseSitemapXml(index, { sitemapUrl: SITEMAP_URL })).toEqual({
      kind: 'sitemapindex',
      entries: [{ loc: 'https://recalls.example.gov/sitemap-2026.xml', lastmod: '2026-09-01T00:00:00.000Z' }],
      issues: [],
    });
  });

  it('rejects calendar-impossible lastmod values instead of rolling them over', () => {
    const xml = `<urlset>
      <url><loc>https://recalls.example.gov/a</loc><lastmod>2026-02-30</lastmod></url>
      <url><loc>https://recalls.example.gov/b</loc><lastmod>2026-13</lastmod></url>
      <url><loc>https://recalls.example.gov/c</loc><lastmod>2026-09-30T24:00:00Z</lastmod></url>
      <url><loc>https://recalls.example.gov/d</loc><lastmod>2024-02-29T23:59:59+15:00</lastmod></url>
      <url><loc>https://recalls.example.gov/e</loc><lastmod>2024-02-29T23:59:59-05:00</lastmod></url>
    </urlset>`;
    const parsed = parseSitemapXml(xml, { sitemapUrl: SITEMAP_URL });
    expect(parsed.entries.map((e) => e.lastmod)).toEqual([null, null, null, null, '2024-03-01T04:59:59.000Z']);
    expect(parsed.issues).toHaveLength(4);
  });

  it('refuses rather than truncates when a ceiling is exceeded', () => {
    expect(() => parseSitemapXml(URLSET, { sitemapUrl: SITEMAP_URL, maxEntries: 3 })).toThrow(SitemapParseError);
    expect(() => parseSitemapXml(URLSET, { sitemapUrl: SITEMAP_URL, maxBytes: 100 })).toThrow(/bytes/);
  });

  it('refuses a document that is not a sitemap', () => {
    expect(() => parseSitemapXml('<html><body>Not found</body></html>', { sitemapUrl: SITEMAP_URL })).toThrow(
      /neither/,
    );
    expect(() => parseSitemapXml(URLSET, { sitemapUrl: '/relative.xml' })).toThrow(/absolute/);
  });
});

describe('planSitemapTargets', () => {
  const policy = {
    allowedOrigins: ['https://recalls.example.gov'],
    allowedPathPrefixes: ['/notices/'],
  };
  const entries = [
    { loc: 'https://recalls.example.gov/notices/old', lastmod: '2026-08-01T00:00:00.000Z' },
    { loc: 'https://recalls.example.gov/notices/new', lastmod: '2026-09-25T00:00:00.000Z' },
    { loc: 'https://recalls.example.gov/notices/newer', lastmod: '2026-09-28T00:00:00.000Z' },
    { loc: 'https://recalls.example.gov/notices/undated-b', lastmod: null },
    { loc: 'https://recalls.example.gov/notices/undated-a', lastmod: null },
    { loc: 'https://recalls.example.gov/notices/private/x', lastmod: null },
    { loc: 'https://recalls.example.gov/about', lastmod: null },
    { loc: 'http://recalls.example.gov/notices/plain-http', lastmod: null },
    { loc: 'https://recalls.example.gov/notices/%2e%2e/admin', lastmod: null },
  ];

  it('filters by result policy, robots and lastmod, and orders oldest first then undated by URL', () => {
    const plan = planSitemapTargets({
      entries,
      policy,
      robots: robots({ disallowed_paths: ['/notices/private/'] }),
      changedSince: '2026-09-01T00:00:00Z',
      maxTargets: 10,
    });
    expect(plan.targets.map((t) => t.loc)).toEqual([
      'https://recalls.example.gov/notices/new',
      'https://recalls.example.gov/notices/newer',
      'https://recalls.example.gov/notices/undated-a',
      'https://recalls.example.gov/notices/undated-b',
    ]);
    expect(plan.deferred).toBe(0);
    expect(plan.nextCursor).toBeNull();
    expect(plan.watermark).toBe('2026-09-28T00:00:00.000Z');
    expect(plan.skipped).toEqual({
      OUTSIDE_RESULT_POLICY: 3,
      ROBOTS_DISALLOWED: 1,
      UNCHANGED_SINCE_LAST_RUN: 1,
    });
  });

  it('works through a bounded backlog in slices without repeating or skipping entries', () => {
    const changedSince = '2026-07-01T00:00:00Z';
    const first = planSitemapTargets({ entries, policy, changedSince, maxTargets: 2 });
    expect(first.targets.map((t) => t.loc)).toEqual([
      'https://recalls.example.gov/notices/old',
      'https://recalls.example.gov/notices/new',
    ]);
    expect(first.deferred).toBe(4);
    expect(first.nextCursor).toEqual({
      lastmod: '2026-09-25T00:00:00.000Z',
      loc: 'https://recalls.example.gov/notices/new',
    });

    // An entry added mid-cycle with a later lastmod sorts after the cursor and is still reached.
    const grown = [...entries, { loc: 'https://recalls.example.gov/notices/added', lastmod: '2026-09-29T00:00:00.000Z' }];
    const seen = [...first.targets.map((t) => t.loc)];
    let cursor = first.nextCursor;
    let last = first;
    while (cursor !== null) {
      last = planSitemapTargets({ entries: grown, policy, changedSince, after: cursor, maxTargets: 2 });
      seen.push(...last.targets.map((t) => t.loc));
      cursor = last.nextCursor;
    }
    expect(seen).toEqual([
      'https://recalls.example.gov/notices/old',
      'https://recalls.example.gov/notices/new',
      'https://recalls.example.gov/notices/newer',
      'https://recalls.example.gov/notices/added',
      'https://recalls.example.gov/notices/private/x',
      'https://recalls.example.gov/notices/undated-a',
      'https://recalls.example.gov/notices/undated-b',
    ]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(last.watermark).toBe('2026-09-29T00:00:00.000Z');

    // The next cycle starts from the watermark: only undated entries remain eligible.
    const next = planSitemapTargets({ entries: grown, policy, changedSince: last.watermark, maxTargets: 10 });
    expect(next.targets.every((t) => t.lastmod === null)).toBe(true);
  });

  it('rejects invalid bounds and instants', () => {
    expect(() => planSitemapTargets({ entries, policy, maxTargets: 0 })).toThrow(/maxTargets/);
    expect(() => planSitemapTargets({ entries, policy, maxTargets: 1, changedSince: 'yesterday' })).toThrow(
      /changedSince/,
    );
  });
});
