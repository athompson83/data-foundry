import { describe, expect, it } from 'vitest';
import type { RobotsPolicy } from '@data-foundry/canonical-schema';
import {
  evaluateRobots,
  parseRobotsTxt,
  robotsPatternMatches,
  robotsPolicyFromTxt,
  selectRobotsGroup,
} from '../src/policy/robots.js';

const ROBOTS = `
# Example directory robots
User-agent: *
Disallow: /admin
Disallow: /search?
Allow: /admin/public
Crawl-delay: 5

User-agent: DataFoundryBot
User-agent: SomeOtherBot
Disallow: /private
Crawl-delay: 1

Sitemap: https://www.ahridirectory.org/sitemap.xml
`;

function policy(overrides: Partial<RobotsPolicy> = {}): RobotsPolicy {
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

describe('robots.txt parsing', () => {
  it('groups directives by user agent', () => {
    const parsed = parseRobotsTxt(ROBOTS);
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]?.userAgents).toEqual(['*']);
    expect(parsed.groups[1]?.userAgents).toEqual(['datafoundrybot', 'someotherbot']);
    expect(parsed.sitemaps).toEqual(['https://www.ahridirectory.org/sitemap.xml']);
  });

  it('reads crawl-delay per group', () => {
    const parsed = parseRobotsTxt(ROBOTS);
    expect(parsed.groups[0]?.crawlDelaySeconds).toBe(5);
    expect(parsed.groups[1]?.crawlDelaySeconds).toBe(1);
  });

  it('drops comments and blank lines', () => {
    const parsed = parseRobotsTxt('User-agent: *\n# a comment\n\nDisallow: /x # trailing\n');
    expect(parsed.groups[0]?.rules).toEqual([{ type: 'disallow', path: '/x' }]);
  });

  it('treats an empty Disallow as "everything is allowed" rather than a rule', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow:\n');
    expect(parsed.groups[0]?.rules).toEqual([]);
  });

  it('selects the most specific matching group, falling back to *', () => {
    const parsed = parseRobotsTxt(ROBOTS);
    expect(selectRobotsGroup(parsed, 'DataFoundryBot/0.1')?.crawlDelaySeconds).toBe(1);
    expect(selectRobotsGroup(parsed, 'SomeUnknownCrawler')?.crawlDelaySeconds).toBe(5);
  });

  it('builds a hashed, timestamped policy snapshot', () => {
    const snapshot = robotsPolicyFromTxt({
      text: ROBOTS,
      userAgent: 'DataFoundryBot/0.1',
      robotsUrl: 'https://www.ahridirectory.org/robots.txt',
      fetchedAt: '2026-08-14T00:00:00.000Z',
    });
    expect(snapshot.disallowed_paths).toEqual(['/private']);
    expect(snapshot.crawl_delay_seconds).toBe(1);
    expect(snapshot.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.snapshot_at).toBe('2026-08-14T00:00:00.000Z');
  });
});

describe('robots pattern matching', () => {
  it.each([
    ['/admin', '/admin/users', true],
    ['/admin', '/administrator', true],
    ['/admin$', '/admin', true],
    ['/admin$', '/admin/users', false],
    ['/*.pdf$', '/docs/manual.pdf', true],
    ['/*.pdf$', '/docs/manual.pdf?v=2', false],
    ['/search?', '/search?q=x', true],
  ])('pattern %s vs %s -> %s', (pattern, path, expected) => {
    expect(robotsPatternMatches(pattern, path)).toBe(expected);
  });
});

describe('robots evaluation', () => {
  it('allows a path no rule matches', () => {
    const decision = evaluateRobots(policy({ disallowed_paths: ['/admin'] }), 'https://x.test/a');
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBeNull();
  });

  it('disallows a matching path', () => {
    const decision = evaluateRobots(
      policy({ disallowed_paths: ['/admin'] }),
      'https://x.test/admin/users',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toBe('disallow:/admin');
  });

  it('lets the longest matching rule win', () => {
    const decision = evaluateRobots(
      policy({ disallowed_paths: ['/admin'], allowed_paths: ['/admin/public'] }),
      'https://x.test/admin/public/report.pdf',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRule).toBe('allow:/admin/public');
  });

  it('gives ties to Allow', () => {
    const decision = evaluateRobots(
      policy({ disallowed_paths: ['/docs'], allowed_paths: ['/docs'] }),
      'https://x.test/docs/a',
    );
    expect(decision.allowed).toBe(true);
  });

  it('applies the query string when matching', () => {
    const decision = evaluateRobots(
      policy({ disallowed_paths: ['/*?session='] }),
      'https://x.test/page?session=abc',
    );
    expect(decision.allowed).toBe(false);
  });

  it('carries the crawl delay through to the caller', () => {
    expect(evaluateRobots(policy({ crawl_delay_seconds: 7 }), 'https://x.test/a').crawlDelaySeconds).toBe(7);
  });

  it('records when a source is configured to bypass robots', () => {
    const decision = evaluateRobots(
      policy({ respect_robots: false, disallowed_paths: ['/'] }),
      'https://x.test/anything',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.respected).toBe(false);
  });
});
