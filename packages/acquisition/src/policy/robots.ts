import type { RobotsPolicy } from '@data-foundry/canonical-schema';
import { sha256Hex } from '../hashing.js';

/**
 * robots.txt parsing and evaluation (doc 05, "Crawl etiquette and safety").
 *
 * The canonical model stores a *snapshot* of the directives on the source
 * (`RobotsPolicy`) rather than fetching robots.txt at crawl time, so a crawl
 * decision made months ago can still be explained. This module is the pair of
 * functions that make that snapshot useful:
 *
 * - {@link parseRobotsTxt} / {@link robotsPolicyFromTxt} turn a fetched
 *   robots.txt into a snapshot;
 * - {@link evaluateRobots} decides whether one URL may be fetched under a
 *   snapshot, using RFC-9309 matching (longest pattern wins, `Allow` wins ties,
 *   `*` and `$` wildcards).
 */

export type RobotsRuleType = 'allow' | 'disallow';

export interface RobotsRule {
  readonly type: RobotsRuleType;
  readonly path: string;
}

export interface RobotsGroup {
  readonly userAgents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds: number | null;
}

export interface ParsedRobotsTxt {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
}

interface MutableGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

/**
 * Parse robots.txt into user-agent groups.
 *
 * Consecutive `User-agent` lines share one group, which is the behaviour real
 * robots.txt files rely on. Unknown directives are ignored rather than treated
 * as errors — a malformed robots.txt must not take down acquisition.
 */
export function parseRobotsTxt(text: string): ParsedRobotsTxt {
  const groups: MutableGroup[] = [];
  const sitemaps: string[] = [];
  let current: MutableGroup | null = null;
  /** True while we are still collecting the `User-agent` lines of a group. */
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (current === null || !collectingAgents) {
          current = { userAgents: [], rules: [], crawlDelaySeconds: null };
          groups.push(current);
          collectingAgents = true;
        }
        if (value !== '') current.userAgents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (current === null) break;
        collectingAgents = false;
        // An empty `Disallow:` is the explicit "everything is allowed" idiom and
        // carries no path, so it is dropped rather than stored as a rule.
        if (value !== '') current.rules.push({ type: field, path: value });
        break;
      }
      case 'crawl-delay': {
        if (current === null) break;
        collectingAgents = false;
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelaySeconds = parsed;
        break;
      }
      case 'sitemap': {
        if (value !== '') sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return { groups, sitemaps };
}

/**
 * Pick the group that applies to `userAgent`: the longest matching product
 * token, falling back to the `*` group, falling back to nothing.
 */
export function selectRobotsGroup(
  parsed: ParsedRobotsTxt,
  userAgent: string,
): RobotsGroup | null {
  const needle = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLength = -1;
  let wildcard: RobotsGroup | null = null;

  for (const group of parsed.groups) {
    for (const agent of group.userAgents) {
      if (agent === '*') {
        wildcard ??= group;
        continue;
      }
      if (needle.includes(agent) && agent.length > bestLength) {
        best = group;
        bestLength = agent.length;
      }
    }
  }

  return best ?? wildcard;
}

export interface RobotsPolicyFromTxtInput {
  readonly text: string;
  readonly userAgent: string;
  readonly robotsUrl: string | null;
  readonly fetchedAt: string;
  readonly respectRobots?: boolean | undefined;
}

/** Turn a fetched robots.txt into the stored snapshot the source registry holds. */
export function robotsPolicyFromTxt(input: RobotsPolicyFromTxtInput): RobotsPolicy {
  const parsed = parseRobotsTxt(input.text);
  const group = selectRobotsGroup(parsed, input.userAgent);
  return {
    respect_robots: input.respectRobots ?? true,
    user_agent: input.userAgent,
    crawl_delay_seconds: group?.crawlDelaySeconds ?? null,
    disallowed_paths: (group?.rules ?? []).filter((r) => r.type === 'disallow').map((r) => r.path),
    allowed_paths: (group?.rules ?? []).filter((r) => r.type === 'allow').map((r) => r.path),
    robots_url: input.robotsUrl,
    snapshot_hash: sha256Hex(input.text),
    snapshot_at: input.fetchedAt,
  };
}

export interface RobotsDecision {
  readonly allowed: boolean;
  readonly reason: string;
  /** The winning rule, as `allow:/path` or `disallow:/path`; null when none matched. */
  readonly matchedRule: string | null;
  readonly crawlDelaySeconds: number | null;
  readonly respected: boolean;
}

/** `*` matches any run of characters; `$` anchors to the end of the path. */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  let expression = '^';
  for (const character of pattern) {
    if (character === '*') expression += '.*';
    else if (character === '$') expression += '$';
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression).test(path);
}

function requestPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}

/**
 * Decide whether `url` may be fetched under a stored robots snapshot.
 *
 * Ties go to `Allow`, per RFC 9309 — the conservative reading would be to
 * disallow, but that silently breaks sites that use `Allow` to carve exceptions
 * out of a broad `Disallow`, which is the overwhelmingly common pattern.
 */
export function evaluateRobots(policy: RobotsPolicy, url: string): RobotsDecision {
  const crawlDelaySeconds = policy.crawl_delay_seconds;

  if (!policy.respect_robots) {
    return {
      allowed: true,
      reason:
        'robots directives are not being applied for this source (respect_robots=false); ' +
        'this must be backed by an explicit agreement recorded in the source policy.',
      matchedRule: null,
      crawlDelaySeconds,
      respected: false,
    };
  }

  const path = requestPath(url);
  let winner: { type: RobotsRuleType; path: string } | null = null;

  const consider = (type: RobotsRuleType, pattern: string): void => {
    if (!robotsPatternMatches(pattern, path)) return;
    if (winner === null || pattern.length > winner.path.length) {
      winner = { type, path: pattern };
      return;
    }
    // Equal specificity: Allow wins.
    if (pattern.length === winner.path.length && type === 'allow') {
      winner = { type, path: pattern };
    }
  };

  for (const pattern of policy.disallowed_paths) consider('disallow', pattern);
  for (const pattern of policy.allowed_paths) consider('allow', pattern);

  if (winner === null) {
    return {
      allowed: true,
      reason: 'no robots rule matches this path',
      matchedRule: null,
      crawlDelaySeconds,
      respected: true,
    };
  }

  const matched = winner as { type: RobotsRuleType; path: string };
  const allowed = matched.type === 'allow';
  return {
    allowed,
    reason: allowed
      ? `allowed by robots rule Allow: ${matched.path}`
      : `disallowed by robots rule Disallow: ${matched.path}`,
    matchedRule: `${matched.type}:${matched.path}`,
    crawlDelaySeconds,
    respected: true,
  };
}
