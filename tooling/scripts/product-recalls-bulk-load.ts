/**
 * Render the initial D1 load for the consumer-product recall dataset from full
 * source snapshots, with the same statement builders as the Worker's
 * scheduled sync, so the two paths cannot drift.
 *
 *   tsx tooling/scripts/product-recalls-bulk-load.ts --cpsc <cpsc.json> --hc <HCRSAMOpenData.json> --out <dir> \
 *     --evidence-prefix product-recalls/bulk/<new, unused name>/ [--now <iso>]
 *
 * Writes `<agency>-NN.ndjson` (the verbatim in-scope records: the evidence)
 * and `<agency>-NN.sql` (whose raw_ref values point at byte ranges in that
 * NDJSON under the prefix). Upload every .ndjson to R2 first, then execute
 * the .sql files:
 *
 *   wrangler r2 object put data-foundry-raw-artifacts/<prefix><file>.ndjson --file <out>/<file>.ndjson --remote
 *   wrangler d1 execute data-foundry-recalls --remote --file <out>/<file>.sql
 *
 * Evidence objects are never overwritten: a re-run that changes any bundle
 * passes a new --evidence-prefix.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { isPublishable, MAX_LITERAL_JSON_BYTES, prepareProductRecall, writeProductGroups, type PreparedProductRecall, type ProductAgency } from '../../apps/recalls-worker/src/product-store.js';
import { ndjsonBundle, rawRef, renderLiteral } from '../../apps/recalls-worker/src/store.js';

const { values } = parseArgs({
  options: {
    cpsc: { type: 'string' },
    hc: { type: 'string' },
    out: { type: 'string' },
    'part-size': { type: 'string', default: '2000' },
    now: { type: 'string' },
    'evidence-prefix': { type: 'string' },
  },
});
if (!values.cpsc || !values.hc || !values.out) throw new Error('--cpsc, --hc and --out are required');
const prefix = values['evidence-prefix'];
if (!prefix || !/^product-recalls\/bulk\/[A-Za-z0-9._-]+\/$/.test(prefix)) throw new Error('--evidence-prefix is required and must look like product-recalls/bulk/<name>/');
const now = values.now ?? new Date().toISOString();
const partSize = Number(values['part-size']);
mkdirSync(values.out, { recursive: true });

const summary: Record<string, { records: number; loaded: number; skipped: number; parts: number }> = {};

for (const [agency, path] of [
  ['CPSC', values.cpsc],
  ['HC', values.hc],
] as Array<[ProductAgency, string]>) {
  const records = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
  const byId = new Map<string, PreparedProductRecall>();
  let skipped = 0;
  for (const record of records) {
    if (!isPublishable(agency, record)) {
      skipped += 1;
      continue;
    }
    const prepared = await prepareProductRecall(agency, record);
    if (byId.has(prepared.recall.id)) skipped += 1;
    else byId.set(prepared.recall.id, prepared);
  }
  const items = [...byId.values()];
  let parts = 0;
  for (let start = 0; start < items.length; start += partSize) {
    parts += 1;
    const name = `${agency.toLowerCase()}-${String(parts).padStart(2, '0')}`;
    const chunk = items.slice(start, start + partSize);
    const bundle = ndjsonBundle(chunk.map((item) => item.raw));
    writeFileSync(join(values.out, `${name}.ndjson`), bundle.body);
    const writes = chunk.map((item, index) => {
      const range = bundle.ranges[index] as { offset: number; length: number };
      return { prepared: item, rawRef: rawRef(`${prefix}${name}.ndjson`, range.offset, range.length) };
    });
    const sql = writeProductGroups(writes, now, MAX_LITERAL_JSON_BYTES).flat().map(renderLiteral).join('\n');
    writeFileSync(join(values.out, `${name}.sql`), `${sql}\n`);
  }
  summary[agency] = { records: records.length, loaded: items.length, skipped, parts };
}
console.log(JSON.stringify({ now, prefix, summary }, null, 2));
