/**
 * Read surface of the consumer-product recall dataset. Exact identifiers
 * (GTIN, model) resolve through the key index, never text similarity; `q` is
 * a separate, explicit full-text filter. Linked notices come only from
 * declared citations, resolved at read time.
 */

import { HAZARD_CLASSES, REMEDY_CLASSES, TRADE_FACETS, modelKey, type StructuredProductRecall } from '@data-foundry/product-recall-structuring';

import { BadRequest, gtinCandidates } from './api.js';
import type { D1Database, R2Bucket } from './env.js';
import { parseRawRef, sha256Hex } from './store.js';

export const PRODUCT_ATTRIBUTION = {
  sources: [
    {
      agency: 'CPSC',
      source: 'U.S. Consumer Product Safety Commission recalls via the CPSC Recall API (https://www.saferproducts.gov/RestWebServices/Recall)',
      license: 'US Government work (17 U.S.C. §105); CPSC: "You may freely copy and distribute recall notices"',
    },
    {
      agency: 'HC',
      source: 'Health Canada Recalls and Safety Alerts open data (https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3)',
      license: 'Contains information licensed under the Open Government Licence – Canada (https://open.canada.ca/en/open-government-licence-canada)',
    },
  ],
  disclaimer:
    'Structured by Data Foundry from agency notices. Not affiliated with or endorsed by CPSC, Health Canada or the Government of Canada. Derived fields are produced by deterministic parsers and may be incomplete; the source record is available with include=raw, with contact text and images withheld (see raw_redaction). Notices are linked only where one agency cites the other; they are never merged by name.',
} as const;

interface ProductRow {
  id: string;
  agency: string;
  url_key: string;
  structured: string;
  raw_ref: string;
  raw_sha256: string;
  first_seen_at: string;
  last_seen_at: string;
  changed_at: string;
  sort_date: string;
}

const COLUMNS = 'id, agency, url_key, structured, raw_ref, raw_sha256, first_seen_at, last_seen_at, changed_at, sort_date';

export interface LinkedNotice {
  readonly id: string;
  readonly agency: string;
  readonly title: string;
  readonly url: string;
  /** "cites" when this notice names the other; "cited_by" when the other names this one. */
  readonly relation: 'cites' | 'cited_by';
  readonly basis: 'declared_citation';
}

export type PresentedProductRecall = Omit<StructuredProductRecall, 'provenance'> & {
  readonly linked_notices: LinkedNotice[];
  readonly provenance: StructuredProductRecall['provenance'] & {
    readonly raw_sha256: string;
    readonly raw_evidence: string;
    readonly first_seen_at: string;
    readonly last_seen_at: string;
    readonly changed_at: string;
  };
  readonly raw?: unknown;
  /** With include=raw: which source fields were removed, and the SHA-256 of `raw` exactly as returned. */
  readonly raw_redaction?: { readonly removed_fields: string[]; readonly presented_sha256: string };
};

async function linksFor(db: D1Database, rows: readonly ProductRow[]): Promise<Map<string, LinkedNotice[]>> {
  const out = new Map<string, LinkedNotice[]>(rows.map((row) => [row.id, []]));
  if (rows.length === 0) return out;
  const ids = JSON.stringify(rows.map((row) => row.id));
  const urls = JSON.stringify(rows.map((row) => row.url_key));
  const [cites, citedBy] = await Promise.all([
    db
      .prepare(`SELECT c.recall_id AS source, r.id, r.agency, r.title, r.url FROM product_recall_citation c JOIN product_recall r ON r.url_key = c.url_key
        WHERE c.recall_id IN (SELECT value FROM json_each(?)) AND r.id <> c.recall_id ORDER BY r.id`)
      .bind(ids)
      .all<{ source: string; id: string; agency: string; title: string; url: string }>(),
    db
      .prepare(`SELECT c.url_key AS target, r.id, r.agency, r.title, r.url FROM product_recall_citation c JOIN product_recall r ON r.id = c.recall_id
        WHERE c.url_key IN (SELECT value FROM json_each(?)) ORDER BY r.id`)
      .bind(urls)
      .all<{ target: string; id: string; agency: string; title: string; url: string }>(),
  ]);
  for (const link of cites.results) out.get(link.source)?.push({ id: link.id, agency: link.agency, title: link.title, url: link.url, relation: 'cites', basis: 'declared_citation' });
  for (const link of citedBy.results) {
    for (const row of rows) {
      if (row.url_key === link.target && row.id !== link.id) out.get(row.id)?.push({ id: link.id, agency: link.agency, title: link.title, url: link.url, relation: 'cited_by', basis: 'declared_citation' });
    }
  }
  return out;
}

async function loadRaw(bucket: R2Bucket, rows: readonly ProductRow[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  await Promise.all(
    rows.map(async (row) => {
      const ref = parseRawRef(row.raw_ref);
      if (!ref) throw new Error(`raw evidence reference is invalid for ${row.id}`);
      const object = await bucket.get(ref.key, { range: { offset: ref.offset, length: ref.length } });
      if (!object) throw new Error(`raw evidence object is missing for ${row.id}`);
      const text = await object.text();
      if ((await sha256Hex(text)) !== row.raw_sha256) throw new Error(`raw evidence digest mismatch for ${row.id}`);
      out.set(row.id, JSON.parse(text) as unknown);
    }),
  );
  return out;
}

/** Source fields never republished (rights records): CPSC contact text and images; Health Canada's advice/contact text. */
const WITHHELD_FIELDS: Readonly<Record<string, readonly string[]>> = { CPSC: ['ConsumerContact', 'Images'], HC: ['What you should do'] };

/**
 * The raw record as served. provenance.raw_sha256 stays the digest of the stored
 * original (the evidence); the removed field names and the digest of the object
 * returned are reported beside it, so a consumer can verify what it received.
 */
async function redactRaw(agency: string, raw: unknown): Promise<{ raw: unknown; raw_redaction?: { removed_fields: string[]; presented_sha256: string } }> {
  if (!raw || typeof raw !== 'object') return { raw };
  const copy = { ...(raw as Record<string, unknown>) };
  const removed = (WITHHELD_FIELDS[agency] ?? []).filter((field) => field in copy);
  for (const field of removed) delete copy[field];
  return { raw: copy, raw_redaction: { removed_fields: removed, presented_sha256: await sha256Hex(JSON.stringify(copy)) } };
}

export async function presentRows(db: D1Database, bucket: R2Bucket, rows: readonly ProductRow[], includeRaw: boolean): Promise<PresentedProductRecall[]> {
  const [links, raws] = await Promise.all([linksFor(db, rows), includeRaw ? loadRaw(bucket, rows) : Promise.resolve(new Map<string, unknown>())]);
  return Promise.all(rows.map(async (row) => {
    const recall = JSON.parse(row.structured) as StructuredProductRecall;
    return {
      ...recall,
      linked_notices: links.get(row.id) ?? [],
      provenance: {
        ...recall.provenance,
        raw_sha256: row.raw_sha256,
        raw_evidence: row.raw_ref.split('#')[0] as string,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
        changed_at: row.changed_at,
      },
      ...(includeRaw ? await redactRaw(row.agency, raws.get(row.id) ?? null) : {}),
    };
  }));
}

function encodeCursor(sortDate: string, id: string): string {
  return btoa(`${sortDate}|${id}`).replace(/=+$/, '');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const [sortDate, id] = atob(cursor).split('|');
    if (!sortDate || !id) throw new Error('bad');
    return [sortDate, id];
  } catch {
    throw new BadRequest('cursor is invalid');
  }
}

function oneOf<T extends string>(name: string, value: string | null, allowed: readonly T[]): T | null {
  if (value === null || value === '') return null;
  const match = allowed.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!match) throw new BadRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return match;
}

function ftsQuery(text: string): string {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (tokens.length === 0) throw new BadRequest('q must contain letters or digits');
  return tokens.map((token) => `"${token}"`).join(' ');
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AGENCIES = ['CPSC', 'HC'] as const;

export async function searchProductRecalls(db: D1Database, bucket: R2Bucket, params: URLSearchParams): Promise<Record<string, unknown>> {
  const where: string[] = [];
  const binds: Array<string | number> = [];
  const keyFilter = (kind: string, values: readonly string[]): void => {
    where.push(`id IN (SELECT recall_id FROM product_recall_key WHERE kind = ? AND value IN (${values.map(() => '?').join(', ')}))`);
    binds.push(kind, ...values);
  };
  const gtin = params.get('gtin');
  if (gtin) {
    const gtins = gtinCandidates(gtin);
    if (gtins.length === 0) throw new BadRequest('gtin must be a UPC/UPC-E/EAN/GTIN with a valid check digit');
    keyFilter('gtin', gtins);
  }
  const model = params.get('model');
  if (model) {
    const key = modelKey(model);
    if (key.length < 2) throw new BadRequest('model must contain at least two letters or digits');
    keyFilter('model', [key]);
  }
  const hazard = oneOf('hazard', params.get('hazard'), HAZARD_CLASSES);
  if (hazard) keyFilter('hazard', [hazard]);
  const remedy = oneOf('remedy', params.get('remedy'), REMEDY_CLASSES);
  if (remedy) keyFilter('remedy', [remedy]);
  const facet = oneOf('facet', params.get('facet'), TRADE_FACETS);
  if (facet) keyFilter('facet', [facet]);
  const category = params.get('category');
  if (category) keyFilter('category', [category.toLowerCase()]);
  const country = params.get('manufacturer_country');
  if (country) keyFilter('country', [country.toLowerCase()]);
  const agency = oneOf('agency', params.get('agency'), AGENCIES);
  if (agency) {
    where.push('agency = ?');
    binds.push(agency);
  }
  const firm = params.get('firm');
  if (firm) {
    if (firm.length < 2 || firm.length > 100) throw new BadRequest('firm must be 2–100 characters');
    where.push("rowid IN (SELECT rowid FROM product_recall_fts WHERE product_recall_fts MATCH ?)");
    binds.push(`firms : (${ftsQuery(firm)})`);
  }
  const q = params.get('q');
  if (q) {
    where.push('rowid IN (SELECT rowid FROM product_recall_fts WHERE product_recall_fts MATCH ?)');
    binds.push(ftsQuery(q));
  }
  const linked = params.get('linked');
  if (linked === 'true') where.push('(id IN (SELECT c.recall_id FROM product_recall_citation c JOIN product_recall t ON t.url_key = c.url_key) OR url_key IN (SELECT url_key FROM product_recall_citation))');
  else if (linked && linked !== 'false') throw new BadRequest('linked must be true or false');
  for (const [param, op] of [
    ['from', '>='],
    ['to', '<='],
  ] as const) {
    const value = params.get(param);
    if (!value) continue;
    if (!DATE.test(value)) throw new BadRequest(`${param} must be YYYY-MM-DD`);
    where.push(`sort_date ${op} ?`);
    binds.push(value);
  }
  const changedSince = params.get('changed_since');
  if (changedSince) {
    if (Number.isNaN(Date.parse(changedSince))) throw new BadRequest('changed_since must be an ISO timestamp');
    where.push('changed_at >= ?');
    binds.push(new Date(changedSince).toISOString());
  }
  const limit = Number(params.get('limit') ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequest('limit must be an integer from 1 to 100');
  const includeRaw = params.get('include') === 'raw';
  if (includeRaw && limit > 25) throw new BadRequest('include=raw allows limit up to 25');
  const cursor = params.get('cursor');
  if (cursor) {
    const [sortDate, id] = decodeCursor(cursor);
    where.push('(sort_date, id) < (?, ?)');
    binds.push(sortDate, id);
  }
  const rows = await db
    .prepare(`SELECT ${COLUMNS} FROM product_recall ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_date DESC, id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<ProductRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: await presentRows(db, bucket, page, includeRaw),
    next_cursor: rows.results.length > limit && last ? encodeCursor(last.sort_date, last.id) : null,
    attribution: PRODUCT_ATTRIBUTION,
  };
}

export const PRODUCT_ID = /^(cpsc-\d{5}[a-z]?|hc-\d{1,8})$/;

export async function getProductRecall(db: D1Database, bucket: R2Bucket, id: string, includeRaw: boolean): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM product_recall WHERE id = ?`).bind(id.toLowerCase()).first<ProductRow>();
  return row ? { data: (await presentRows(db, bucket, [row], includeRaw))[0], attribution: PRODUCT_ATTRIBUTION } : null;
}

export const PRODUCT_LOOKUP_LIMIT = 100;

/** Every exact interpretation of one scanned or typed code: GTIN (check-digit valid) and model key. */
export async function lookupProductCode(db: D1Database, bucket: R2Bucket, code: string, includeRaw: boolean): Promise<Record<string, unknown>> {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 64) throw new BadRequest('code must be 1–64 characters');
  const interpretations: Array<{ kind: string; value: string }> = gtinCandidates(trimmed).map((value) => ({ kind: 'gtin', value }));
  const key = modelKey(trimmed);
  if (key.length >= 2) interpretations.push({ kind: 'model', value: key });
  if (interpretations.length === 0) throw new BadRequest('code must contain letters or digits');
  const clause = interpretations.map(() => '(kind = ? AND value = ?)').join(' OR ');
  const binds = interpretations.flatMap((item) => [item.kind, item.value]);
  const limit = includeRaw ? 25 : PRODUCT_LOOKUP_LIMIT;
  const [rows, total, matched] = await Promise.all([
    db.prepare(`SELECT ${COLUMNS} FROM product_recall WHERE id IN (SELECT recall_id FROM product_recall_key WHERE ${clause}) ORDER BY sort_date DESC, id DESC LIMIT ?`).bind(...binds, limit).all<ProductRow>(),
    db.prepare(`SELECT COUNT(DISTINCT recall_id) AS n FROM product_recall_key WHERE ${clause}`).bind(...binds).first<{ n: number }>(),
    db.prepare(`SELECT kind, value, recall_id FROM product_recall_key WHERE ${clause}`).bind(...binds).all<{ kind: string; value: string; recall_id: string }>(),
  ]);
  const byRecall = new Map<string, Array<{ kind: string; value: string }>>();
  for (const match of matched.results) byRecall.set(match.recall_id, [...(byRecall.get(match.recall_id) ?? []), { kind: match.kind, value: match.value }]);
  const presented = await presentRows(db, bucket, rows.results, includeRaw);
  return {
    data: presented.map((recall) => ({ matched_on: byRecall.get(recall.id) ?? [], recall })),
    total_matches: total?.n ?? 0,
    truncated: (total?.n ?? 0) > rows.results.length,
    interpreted_as: interpretations,
    attribution: PRODUCT_ATTRIBUTION,
  };
}

export async function productStats(db: D1Database): Promise<Record<string, unknown>> {
  const [agencies, lastSync, identifiers, facets, links] = await Promise.all([
    db.prepare('SELECT agency, COUNT(*) AS notices, MAX(sort_date) AS latest FROM product_recall GROUP BY agency ORDER BY agency').all<{ agency: string; notices: number; latest: string }>(),
    db.prepare("SELECT category AS source, MAX(finished_at) AS finished_at FROM sync_run WHERE status = 'SUCCEEDED' AND category LIKE 'product:%' GROUP BY category").all<{ source: string; finished_at: string }>(),
    db.prepare("SELECT kind, COUNT(DISTINCT value) AS distinct_values FROM product_recall_key WHERE kind IN ('gtin', 'model') GROUP BY kind").all<{ kind: string; distinct_values: number }>(),
    db.prepare("SELECT value AS facet, COUNT(*) AS notices FROM product_recall_key WHERE kind = 'facet' GROUP BY value ORDER BY value").all<{ facet: string; notices: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM product_recall_citation c JOIN product_recall r ON r.url_key = c.url_key').first<{ n: number }>(),
  ]);
  return {
    agencies: agencies.results,
    identifiers: Object.fromEntries(identifiers.results.map((row) => [row.kind, row.distinct_values])),
    trade_facets: Object.fromEntries(facets.results.map((row) => [row.facet, row.notices])),
    declared_cross_agency_links: links?.n ?? 0,
    last_successful_sync: Object.fromEntries(lastSync.results.map((row) => [row.source.replace('product:', ''), row.finished_at])),
    attribution: PRODUCT_ATTRIBUTION,
  };
}
