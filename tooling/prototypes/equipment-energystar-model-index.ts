/**
 * PROTOTYPED runner for equipment-energystar-model-index: structures every row of a full ENERGY STAR Model Index
 * snapshot, adds the UPC Codes dataset's barcodes by pd_id, and writes field coverage. The snapshot is the tarball
 * archived by the "Archive source snapshot" workflow (tooling/snapshots/plans.json).
 *
 *   pnpm exec tsx tooling/prototypes/equipment-energystar-model-index.ts <model-index.csv> <upc-codes.csv> [coverage-fields.json]
 */
import { createReadStream, writeFileSync } from 'node:fs';

import { structureEnergyStarModel, type EnergyStarModelRow, type StructuredEquipmentModel } from '@data-foundry/equipment-model-structuring';

/** RFC 4180 rows from a stream: quoted fields may contain commas, doubled quotes and line breaks. */
async function* csvRows(path: string): AsyncGenerator<string[]> {
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let afterQuote = false;
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    for (let i = 0; i < chunk.length; i += 1) {
      const c = chunk[i]!;
      if (quoted) {
        if (c === '"') {
          quoted = false;
          afterQuote = true;
        } else field += c;
      } else if (c === '"') {
        if (afterQuote) field += '"';
        quoted = true;
        afterQuote = false;
      } else if (c === ',') {
        row.push(field);
        field = '';
        afterQuote = false;
      } else if (c === '\n') {
        row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
        yield row;
        row = [];
        field = '';
        afterQuote = false;
      } else {
        field += c;
        afterQuote = false;
      }
    }
  }
  if (quoted) throw new Error(`${path}: unterminated quoted field`);
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

async function* records(path: string): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const row of csvRows(path)) {
    if (header === null) {
      header = row;
      continue;
    }
    if (row.length !== header.length) throw new Error(`${path}: row with ${row.length} fields, header has ${header.length}`);
    yield Object.fromEntries(header.map((name, i) => [name, row[i]!]));
  }
}

const [modelIndex, upcCodes, output] = process.argv.slice(2);
if (!modelIndex || !upcCodes) throw new Error('usage: equipment-energystar-model-index.ts <model-index.csv> <upc-codes.csv> [coverage-fields.json]');

const extraUpcs = new Map<string, string[]>();
let upcRows = 0;
for await (const record of records(upcCodes)) {
  upcRows += 1;
  if (!record['upc']) continue;
  const list = extraUpcs.get(record['pd_id']!) ?? [];
  list.push(record['upc']);
  extraUpcs.set(record['pd_id']!, list);
}

let rows = 0;
let errors = 0;
const seen = new Set<string>();
let duplicates = 0;
const hits: Record<string, number> = {};
const hit = (name: string, test: boolean) => {
  hits[name] = (hits[name] ?? 0) + (test ? 1 : 0);
};
const trades: Record<string, number> = {};
let upcDatasetMatched = 0;
for await (const record of records(modelIndex)) {
  rows += 1;
  const row = record as unknown as EnergyStarModelRow;
  const extra = extraUpcs.get(row.pd_id);
  if (extra) upcDatasetMatched += 1;
  const merged: EnergyStarModelRow = extra ? { ...row, upc: [row.upc, ...extra].filter(Boolean).join(', ') } : row;
  let model: StructuredEquipmentModel;
  try {
    model = structureEnergyStarModel(merged);
  } catch (error) {
    errors += 1;
    if (errors <= 20) console.error(row.pd_id, (error as Error).message);
    continue;
  }
  if (seen.has(model.source_id)) duplicates += 1;
  seen.add(model.source_id);
  trades[model.trade] = (trades[model.trade] ?? 0) + 1;
  hit('source_id', true);
  hit('brand_key', model.brand_key !== '');
  hit('model_key', model.model_key !== '');
  hit('model_is_pattern', model.model_is_pattern);
  hit('model_name', model.model_name !== null);
  hit('product_type', model.product_type !== null);
  hit('gtins', model.gtins.length > 0);
  hit('rejected_upcs', model.rejected_upcs.length > 0);
  hit('markets', model.markets.length > 0);
  hit('markets.CA', model.markets.includes('CA'));
  hit('unknown_markets', model.unknown_markets.length > 0);
  hit('date_certified', model.date_certified !== null);
  hit('date_available', model.date_available !== null);
  hit('most_efficient', model.most_efficient === true);
}
const structured = rows - errors;
const fields = Object.fromEntries(Object.entries(hits).map(([name, n]) => [name, { hits: n, of: structured }]));
const summary = { rows, structured, errors, duplicate_source_ids: duplicates, upc_dataset_rows: upcRows, upc_dataset_models_matched: upcDatasetMatched, trades, fields };
console.log(JSON.stringify(summary, null, 1));
if (output) writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
