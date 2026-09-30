import type { RobotsPolicy } from '@data-foundry/canonical-schema';
import { AcquisitionError } from '../errors.js';
import type { AcquisitionResultUrlPolicy } from '../types.js';
import { hasUnsafeUrlEncoding, pathMatchesPrefix } from './result-policy.js';
import { evaluateRobots } from './robots.js';

/**
 * Sitemap parsing and target planning for the `SITEMAP` acquisition method.
 *
 * The HTTP provider already fetches a sitemap as an ordinary artifact. This
 * module turns that stored artifact into the bounded, ordered list of page URLs
 * a later run may fetch:
 *
 * - {@link parseSitemapXml} reads a `<urlset>` or `<sitemapindex>` document
 *   (sitemaps.org protocol 0.9) into `{loc, lastmod}` entries;
 * - {@link planSitemapTargets} filters those entries through the source's
 *   result-URL policy and robots snapshot, drops entries whose `lastmod` proves
 *   them unchanged, and orders the rest oldest first, in resumable slices.
 *
 * Neither function fetches anything. A sitemap is a discovery hint, not a
 * complete snapshot of the source: a plan built from it is incremental work and
 * never authorises omission-based retirement of records that are absent from it
 * (see `docs/data-adapter-contracts.md`).
 */

/** Protocol ceilings: 50,000 entries and 50 MB uncompressed per sitemap file. */
export const SITEMAP_MAX_ENTRIES = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

export type SitemapKind = 'urlset' | 'sitemapindex';

export interface SitemapEntry {
  /** Absolute URL, entity-decoded, exactly as the sitemap declares it. */
  readonly loc: string;
  /** `lastmod` normalised to an ISO-8601 UTC instant; null when absent or unparseable. */
  readonly lastmod: string | null;
}

export interface ParsedSitemap {
  readonly kind: SitemapKind;
  readonly entries: readonly SitemapEntry[];
  /** Entries dropped or fields ignored, one line each. Never silently discarded. */
  readonly issues: readonly string[];
}

export interface ParseSitemapOptions {
  /** Where the sitemap was fetched from. Entries on another origin are dropped, per the protocol. */
  readonly sitemapUrl: string;
  readonly maxEntries?: number | undefined;
  readonly maxBytes?: number | undefined;
}

export class SitemapParseError extends AcquisitionError {
  override readonly name = 'SitemapParseError';
}

const COMMENT = /<!--[\s\S]*?-->/g;
const ROOT = /<(?:[A-Za-z_][\w.-]*:)?(urlset|sitemapindex)\b/;
const BLOCK = /<(?:[A-Za-z_][\w.-]*:)?(url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/g;
const field = (name: string): RegExp =>
  new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`);
const LOC = field('loc');
const LASTMOD = field('lastmod');
const CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

/** W3C Datetime profile used by the sitemap protocol: YYYY, YYYY-MM, YYYY-MM-DD, or a full timestamp with zone. */
const W3C_DATETIME =
  /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlText(raw: string): string {
  const trimmed = raw.trim();
  const cdata = CDATA.exec(trimmed);
  if (cdata !== null) return (cdata[1] ?? '').trim();
  return trimmed.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function normaliseLastmod(value: string): string | null {
  if (!W3C_DATETIME.test(value)) return null;
  // `Date.parse` rolls impossible dates over (2026-02-30 becomes 2026-03-02), so check the calendar first.
  const [year = 0, month = 1, day = 1] = value.slice(0, 10).split('-').map(Number);
  const hour = value.length > 10 ? Number(value.slice(11, 13)) : 0;
  const minute = value.length > 10 ? Number(value.slice(14, 16)) : 0;
  const second = value.length > 16 && value[16] === ':' ? Number(value.slice(17, 19)) : 0;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offset !== null && (Number(offset[2]) > 14 || Number(offset[3]) > 59))
  ) {
    return null;
  }
  // Date-only forms mean UTC midnight; pad them so no runtime reads them as local time.
  const padded =
    value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const withZone = padded.length === 10 ? `${padded}T00:00:00Z` : padded;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Parse one sitemap document. Exceeding the entry or byte ceiling is an error,
 * not a truncation, so a caller can never mistake a partial list for the whole.
 */
export function parseSitemapXml(text: string, options: ParseSitemapOptions): ParsedSitemap {
  const maxBytes = options.maxBytes ?? SITEMAP_MAX_BYTES;
  const maxEntries = options.maxEntries ?? SITEMAP_MAX_ENTRIES;
  if (utf8Length(text) > maxBytes) {
    throw new SitemapParseError(`Sitemap exceeds ${maxBytes} bytes; refusing to parse a partial document.`);
  }

  let sitemapOrigin: string;
  try {
    sitemapOrigin = new URL(options.sitemapUrl).origin;
  } catch {
    throw new SitemapParseError('sitemapUrl must be an absolute URL.');
  }

  const body = text.replace(COMMENT, '');
  const root = ROOT.exec(body);
  if (root === null) {
    throw new SitemapParseError('Document is neither a <urlset> nor a <sitemapindex>.');
  }
  const kind = root[1] as SitemapKind;
  const expectedBlock = kind === 'urlset' ? 'url' : 'sitemap';

  const entries: SitemapEntry[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  let ordinal = 0;

  for (const match of body.matchAll(BLOCK)) {
    ordinal += 1;
    const [, blockName, inner = ''] = match;
    if (blockName !== expectedBlock) {
      issues.push(`entry ${ordinal}: <${blockName}> inside <${kind}> ignored`);
      continue;
    }
    const locMatch = LOC.exec(inner);
    const loc = locMatch === null ? '' : decodeXmlText(locMatch[1] ?? '');
    if (loc === '') {
      issues.push(`entry ${ordinal}: missing <loc>`);
      continue;
    }
    let url: URL;
    try {
      url = new URL(loc);
    } catch {
      issues.push(`entry ${ordinal}: <loc> is not an absolute URL`);
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      issues.push(`entry ${ordinal}: unsupported scheme ${url.protocol}`);
      continue;
    }
    if (url.origin !== sitemapOrigin) {
      issues.push(`entry ${ordinal}: ${url.origin} is not the sitemap's origin`);
      continue;
    }
    if (seen.has(loc)) {
      issues.push(`entry ${ordinal}: duplicate <loc>`);
      continue;
    }
    if (entries.length >= maxEntries) {
      throw new SitemapParseError(
        `Sitemap declares more than ${maxEntries} entries; refusing to return a partial list.`,
      );
    }
    seen.add(loc);

    let lastmod: string | null = null;
    const lastmodMatch = LASTMOD.exec(inner);
    if (lastmodMatch !== null) {
      const raw = decodeXmlText(lastmodMatch[1] ?? '');
      lastmod = normaliseLastmod(raw);
      if (lastmod === null) issues.push(`entry ${ordinal}: unparseable <lastmod> ignored`);
    }
    entries.push({ loc, lastmod });
  }

  return { kind, entries, issues };
}

export type SitemapSkipReason =
  | 'OUTSIDE_RESULT_POLICY'
  | 'ROBOTS_DISALLOWED'
  | 'UNCHANGED_SINCE_LAST_RUN';

/** Position in a plan's order; entries at or before it were handed out by an earlier slice. */
export interface SitemapPlanCursor {
  readonly lastmod: string | null;
  readonly loc: string;
}

export interface SitemapTargetPlanInput {
  readonly entries: readonly SitemapEntry[];
  /** The source's reviewed origins and path prefixes. Required: a sitemap never widens scope. */
  readonly policy: AcquisitionResultUrlPolicy;
  /** Stored robots snapshot for the origin; omitted only when the caller has already applied it. */
  readonly robots?: RobotsPolicy | undefined;
  /**
   * ISO instant; entries with `lastmod` at or before it are skipped. Hold it fixed
   * for every slice of a cycle and advance it only when a plan returns no `nextCursor`.
   */
  readonly changedSince?: string | null | undefined;
  /** The previous slice's `nextCursor`, to continue the same cycle. */
  readonly after?: SitemapPlanCursor | null | undefined;
  /** Upper bound on targets returned for this run; the rest are reported as deferred. */
  readonly maxTargets: number;
}

export interface SitemapTargetPlan {
  /** Oldest `lastmod` first, then undated entries, ties broken by URL. */
  readonly targets: readonly SitemapEntry[];
  /** Eligible entries after this slice, left for a later run. */
  readonly deferred: number;
  /** Pass as `after` next run while non-null; null once the cycle is drained. */
  readonly nextCursor: SitemapPlanCursor | null;
  /**
   * Latest `lastmod` among all eligible entries, including earlier slices'. Once
   * `nextCursor` is null and every slice has published, it is the next cycle's
   * `changedSince`. Null when no eligible entry is dated.
   */
  readonly watermark: string | null;
  readonly skipped: Readonly<Record<SitemapSkipReason, number>>;
}

/**
 * Oldest first, so entries whose `lastmod` moves forward mid-cycle, and entries
 * added mid-cycle, sort after the cursor and are still reached in this cycle.
 */
function comparePlanOrder(a: SitemapPlanCursor, b: SitemapPlanCursor): number {
  if (a.lastmod !== b.lastmod) {
    if (a.lastmod === null) return 1;
    if (b.lastmod === null) return -1;
    return a.lastmod < b.lastmod ? -1 : 1;
  }
  return a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0;
}

/**
 * Decide which sitemap entries this run should fetch.
 *
 * An entry without `lastmod` is always eligible: the absence of a date proves
 * nothing about change. `changedSince` must come from the last cycle whose
 * artifacts were published, not merely downloaded. A sitemap larger than
 * `maxTargets` is worked through in slices with `after`/`nextCursor`.
 */
export function planSitemapTargets(input: SitemapTargetPlanInput): SitemapTargetPlan {
  if (!Number.isSafeInteger(input.maxTargets) || input.maxTargets <= 0) {
    throw new SitemapParseError('maxTargets must be a positive integer.');
  }
  const since =
    input.changedSince === undefined || input.changedSince === null ? null : Date.parse(input.changedSince);
  if (since !== null && !Number.isFinite(since)) {
    throw new SitemapParseError('changedSince must be an ISO-8601 instant.');
  }
  const after = input.after ?? null;

  const skipped: Record<SitemapSkipReason, number> = {
    OUTSIDE_RESULT_POLICY: 0,
    ROBOTS_DISALLOWED: 0,
    UNCHANGED_SINCE_LAST_RUN: 0,
  };
  const eligible: SitemapEntry[] = [];

  for (const entry of input.entries) {
    let url: URL;
    try {
      url = new URL(entry.loc);
    } catch {
      skipped.OUTSIDE_RESULT_POLICY += 1;
      continue;
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      hasUnsafeUrlEncoding(entry.loc) ||
      !input.policy.allowedOrigins.includes(url.origin) ||
      !input.policy.allowedPathPrefixes.some((prefix) => pathMatchesPrefix(url.pathname, prefix))
    ) {
      skipped.OUTSIDE_RESULT_POLICY += 1;
      continue;
    }
    if (input.robots !== undefined && !evaluateRobots(input.robots, entry.loc).allowed) {
      skipped.ROBOTS_DISALLOWED += 1;
      continue;
    }
    if (since !== null && entry.lastmod !== null && Date.parse(entry.lastmod) <= since) {
      skipped.UNCHANGED_SINCE_LAST_RUN += 1;
      continue;
    }
    eligible.push(entry);
  }

  eligible.sort(comparePlanOrder);
  const watermark = eligible.reduce<string | null>(
    (latest, entry) => (entry.lastmod !== null && (latest === null || entry.lastmod > latest) ? entry.lastmod : latest),
    null,
  );
  const remaining = after === null ? eligible : eligible.filter((entry) => comparePlanOrder(entry, after) > 0);
  const targets = remaining.slice(0, input.maxTargets);
  const deferred = remaining.length - targets.length;
  const last = targets.at(-1);

  return {
    targets,
    deferred,
    nextCursor: deferred > 0 && last !== undefined ? { lastmod: last.lastmod, loc: last.loc } : null,
    watermark,
    skipped,
  };
}
