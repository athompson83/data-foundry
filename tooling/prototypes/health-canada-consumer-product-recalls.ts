/**
 * PROTOTYPED runner for health-canada-consumer-product-recalls: structures
 * every "Consumer product safety" record in a full Health Canada open-data
 * index snapshot and writes field coverage.
 *
 *   pnpm exec tsx tooling/prototypes/health-canada-consumer-product-recalls.ts <HCRSAMOpenData.json> [coverage-fields.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { isConsumerProductRecord, structureHcRecall, type HcRecallRecord, type StructuredProductRecall } from '@data-foundry/product-recall-structuring';

const [input, output] = process.argv.slice(2);
if (!input) throw new Error('usage: health-canada-consumer-product-recalls.ts <HCRSAMOpenData.json> [coverage-fields.json]');
const records = JSON.parse(readFileSync(input, 'utf8')) as HcRecallRecord[];
const inScope = records.filter(isConsumerProductRecord);

let errors = 0;
const structured: StructuredProductRecall[] = [];
for (const record of inScope) {
  try {
    structured.push(structureHcRecall(record));
  } catch (error) {
    errors += 1;
    console.error(record.NID, (error as Error).message);
  }
}
const of = structured.length;
const count = (test: (recall: StructuredProductRecall) => boolean) => ({ hits: structured.filter(test).length, of });
const fields = {
  updated_on: count((r) => r.updated_on !== null),
  product: count((r) => r.products.length > 0),
  product_category: count((r) => r.product_category !== null),
  'hazard.text': count((r) => r.hazard.text !== null),
  'hazard.classes': count((r) => r.hazard.classes.length > 0),
  'remedy.classes': count((r) => r.remedy.classes.length > 0),
  'identifiers.model_numbers': count((r) => r.identifiers.model_numbers.length > 0),
  trade_facets: count((r) => r.trade_facets.length > 0),
  'joint_with.cpsc': count((r) => r.joint_with.includes('CPSC')),
};
const summary = { records: records.length, in_scope: inScope.length, structured: of, errors, fields };
console.log(JSON.stringify(summary, null, 1));
if (output) writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
