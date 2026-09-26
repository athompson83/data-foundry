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
 * After loading, the Worker's Cron keeps the data current.
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
  },
});
if (!values.input || !values.out) throw new Error('--input and --out are required');
const maxRecords = Number(values['max-records']);
const maxBytes = Number(values['max-bytes']);
const now = values.now ?? new Date().toISOString();
const prefix = `recalls/openfda/bulk/${now.slice(0, 10)}/`;
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
    // Empty recall numbers were never part of the evidence snapshot.
    if (!record.recall_number) continue;
    const usable = isUsableRecallNumber(record.recall_number);
    if (usable && seen.has(record.recall_number)) continue;
    const raw = JSON.stringify(record);
    if (usable) seen.add(record.recall_number);
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
  console.log(category, seen.size, 'distinct recalls,', skipped, 'without a usable recall number (evidence only)');
}
console.log('total', total, 'prefix', prefix);
