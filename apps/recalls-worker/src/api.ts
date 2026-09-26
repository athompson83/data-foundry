/**
 * The read surface. Exact identifiers (GTIN, NDC, lot, serial, model) resolve
 * through the key index, never through text similarity; full-text search is a
 * separate, explicit `q` parameter.
 */

import { expandUpcE, gs1CheckDigitValid, normaliseNdc, normaliseProductNdc, productOfPackageNdc, REASON_CLASSES, ALLERGENS, PATHOGENS, RECALL_CATEGORIES } from '@data-foundry/recall-structuring';

import type { D1Database, R2Bucket } from './env.js';
import { parseRawRef, sha256Hex, type KeyKind } from './store.js';

export const ATTRIBUTION = {
  source: 'U.S. Food and Drug Administration enforcement reports via openFDA (https://open.fda.gov)',
  license: 'CC0 1.0 Universal (public domain) — https://open.fda.gov/license/',
  disclaimer:
    'Structured by Data Foundry from FDA text. Not endorsed by FDA. Derived fields are produced by deterministic parsers and may be incomplete; the verbatim FDA record is available with include=raw. Do not rely on this data to make decisions regarding medical care.',
} as const;

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

interface RecallRow {
  recall_number: string;
  category: string;
  event_id: string | null;
  classification: string | null;
  status: string | null;
  voluntary: number | null;
  firm_name: string | null;
  firm_city: string | null;
  firm_state: string | null;
  firm_postal_code: string | null;
  firm_country: string | null;
  initiated_on: string | null;
  classified_on: string | null;
  reported_on: string | null;
  terminated_on: string | null;
  product_description: string | null;
  reason_for_recall: string | null;
  structured: string;
  raw_ref: string;
  raw_sha256: string;
  first_seen_at: string;
  last_seen_at: string;
  changed_at: string;
}

const COLUMNS = `recall_number, category, event_id, classification, status, voluntary, firm_name, firm_city, firm_state,
  firm_postal_code, firm_country, initiated_on, classified_on, reported_on, terminated_on, product_description,
  reason_for_recall, structured, raw_ref, raw_sha256, first_seen_at, last_seen_at, changed_at`;

export function presentRecall(row: RecallRow, raw?: unknown): Record<string, unknown> {
  const structured = JSON.parse(row.structured) as {
    distribution: unknown;
    quantity: unknown;
    codes: unknown;
    reason: unknown;
    provenance: { source_url: string; parser_version: string; derived_fields: unknown };
  };
  return {
    recall_number: row.recall_number,
    category: row.category,
    event_id: row.event_id,
    classification: row.classification,
    status: row.status,
    voluntary: row.voluntary === null ? null : row.voluntary === 1,
    firm: { name: row.firm_name, city: row.firm_city, state: row.firm_state, postal_code: row.firm_postal_code, country: row.firm_country },
    dates: { initiated: row.initiated_on, classified: row.classified_on, reported: row.reported_on, terminated: row.terminated_on },
    product_description: row.product_description,
    reason_for_recall: row.reason_for_recall,
    distribution: structured.distribution,
    quantity: structured.quantity,
    codes: structured.codes,
    reason: structured.reason,
    provenance: {
      source: 'openfda-enforcement',
      source_url: structured.provenance.source_url,
      parser_version: structured.provenance.parser_version,
      derived_fields: structured.provenance.derived_fields,
      raw_sha256: row.raw_sha256,
      raw_evidence: row.raw_ref.split('#')[0],
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      changed_at: row.changed_at,
    },
    ...(raw !== undefined ? { raw } : {}),
  };
}

/**
 * Read each row's verbatim record from its R2 byte range and check it against
 * the stored SHA-256, so what is served as evidence is provably what was fetched.
 */
async function loadRaw(bucket: R2Bucket, rows: readonly RecallRow[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  await Promise.all(
    rows.map(async (row) => {
      // Missing evidence is an integrity failure, reported like a digest mismatch.
      const ref = parseRawRef(row.raw_ref);
      if (!ref) throw new Error(`raw evidence reference is invalid for ${row.recall_number}`);
      const object = await bucket.get(ref.key, { range: { offset: ref.offset, length: ref.length } });
      if (!object) throw new Error(`raw evidence object is missing for ${row.recall_number}`);
      const text = await object.text();
      if ((await sha256Hex(text)) !== row.raw_sha256) throw new Error(`raw evidence digest mismatch for ${row.recall_number}`);
      out.set(row.recall_number, JSON.parse(text) as unknown);
    }),
  );
  return out;
}

async function present(bucket: R2Bucket, rows: readonly RecallRow[], includeRaw: boolean): Promise<Array<Record<string, unknown>>> {
  const raws = includeRaw ? await loadRaw(bucket, rows) : new Map<string, unknown>();
  return rows.map((row) => presentRecall(row, includeRaw ? (raws.get(row.recall_number) ?? null) : undefined));
}

function encodeCursor(reported: string, recallNumber: string): string {
  return btoa(`${reported}|${recallNumber}`).replace(/=+$/, '');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const [reported, recallNumber] = atob(cursor).split('|');
    if (reported === undefined || !recallNumber) throw new Error('bad');
    return [reported, recallNumber];
  } catch {
    throw new BadRequest('cursor is invalid');
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(name: string, value: string | null, allowed: readonly T[]): T | null {
  if (value === null || value === '') return null;
  const lower = value.toLowerCase() as T;
  const match = allowed.find((item) => item.toLowerCase() === lower);
  if (!match) throw new BadRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return match;
}

/** Normalise an identifier the way the parser stored it. */
/**
 * Every GTIN-14 a scanned or printed code can stand for. Eight digits are
 * ambiguous: EAN-8 as printed, or UPC-E, which is expanded to its UPC-A (the
 * form the index stores it in). Each reading must pass its own check digit.
 */
export function gtinCandidates(value: string): string[] {
  const digits = value.trim().replace(/[\s-]/g, '');
  if (!/^\d{8,14}$/.test(digits)) return [];
  const out = new Set<string>();
  if (gs1CheckDigitValid(digits)) out.add(digits.padStart(14, '0'));
  if (digits.length === 8) {
    const upcA = expandUpcE(digits);
    if (upcA && gs1CheckDigitValid(upcA)) out.add(upcA.padStart(14, '0'));
  }
  return [...out];
}

export function normaliseIdentifier(kind: 'lot' | 'serial' | 'model', value: string): string {
  return value.trim().toUpperCase();
}

/** A caller's NDC as either a 5-4-2 package code or a 5-4 product code. */
export function parseNdcInput(value: string): { package: string } | { product: string } | null {
  const trimmed = value.trim();
  const packaged = normaliseNdc(trimmed);
  if (packaged) return { package: packaged };
  const product = normaliseProductNdc(trimmed);
  if (product) return { product };
  const digits = trimmed.replace(/-/g, '');
  if (/^\d{11}$/.test(digits)) return { package: `${digits.slice(0, 5)}-${digits.slice(5, 9)}-${digits.slice(9)}` };
  return null;
}

/**
 * SQL over recall_key for an NDC. A package code matches that package or a
 * recall of its whole product; a product code matches the product or any of
 * its packages (an index range scan on the key's prefix).
 */
export function ndcCondition(input: { package: string } | { product: string }): { sql: string; binds: string[] } {
  if ('package' in input) {
    return { sql: "(kind = 'ndc' AND value IN (?, ?))", binds: [input.package, productOfPackageNdc(input.package)] };
  }
  return { sql: "(kind = 'ndc' AND (value = ? OR (value >= ? AND value < ?)))", binds: [input.product, `${input.product}-`, `${input.product}.`] };
}

/** FTS5 query from free text: every token quoted, implicitly ANDed. */
function ftsQuery(text: string): string {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (tokens.length === 0) throw new BadRequest('q must contain letters or digits');
  return tokens.map((token) => `"${token}"`).join(' ');
}

export async function searchRecalls(db: D1Database, bucket: R2Bucket, params: URLSearchParams): Promise<Record<string, unknown>> {
  const where: string[] = [];
  const binds: Array<string | number> = [];
  const keyFilter = (kind: KeyKind, value: string): void => {
    where.push('recall_number IN (SELECT recall_number FROM recall_key WHERE kind = ? AND value = ?)');
    binds.push(kind, value);
  };

  const gtinParam = params.get('gtin');
  if (gtinParam) {
    const gtins = gtinCandidates(gtinParam);
    if (gtins.length === 0) throw new BadRequest('gtin must be a UPC/UPC-E/EAN/GTIN/UDI-DI with a valid check digit');
    where.push(`recall_number IN (SELECT recall_number FROM recall_key WHERE kind = 'gtin' AND value IN (${gtins.map(() => '?').join(', ')}))`);
    binds.push(...gtins);
  }
  for (const kind of ['lot', 'serial', 'model'] as const) {
    const value = params.get(kind);
    if (value) keyFilter(kind, normaliseIdentifier(kind, value));
  }
  const ndcParam = params.get('ndc');
  if (ndcParam) {
    const input = parseNdcInput(ndcParam);
    if (!input) throw new BadRequest('ndc must be hyphenated (package 4-4-2, 5-3-2, 5-4-1, 5-4-2; product 4-4, 5-3, 5-4) or 11 digits');
    const condition = ndcCondition(input);
    where.push(`recall_number IN (SELECT recall_number FROM recall_key WHERE ${condition.sql})`);
    binds.push(...condition.binds);
  }
  const state = params.get('state');
  if (state) {
    if (!/^[A-Za-z]{2}$/.test(state)) throw new BadRequest('state must be a two-letter USPS code');
    const code = state.toUpperCase();
    // A nationwide recall reaches every state even when none is listed.
    where.push("(recall_number IN (SELECT recall_number FROM recall_key WHERE kind = 'state' AND value = ?) OR nationwide_us = 1)");
    binds.push(code);
  }
  const country = params.get('country');
  if (country) {
    if (!/^[A-Za-z]{2}$/.test(country)) throw new BadRequest('country must be an ISO 3166-1 alpha-2 code');
    keyFilter('country', country.toUpperCase());
  }
  const reasonClass = oneOf('reason_class', params.get('reason_class'), REASON_CLASSES);
  if (reasonClass) keyFilter('reason_class', reasonClass);
  const allergen = oneOf('allergen', params.get('allergen'), ALLERGENS);
  if (allergen) keyFilter('allergen', allergen);
  const pathogen = oneOf('pathogen', params.get('pathogen'), PATHOGENS);
  if (pathogen) keyFilter('pathogen', pathogen);

  const category = oneOf('category', params.get('category'), RECALL_CATEGORIES);
  if (category) {
    where.push('category = ?');
    binds.push(category);
  }
  const classification = oneOf('classification', params.get('classification'), ['I', 'II', 'III'] as const);
  if (classification) {
    where.push('classification = ?');
    binds.push(classification);
  }
  const status = oneOf('status', params.get('status'), ['Ongoing', 'Completed', 'Terminated', 'Pending'] as const);
  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  const firm = params.get('firm');
  if (firm) {
    if (firm.length < 2 || firm.length > 100) throw new BadRequest('firm must be 2–100 characters');
    where.push("firm_name LIKE ? ESCAPE '\\' COLLATE NOCASE");
    binds.push(`%${firm.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  const q = params.get('q');
  if (q) {
    where.push('rowid IN (SELECT rowid FROM recall_fts WHERE recall_fts MATCH ?)');
    binds.push(ftsQuery(q));
  }
  for (const [param, column, op] of [
    ['reported_from', 'reported_on', '>='],
    ['reported_to', 'reported_on', '<='],
    ['changed_since', 'changed_at', '>='],
  ] as const) {
    const value = params.get(param);
    if (!value) continue;
    if (param === 'changed_since' ? Number.isNaN(Date.parse(value)) : !DATE.test(value)) throw new BadRequest(`${param} must be ${param === 'changed_since' ? 'an ISO timestamp' : 'YYYY-MM-DD'}`);
    where.push(`${column} ${op} ?`);
    // changed_at is stored as UTC ISO text, so compare in the same form.
    binds.push(param === 'changed_since' ? new Date(value).toISOString() : value);
  }

  const limitParam = Number(params.get('limit') ?? 25);
  if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 100) throw new BadRequest('limit must be an integer from 1 to 100');
  const cursor = params.get('cursor');
  if (cursor) {
    const [reported, recallNumber] = decodeCursor(cursor);
    where.push("(COALESCE(reported_on, ''), recall_number) < (?, ?)");
    binds.push(reported, recallNumber);
  }
  const includeRaw = params.get('include') === 'raw';
  // Some raw records are megabytes of serial numbers; keep responses bounded.
  if (includeRaw && limitParam > 10) throw new BadRequest('include=raw allows limit up to 10');

  const sql = `SELECT ${COLUMNS} FROM recall
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(reported_on, '') DESC, recall_number DESC LIMIT ?`;
  const rows = await db.prepare(sql).bind(...binds, limitParam + 1).all<RecallRow>();
  const page = rows.results.slice(0, limitParam);
  const last = page[page.length - 1];
  return {
    data: await present(bucket, page, includeRaw),
    next_cursor: rows.results.length > limitParam && last ? encodeCursor(last.reported_on ?? '', last.recall_number) : null,
    attribution: ATTRIBUTION,
  };
}

export async function getRecall(db: D1Database, bucket: R2Bucket, recallNumber: string, includeRaw: boolean): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM recall WHERE recall_number = ?`).bind(recallNumber).first<RecallRow>();
  return row ? { data: (await present(bucket, [row], includeRaw))[0], attribution: ATTRIBUTION } : null;
}

/** Every exact interpretation of one code a caller scanned or typed. */
export function lookupCandidates(code: string): Array<readonly [KeyKind, string]> {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 64) throw new BadRequest('code must be 1–64 characters');
  const candidates: Array<readonly [KeyKind, string]> = [];
  for (const gtin of gtinCandidates(trimmed)) candidates.push(['gtin', gtin]);
  const ndc = parseNdcInput(trimmed);
  if (ndc && 'package' in ndc) candidates.push(['ndc', ndc.package], ['ndc', productOfPackageNdc(ndc.package)]);
  else if (ndc) candidates.push(['ndc', ndc.product]);
  const upper = trimmed.toUpperCase();
  for (const kind of ['lot', 'serial', 'model'] as const) candidates.push([kind, upper]);
  return candidates;
}

export async function lookupCode(db: D1Database, bucket: R2Bucket, code: string, includeRaw: boolean): Promise<Record<string, unknown>> {
  const candidates = lookupCandidates(code);
  const clauses = candidates.map(() => '(kind = ? AND value = ?)');
  const binds: string[] = candidates.flatMap(([kind, value]) => [kind, value]);
  // A product code also finds the recalls that list only its packages.
  const ndc = parseNdcInput(code);
  if (ndc && 'product' in ndc) {
    const condition = ndcCondition(ndc);
    clauses.push(condition.sql);
    binds.push(...condition.binds);
  }
  const matches = await db
    .prepare(`SELECT kind, value, recall_number FROM recall_key WHERE ${clauses.join(' OR ')} LIMIT 200`)
    .bind(...binds)
    .all<{ kind: KeyKind; value: string; recall_number: string }>();
  const byRecall = new Map<string, Array<{ kind: KeyKind; value: string }>>();
  for (const match of matches.results) {
    const list = byRecall.get(match.recall_number) ?? [];
    list.push({ kind: match.kind, value: match.value });
    byRecall.set(match.recall_number, list);
  }
  const ids = [...byRecall.keys()].slice(0, includeRaw ? 10 : 100);
  if (ids.length === 0) return { data: [], interpreted_as: candidates.map(([kind, value]) => ({ kind, value })), attribution: ATTRIBUTION };
  const rows = await db
    .prepare(`SELECT ${COLUMNS} FROM recall WHERE recall_number IN (${ids.map(() => '?').join(',')}) ORDER BY COALESCE(reported_on, '') DESC`)
    .bind(...ids)
    .all<RecallRow>();
  const presented = await present(bucket, rows.results, includeRaw);
  return {
    data: rows.results.map((row, index) => ({ matched_on: byRecall.get(row.recall_number), recall: presented[index] })),
    interpreted_as: candidates.map(([kind, value]) => ({ kind, value })),
    attribution: ATTRIBUTION,
  };
}

export async function stats(db: D1Database): Promise<Record<string, unknown>> {
  const [byCategory, lastSync, keyCounts] = await Promise.all([
    db.prepare('SELECT category, COUNT(*) AS recalls, MAX(reported_on) AS latest_report FROM recall GROUP BY category ORDER BY category').all<{ category: string; recalls: number; latest_report: string }>(),
    db.prepare("SELECT MAX(finished_at) AS finished_at FROM sync_run WHERE status = 'SUCCEEDED'").first<{ finished_at: string | null }>(),
    db.prepare("SELECT kind, COUNT(DISTINCT value) AS distinct_values FROM recall_key WHERE kind IN ('gtin', 'ndc', 'lot') GROUP BY kind").all<{ kind: string; distinct_values: number }>(),
  ]);
  return {
    categories: byCategory.results,
    identifiers: Object.fromEntries(keyCounts.results.map((row) => [row.kind, row.distinct_values])),
    last_successful_sync: lastSync?.finished_at ?? null,
    attribution: ATTRIBUTION,
  };
}
