/**
 * Statement builders for the recall tables. Both the Worker's scheduled sync
 * and the offline bulk loader use these, so a record written either way is
 * byte-for-byte the same shape.
 */

import type { OpenFdaEnforcementRecord, RecallCategory, StructuredRecall } from '@data-foundry/recall-structuring';
import { structureRecall } from '@data-foundry/recall-structuring';

export interface Statement {
  readonly sql: string;
  readonly params: ReadonlyArray<string | number | null>;
}

export type KeyKind =
  | 'gtin' | 'ndc' | 'lot' | 'serial' | 'model' | 'state' | 'country'
  | 'reason_class' | 'allergen' | 'pathogen' | 'expiration';

export const KEY_KINDS: readonly KeyKind[] = [
  'gtin', 'ndc', 'lot', 'serial', 'model', 'state', 'country', 'reason_class', 'allergen', 'pathogen', 'expiration',
];

export interface PreparedRecall {
  readonly recall: StructuredRecall;
  readonly raw: string;
  readonly rawSha256: string;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareRecall(category: RecallCategory, record: OpenFdaEnforcementRecord): Promise<PreparedRecall> {
  const raw = JSON.stringify(record);
  return { recall: structureRecall(category, record), raw, rawSha256: await sha256Hex(raw) };
}

export function recallKeys(recall: StructuredRecall): Array<readonly [KeyKind, string]> {
  const keys: Array<readonly [KeyKind, string]> = [];
  const add = (kind: KeyKind, values: readonly string[]): void => {
    for (const value of values) keys.push([kind, value]);
  };
  add('gtin', recall.codes.gtins);
  add('ndc', recall.codes.ndcs);
  add('lot', recall.codes.lots);
  add('serial', recall.codes.serial_numbers);
  add('model', recall.codes.model_numbers);
  add('expiration', recall.codes.expiration_dates);
  add('state', recall.distribution.us_states);
  add('country', recall.distribution.countries);
  add('reason_class', recall.reason.classes);
  add('allergen', recall.reason.allergens);
  add('pathogen', recall.reason.pathogens);
  return keys;
}

/**
 * Longest code list kept in the stored JSON. A handful of device recalls list
 * tens of thousands of serials; the key index keeps every value for lookup,
 * and the full list is always recoverable from the raw record.
 */
export const MAX_CODES_PER_LIST = 500;

/** The derived structure stored as JSON beside the columns. */
export function structuredJson(recall: StructuredRecall): string {
  const truncated: string[] = [];
  const codes = Object.fromEntries(
    Object.entries(recall.codes).map(([name, values]) => {
      if (values.length <= MAX_CODES_PER_LIST) return [name, values];
      truncated.push(name);
      return [name, values.slice(0, MAX_CODES_PER_LIST)];
    }),
  );
  return JSON.stringify({
    distribution: recall.distribution,
    quantity: recall.quantity,
    codes: truncated.length ? { ...codes, truncated_lists: truncated } : codes,
    reason: recall.reason,
    provenance: recall.provenance,
  });
}

/** Where a raw record lives: "<r2 key>#<offset>:<length>". */
export function rawRef(key: string, offset: number, length: number): string {
  return `${key}#${offset}:${length}`;
}

export function parseRawRef(ref: string): { key: string; offset: number; length: number } | null {
  const match = /^(.+)#(\d+):(\d+)$/.exec(ref);
  return match ? { key: match[1] as string, offset: Number(match[2]), length: Number(match[3]) } : null;
}

/**
 * Serialise records as NDJSON and return each record's byte range, so a
 * single record can later be read back with an R2 range request.
 */
export function ndjsonBundle(raws: readonly string[]): { body: string; ranges: Array<{ offset: number; length: number }> } {
  const encoder = new TextEncoder();
  const ranges: Array<{ offset: number; length: number }> = [];
  let offset = 0;
  for (const raw of raws) {
    const length = encoder.encode(raw).byteLength;
    ranges.push({ offset, length });
    offset += length + 1;
  }
  return { body: raws.length ? `${raws.join('\n')}\n` : '', ranges };
}

const bool = (value: boolean | null): number | null => (value === null ? null : value ? 1 : 0);

const RECALL_COLUMNS = [
  'recall_number', 'category', 'event_id', 'classification', 'status', 'voluntary',
  'firm_name', 'firm_city', 'firm_state', 'firm_postal_code', 'firm_country',
  'initiated_on', 'classified_on', 'reported_on', 'terminated_on',
  'product_description', 'reason_for_recall', 'nationwide_us', 'international',
  'quantity_total', 'quantity_unit', 'structured', 'raw_ref', 'raw_sha256', 'parser_version',
  'source_url', 'first_seen_at', 'last_seen_at', 'changed_at',
] as const;

/** `first_seen_at` survives an update; every other column is replaced. */
const UPSERT_TAIL = `ON CONFLICT (recall_number) DO UPDATE SET ${RECALL_COLUMNS.filter((column) => column !== 'recall_number' && column !== 'first_seen_at')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ')}`;

export interface RecallWrite {
  readonly prepared: PreparedRecall;
  readonly rawRef: string;
}

/** Column values in RECALL_COLUMNS order. */
export function recallRow(write: RecallWrite, now: string): Array<string | number | null> {
  const { recall, rawSha256 } = write.prepared;
  return [
    recall.recall_number, recall.category, recall.event_id, recall.classification, recall.status, bool(recall.voluntary),
    recall.firm.name, recall.firm.city, recall.firm.state, recall.firm.postal_code, recall.firm.country,
    recall.dates.initiated, recall.dates.classified, recall.dates.reported, recall.dates.terminated,
    recall.product_description, recall.reason_for_recall, bool(recall.distribution.nationwide_us), bool(recall.distribution.international),
    recall.quantity.total, recall.quantity.unit, structuredJson(recall), write.rawRef, rawSha256, recall.provenance.parser_version,
    recall.provenance.source_url, now, now, now,
  ];
}

/**
 * The search entry is derived from the stored row and keyed by its rowid, so
 * deleting it is an indexed rowid lookup rather than a scan of the FTS table
 * (recall_number is an UNINDEXED FTS column). An upsert keeps the rowid.
 */
const FTS_FROM_ROWS = `INSERT INTO recall_fts (rowid, recall_number, firm_name, product_description, reason_for_recall)
  SELECT r.rowid, r.recall_number, COALESCE(r.firm_name, ''), COALESCE(r.product_description, ''), COALESCE(r.reason_for_recall, '')
  FROM recall r WHERE r.recall_number`;

/**
 * Per-recall literal statements for the offline bulk import: every statement
 * stays far below D1's 100 KB statement limit however large the record.
 */
export function writeRecallStatements(prepared: PreparedRecall, rawReference: string, now: string): Statement[] {
  const { recall } = prepared;
  const statements: Statement[] = [
    { sql: 'DELETE FROM recall_key WHERE recall_number = ?', params: [recall.recall_number] },
    { sql: 'DELETE FROM recall_fts WHERE rowid = (SELECT rowid FROM recall WHERE recall_number = ?)', params: [recall.recall_number] },
    {
      sql: `INSERT INTO recall (${RECALL_COLUMNS.join(', ')}) VALUES (${RECALL_COLUMNS.map(() => '?').join(', ')}) ${UPSERT_TAIL}`,
      params: recallRow({ prepared, rawRef: rawReference }, now),
    },
    { sql: `${FTS_FROM_ROWS} = ?`, params: [recall.recall_number] },
  ];
  for (const [kind, value] of recallKeys(recall)) {
    statements.push({ sql: 'INSERT OR IGNORE INTO recall_key (kind, value, recall_number) VALUES (?, ?, ?)', params: [kind, value, recall.recall_number] });
  }
  return statements;
}

/** Largest JSON parameter per statement, under D1's 2 MB value limit. */
const MAX_JSON_BYTES = 1_500_000;
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Split items into JSON arrays no larger than MAX_JSON_BYTES each. */
function jsonChunks(items: readonly unknown[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const item of items) {
    const encoded = JSON.stringify(item);
    const bytes = byteLength(encoded) + 1;
    if (bytes + 2 > MAX_JSON_BYTES) throw new Error('single item exceeds the D1 value limit');
    if (current.length > 0 && size + bytes > MAX_JSON_BYTES) {
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

/**
 * Set-based writes for the Worker. Returns groups; each group is meant to run
 * as one D1 batch (a transaction), and a recall's row, search entry and keys
 * always share a group, so a failure can never leave a row whose raw_sha256 is
 * current while its keys or search entry are missing. A handful of statements
 * per group keeps a sync far inside D1's 1,000 queries per invocation.
 */
export function writeRecallGroups(writes: readonly RecallWrite[], now: string): Statement[][] {
  const groups: Statement[][] = [];
  for (const rowsJson of jsonChunks(writes.map((write) => recallRow(write, now)))) {
    const ids = (JSON.parse(rowsJson) as Array<[string]>).map((row) => row[0]);
    const idsJson = JSON.stringify(ids);
    const members = new Set(ids);
    const keys = writes
      .filter((write) => members.has(write.prepared.recall.recall_number))
      .flatMap((write) => recallKeys(write.prepared.recall).map(([kind, value]) => [kind, value, write.prepared.recall.recall_number]));
    const group: Statement[] = [
      { sql: 'DELETE FROM recall_key WHERE recall_number IN (SELECT value FROM json_each(?))', params: [idsJson] },
      { sql: 'DELETE FROM recall_fts WHERE rowid IN (SELECT rowid FROM recall WHERE recall_number IN (SELECT value FROM json_each(?)))', params: [idsJson] },
      {
        sql: `INSERT INTO recall (${RECALL_COLUMNS.join(', ')})
          SELECT ${RECALL_COLUMNS.map((_, index) => `json_extract(value, '$[${index}]')`).join(', ')}
          FROM json_each(?) WHERE true ${UPSERT_TAIL}`,
        params: [rowsJson],
      },
      { sql: `${FTS_FROM_ROWS} IN (SELECT value FROM json_each(?))`, params: [idsJson] },
    ];
    for (const keysJson of jsonChunks(keys)) {
      group.push({
        sql: "INSERT OR IGNORE INTO recall_key (kind, value, recall_number) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)",
        params: [keysJson],
      });
    }
    groups.push(group);
  }
  return groups;
}

export function touchRecallsStatement(recallNumbers: readonly string[], now: string): Statement {
  return { sql: 'UPDATE recall SET last_seen_at = ? WHERE recall_number IN (SELECT value FROM json_each(?))', params: [now, JSON.stringify(recallNumbers)] };
}

/** Render a statement as literal SQL for offline bulk import files. */
export function renderLiteral(statement: Statement): string {
  let index = 0;
  const sql = statement.sql.replace(/\s+/g, ' ').replace(/\?/g, () => {
    const value = statement.params[index];
    index += 1;
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('non-finite number in statement');
      return String(value);
    }
    return `'${value.replace(/'/g, "''")}'`;
  });
  if (index !== statement.params.length) throw new Error('placeholder/parameter count mismatch');
  return `${sql};`;
}
