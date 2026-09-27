/**
 * Storage for the North American consumer-product recall dataset (CPSC and
 * Health Canada): the same evidence model as the FDA dataset. The verbatim
 * source record lives in R2 at an exact byte range, and every D1 row, key and
 * citation is derived from it by the recorded parser version.
 */

import {
  canonicalHcUrl,
  isConsumerProductRecord,
  isUsableCpscRecord,
  structureCpscRecall,
  structureHcRecall,
  type CpscRecallRecord,
  type HcRecallRecord,
  type StructuredProductRecall,
} from '@data-foundry/product-recall-structuring';

import { sha256Hex, type Statement } from './store.js';

export type ProductAgency = 'CPSC' | 'HC';

export interface PreparedProductRecall {
  readonly recall: StructuredProductRecall;
  readonly raw: string;
  readonly rawSha256: string;
}

/** Whether a source record is in scope and has a stable identity. Others are kept as evidence only. */
export function isPublishable(agency: ProductAgency, record: unknown): boolean {
  return agency === 'CPSC' ? isUsableCpscRecord(record as CpscRecallRecord) : isConsumerProductRecord(record as HcRecallRecord);
}

export async function prepareProductRecall(agency: ProductAgency, record: unknown): Promise<PreparedProductRecall> {
  const raw = JSON.stringify(record);
  const recall = agency === 'CPSC' ? structureCpscRecall(record as CpscRecallRecord) : structureHcRecall(record as HcRecallRecord);
  return { recall, raw, rawSha256: await sha256Hex(raw) };
}

/** The citation target key for a notice URL: the canonical Health Canada form, else the lower-cased URL. */
export function urlKey(url: string): string {
  return canonicalHcUrl(url) ?? url.trim().toLowerCase().replace(/^http:\/\//, 'https://').replace(/\/+$/, '');
}

/** Rule 8: a public page is indexable only when the agency published a substantive description and hazard statement. */
export const MIN_INDEXABLE_DESCRIPTION = 120;
export function isIndexableNotice(recall: StructuredProductRecall): boolean {
  return (recall.description?.length ?? 0) >= MIN_INDEXABLE_DESCRIPTION && (recall.hazard.text?.length ?? 0) >= 20;
}

export type ProductKeyKind = 'gtin' | 'model' | 'hazard' | 'remedy' | 'facet' | 'category' | 'country';

export function productKeys(recall: StructuredProductRecall): Array<readonly [ProductKeyKind, string]> {
  const keys: Array<readonly [ProductKeyKind, string]> = [];
  for (const gtin of recall.identifiers.gtins) keys.push(['gtin', gtin]);
  for (const model of recall.identifiers.model_keys) keys.push(['model', model]);
  for (const hazard of recall.hazard.classes) keys.push(['hazard', hazard]);
  for (const remedy of recall.remedy.classes) keys.push(['remedy', remedy]);
  for (const facet of recall.trade_facets) keys.push(['facet', facet]);
  if (recall.product_category) keys.push(['category', recall.product_category.toLowerCase()]);
  for (const country of recall.manufacturer_countries) keys.push(['country', country.toLowerCase()]);
  return keys;
}

const COLUMNS = [
  'id', 'agency', 'source_id', 'title', 'url', 'url_key', 'published_on', 'updated_on', 'sort_date', 'archived',
  'product_category', 'title_firm', 'units_us', 'units_canada', 'indexable', 'structured', 'raw_ref', 'raw_sha256',
  'parser_version', 'first_seen_at', 'last_seen_at', 'changed_at',
] as const;

/** `first_seen_at` survives an update; every other column is replaced. */
const UPSERT_TAIL = `ON CONFLICT (id) DO UPDATE SET ${COLUMNS.filter((column) => column !== 'id' && column !== 'first_seen_at')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ')}`;

export interface ProductRecallWrite {
  readonly prepared: PreparedProductRecall;
  readonly rawRef: string;
}

const bool = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

export function productRow(write: ProductRecallWrite, now: string): Array<string | number | null> {
  const { recall, rawSha256 } = write.prepared;
  return [
    recall.id, recall.agency, recall.source_id, recall.title, recall.url, urlKey(recall.url), recall.published_on, recall.updated_on,
    recall.published_on ?? recall.updated_on ?? '0000-00-00', bool(recall.archived), recall.product_category, recall.title_firm,
    recall.units.us, recall.units.canada, isIndexableNotice(recall) ? 1 : 0, JSON.stringify(recall), write.rawRef, rawSha256,
    recall.provenance.parser_version, now, now, now,
  ];
}

function citations(recall: StructuredProductRecall): Array<[string, string, string]> {
  return recall.cross_references.filter((reference) => reference.agency === 'HC' || reference.agency === 'CPSC').map((reference) => [recall.id, reference.agency, urlKey(reference.url)]);
}

function ftsRow(recall: StructuredProductRecall): [string, string, string, string, string] {
  return [
    recall.id,
    recall.title,
    [recall.title_firm, ...recall.firms.map((firm) => firm.name)].filter(Boolean).join(' | '),
    recall.products.map((product) => product.name).join(' | '),
    recall.description ?? '',
  ];
}

/** Largest JSON parameter per bound statement, under D1's 2 MB value limit. */
export const MAX_JSON_BYTES = 1_500_000;
/** Largest JSON literal per statement in an offline SQL file, under D1's 100 KB statement limit. */
export const MAX_LITERAL_JSON_BYTES = 60_000;
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function jsonChunks(items: readonly unknown[], maxBytes: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const encoded = JSON.stringify(item);
    const bytes = byteLength(encoded) + 1;
    if (bytes + 2 > maxBytes) throw new Error('single item exceeds the D1 value limit');
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      size = 2;
    }
    current.push(encoded);
    size += bytes;
  }
  if (current.length > 0) chunks.push(`[${current.join(',')}]`);
  return chunks;
}

const FROM_JSON = (count: number): string => Array.from({ length: count }, (_, index) => `json_extract(value, '$[${index}]')`).join(', ');

/**
 * Set-based writes. Each group is one D1 batch (a transaction); a notice's
 * row, keys, citations and search entry always share a group. The offline
 * bulk loader passes MAX_LITERAL_JSON_BYTES so every rendered statement fits
 * D1's statement-length limit.
 */
export function writeProductGroups(writes: readonly ProductRecallWrite[], now: string, maxBytes = MAX_JSON_BYTES): Statement[][] {
  const groups: Statement[][] = [];
  for (const rowsJson of jsonChunks(writes.map((write) => productRow(write, now)), maxBytes)) {
    const ids = (JSON.parse(rowsJson) as Array<[string]>).map((row) => row[0]);
    const idsJson = JSON.stringify(ids);
    const idSet = new Set(ids);
    const members = writes.filter((write) => idSet.has(write.prepared.recall.id)).map((write) => write.prepared.recall);
    const group: Statement[] = [
      { sql: 'DELETE FROM product_recall_key WHERE recall_id IN (SELECT value FROM json_each(?))', params: [idsJson] },
      { sql: 'DELETE FROM product_recall_citation WHERE recall_id IN (SELECT value FROM json_each(?))', params: [idsJson] },
      { sql: 'DELETE FROM product_recall_fts WHERE rowid IN (SELECT rowid FROM product_recall WHERE id IN (SELECT value FROM json_each(?)))', params: [idsJson] },
      { sql: `INSERT INTO product_recall (${COLUMNS.join(', ')}) SELECT ${FROM_JSON(COLUMNS.length)} FROM json_each(?) WHERE true ${UPSERT_TAIL}`, params: [rowsJson] },
    ];
    for (const chunk of jsonChunks(members.map(ftsRow), maxBytes)) {
      group.push({
        sql: `INSERT INTO product_recall_fts (rowid, recall_id, title, firms, products, description)
          SELECT r.rowid, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]')
          FROM json_each(?) j JOIN product_recall r ON r.id = json_extract(j.value, '$[0]')`,
        params: [chunk],
      });
    }
    for (const chunk of jsonChunks(members.flatMap((recall) => productKeys(recall).map(([kind, value]) => [kind, value, recall.id])), maxBytes)) {
      group.push({ sql: `INSERT OR IGNORE INTO product_recall_key (kind, value, recall_id) SELECT ${FROM_JSON(3)} FROM json_each(?)`, params: [chunk] });
    }
    for (const chunk of jsonChunks(members.flatMap(citations), maxBytes)) {
      group.push({ sql: `INSERT OR IGNORE INTO product_recall_citation (recall_id, agency, url_key) SELECT ${FROM_JSON(3)} FROM json_each(?)`, params: [chunk] });
    }
    groups.push(group);
  }
  return groups;
}

export function touchProductRecallsStatement(ids: readonly string[], now: string): Statement {
  return { sql: 'UPDATE product_recall SET last_seen_at = ? WHERE id IN (SELECT value FROM json_each(?))', params: [now, JSON.stringify(ids)] };
}
