/**
 * Render an initial D1 load for the recall dataset from openFDA enforcement
 * JSON arrays (as downloaded from api.fda.gov), using the same statement
 * builders as the Worker's scheduled sync, so the two paths cannot drift.
 *
 *   tsx tooling/scripts/recalls-bulk-load.ts --input <dir with all_{food,drug,device}.json> --out <dir> [--now <iso>]
 *
 * For each part it writes `<category>-NN.ndjson` (the verbatim records, the
 * evidence) and `<category>-NN.sql` (whose raw_ref values point at byte ranges
 * in that NDJSON under the R2 prefix below). Upload every .ndjson to R2 first,
 * then execute the .sql files:
 *
 *   wrangler r2 object put data-foundry-raw-artifacts/<prefix><file>.ndjson --file <out>/<file>.ndjson --remote
 *   wrangler d1 execute data-foundry-recalls --remote --file <out>/<file>.sql
 *
 * After loading, the Worker's Cron keeps the data current. Evidence objects
 * are never overwritten: a re-run that changes any bundle passes a new
 * --evidence-prefix and uploads under it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { isUsableRecallNumber, RECALL_CATEGORIES, type OpenFdaEnforcementRecord } from '@data-foundry/recall-structuring';

import { ndjsonBundle, prepareRecall, rawRef, renderLiteral, writeRecallStatements, type PreparedRecall } from '../../apps/recalls-worker/src/store.js';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    'max-records': { type: 'string', default: '8000' },
    'max-bytes': { type: 'string', default: String(80 * 1024 * 1024) },
    now: { type: 'string' },
    // Evidence is append-only: a re-run whose bundles differ must use a new prefix.
    'evidence-prefix': { type: 'string' },
  },
});
if (!values.input || !values.out) throw new Error('--input and --out are required');
const maxRecords = Number(values['max-records']);
const maxBytes = Number(values['max-bytes']);
const now = values.now ?? new Date().toISOString();
const prefix = values['evidence-prefix'] ?? `recalls/openfda/bulk/${now.slice(0, 10)}/`;
if (!/^recalls\/openfda\/bulk\/[A-Za-z0-9._-]+\/$/.test(prefix)) throw new Error('--evidence-prefix must look like recalls/openfda/bulk/<name>/');
mkdirSync(values.out, { recursive: true });

interface Item {
  readonly raw: string;
  /** Null when the record has no usable recall number yet: kept as evidence, not loaded. */
  readonly prepared: PreparedRecall | null;
}

function writePart(category: string, part: number, items: readonly Item[]): void {
  const name = `${category}-${String(part).padStart(2, '0')}`;
  // The bundle carries every fetched record, so it is complete evidence of the snapshot.
  const bundle = ndjsonBundle(items.map((item) => item.raw));
  writeFileSync(join(values.out as string, `${name}.ndjson`), bundle.body);
  const lines: string[] = [];
  for (const [index, item] of items.entries()) {
    if (!item.prepared) continue;
    const range = bundle.ranges[index] as { offset: number; length: number };
    // The Worker's exact write, deletes included: never assume an empty database.
    for (const statement of writeRecallStatements(item.prepared, rawRef(`${prefix}${name}.ndjson`, range.offset, range.length), now)) {
      lines.push(renderLiteral(statement));
    }
  }
  writeFileSync(join(values.out as string, `${name}.sql`), `${lines.join('\n')}\n`);
  console.log(name, items.length, 'records', bundle.body.length, 'bytes', lines.length, 'statements');
}

let total = 0;
for (const category of RECALL_CATEGORIES) {
  const records = JSON.parse(readFileSync(join(values.input, `all_${category}.json`), 'utf8')) as OpenFdaEnforcementRecord[];
  const seen = new Set<string>();
  let part = 0;
  let items: Item[] = [];
  let bytes = 0;
  let skipped = 0;
  for (const record of records) {
    // Every fetched record is evidence. Only the first record per usable
    // recall number is published; placeholders, empty numbers and later
    // duplicates are archived only (as the scheduled sync does).
    const raw = JSON.stringify(record);
    const usable = isUsableRecallNumber(record.recall_number) && !seen.has(record.recall_number);
    if (usable) seen.add(record.recall_number as string);
    else skipped += 1;
    if (items.length > 0 && (items.length >= maxRecords || bytes + raw.length > maxBytes)) {
      part += 1;
      writePart(category, part, items);
      items = [];
      bytes = 0;
    }
    items.push({ raw, prepared: usable ? await prepareRecall(category, record) : null });
    bytes += raw.length + 1;
  }
  if (items.length > 0) writePart(category, part + 1, items);
  total += seen.size;
  console.log(category, seen.size, 'distinct recalls,', skipped, 'archived as evidence only (placeholder, empty or duplicate recall number)');
}
console.log('total', total, 'prefix', prefix);
