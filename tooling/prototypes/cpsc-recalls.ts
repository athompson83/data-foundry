/**
 * PROTOTYPED runner for cpsc-recalls: structures every recall in a full
 * saferproducts.gov Recall API snapshot and writes field coverage.
 *
 *   pnpm exec tsx tooling/prototypes/cpsc-recalls.ts <recalls.json> [coverage.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { isUsableCpscRecord, structureCpscRecall, type CpscRecallRecord, type StructuredProductRecall } from '@data-foundry/product-recall-structuring';

const [input, output] = process.argv.slice(2);
if (!input) throw new Error('usage: cpsc-recalls.ts <recalls.json> [coverage.json]');
const records = JSON.parse(readFileSync(input, 'utf8')) as CpscRecallRecord[];

let errors = 0;
const structured: StructuredProductRecall[] = [];
for (const record of records) {
  try {
    if (!isUsableCpscRecord(record)) throw new Error('unusable record');
    structured.push(structureCpscRecall(record));
  } catch (error) {
    errors += 1;
    console.error(record.RecallNumber, (error as Error).message);
  }
}
const of = structured.length;
const count = (test: (recall: StructuredProductRecall) => boolean) => ({ hits: structured.filter(test).length, of });
const fields = {
  title_firm: count((r) => r.title_firm !== null),
  published_on: count((r) => r.published_on !== null),
  product_type: count((r) => r.product_category !== null),
  'units.us': count((r) => r.units.us !== null),
  'units.canada': count((r) => r.units.canada !== null),
  'identifiers.model_numbers': count((r) => r.identifiers.model_numbers.length > 0),
  'identifiers.gtins': count((r) => r.identifiers.gtins.length > 0),
  'hazard.classes': count((r) => r.hazard.classes.length > 0),
  'remedy.classes': count((r) => r.remedy.classes.length > 0),
  trade_facets: count((r) => r.trade_facets.length > 0),
  'cross_references.hc': count((r) => r.cross_references.some((x) => x.agency === 'HC')),
};
const summary = { records: records.length, structured: of, errors, fields };
console.log(JSON.stringify(summary, null, 1));
if (output) writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
