// Applies the repo's own deterministic GTIN extraction to raw agency payloads.
// Usage (from repo root): npx tsx <this file> <in.json> <out.json>
// CPSC: structureCpscRecall (ProductUPCs[].UPC via digitCodes+gtinReadings, plus parseCodes on Description).
// Health Canada: structureHcRecall (identifiers.gtins is always [] by design) AND parseCodes over every text field, to measure whether any barcode is present.
// Safety Gate / OPSS: the same rule, digitCodes+gtinReadings and parseCodes, over the barcode / free text.
import { readFileSync, writeFileSync } from 'node:fs';
import { digitCodes, gtinReadings, structureCpscRecall, structureHcRecall } from '/home/user/data-foundry/packages/product-recall-structuring/src/index.ts';
import { parseCodes } from '/home/user/data-foundry/packages/recall-structuring/src/index.ts';

const input = JSON.parse(readFileSync(process.argv[2] as string, 'utf8')) as { cpsc?: any[]; hc?: any[]; texts?: Array<{ id: string; text: string }> };
const out: any = {};
if (input.cpsc) {
  out.cpsc = [];
  let errors = 0;
  for (const r of input.cpsc) {
    try {
      const s = structureCpscRecall(r);
      out.cpsc.push({ id: s.source_id, title: s.title, url: s.url, published_on: s.published_on, gtins: s.identifiers.gtins, models: s.identifiers.model_numbers });
    } catch { errors += 1; }
  }
  out.cpsc_errors = errors;
}
if (input.hc) {
  out.hc = [];
  for (const r of input.hc) {
    if (r.Organization !== 'Consumer product safety') continue;
    const structured = structureHcRecall(r);
    const g = new Set<string>(structured.identifiers.gtins);
    const text = [r.Title, r.Product, r.Issue, r['What you should do']].filter(Boolean).join('\n');
    for (const x of parseCodes(text).gtins) g.add(x);
    out.hc.push({ id: r.NID, title: r.Title, url: r.URL, structured_gtins: structured.identifiers.gtins, text_gtins: [...g].sort(), models: structured.identifiers.model_numbers, joint_with: structured.joint_with });
  }
}
if (input.texts) {
  out.texts = input.texts.map(({ id, text }) => {
    const g = new Set<string>();
    for (const c of digitCodes(text)) for (const x of gtinReadings(c)) g.add(x);
    for (const x of parseCodes(text).gtins) g.add(x);
    return { id, gtins: [...g].sort(), digit_runs: digitCodes(text) };
  });
}
writeFileSync(process.argv[3] as string, JSON.stringify(out));
