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

/**
 * Statements that (re)write one changed or new recall: the row, its keys and
 * its full-text entry. `first_seen_at` survives an update.
 */
export function writeRecallStatements(prepared: PreparedRecall, rawReference: string, now: string): Statement[] {
  const { recall } = prepared;
  const statements: Statement[] = [
    { sql: 'DELETE FROM recall_key WHERE recall_number = ?', params: [recall.recall_number] },
    { sql: 'DELETE FROM recall_fts WHERE recall_number = ?', params: [recall.recall_number] },
    {
      sql: `INSERT INTO recall (
          recall_number, category, event_id, classification, status, voluntary,
          firm_name, firm_city, firm_state, firm_postal_code, firm_country,
          initiated_on, classified_on, reported_on, terminated_on,
          product_description, reason_for_recall, nationwide_us, international,
          quantity_total, quantity_unit, structured, raw_ref, raw_sha256, parser_version,
          source_url, first_seen_at, last_seen_at, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (recall_number) DO UPDATE SET
          category = excluded.category, event_id = excluded.event_id,
          classification = excluded.classification, status = excluded.status,
          voluntary = excluded.voluntary, firm_name = excluded.firm_name,
          firm_city = excluded.firm_city, firm_state = excluded.firm_state,
          firm_postal_code = excluded.firm_postal_code, firm_country = excluded.firm_country,
          initiated_on = excluded.initiated_on, classified_on = excluded.classified_on,
          reported_on = excluded.reported_on, terminated_on = excluded.terminated_on,
          product_description = excluded.product_description,
          reason_for_recall = excluded.reason_for_recall,
          nationwide_us = excluded.nationwide_us, international = excluded.international,
          quantity_total = excluded.quantity_total, quantity_unit = excluded.quantity_unit,
          structured = excluded.structured, raw_ref = excluded.raw_ref,
          raw_sha256 = excluded.raw_sha256, parser_version = excluded.parser_version,
          source_url = excluded.source_url, last_seen_at = excluded.last_seen_at,
          changed_at = excluded.changed_at`,
      params: [
        recall.recall_number, recall.category, recall.event_id, recall.classification, recall.status, bool(recall.voluntary),
        recall.firm.name, recall.firm.city, recall.firm.state, recall.firm.postal_code, recall.firm.country,
        recall.dates.initiated, recall.dates.classified, recall.dates.reported, recall.dates.terminated,
        recall.product_description, recall.reason_for_recall, bool(recall.distribution.nationwide_us), bool(recall.distribution.international),
        recall.quantity.total, recall.quantity.unit, structuredJson(recall), rawReference, prepared.rawSha256, recall.provenance.parser_version,
        recall.provenance.source_url, now, now, now,
      ],
    },
    {
      sql: 'INSERT INTO recall_fts (recall_number, firm_name, product_description, reason_for_recall) VALUES (?, ?, ?, ?)',
      params: [recall.recall_number, recall.firm.name ?? '', recall.product_description ?? '', recall.reason_for_recall ?? ''],
    },
  ];
  for (const [kind, value] of recallKeys(recall)) {
    statements.push({
      sql: 'INSERT OR IGNORE INTO recall_key (kind, value, recall_number) VALUES (?, ?, ?)',
      params: [kind, value, recall.recall_number],
    });
  }
  return statements;
}

export function touchRecallStatement(recallNumber: string, now: string): Statement {
  return { sql: 'UPDATE recall SET last_seen_at = ? WHERE recall_number = ?', params: [now, recallNumber] };
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
