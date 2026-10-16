/** Bounded inventory screening over the existing consumer-product query layer. */
import { modelKey } from '@data-foundry/product-recall-structuring';
import { BadRequest, gtinCandidates } from './api.js';
import type { Env } from './env.js';
import { lookupProductCode, productStats, PRODUCT_ATTRIBUTION, type PresentedProductRecall } from './product-api.js';

export const MAX_SCREENING_ITEMS = 50;
export const SCREENING_NOTE = 'This is a dated screening record, not a safety or compliance certificate. No match means no indexed identifier matched within the stated coverage. Confirm product, manufacturer, batch and eligibility against each official notice. Model numbers can be shared by unrelated products. Remedy availability can change; this report does not establish entitlement to a refund, repair or replacement.';
export const COVERAGE_NOTE = 'Consumer products only: CPSC (US) and Health Canada (Canada). CPSC full-history reconciliation is incomplete. Health Canada notice coverage does not imply complete identifier coverage. Food, drugs, medical devices and vehicles are outside this screening. Name-only and unindexed products cannot be cleared. No real-time or comprehensive monitoring is provided.';
export const SCREENING_TIERS = { standard: { cents: 2900, label: 'Batch screening report' }, branded: { cents: 4900, label: 'Branded screening report' } } as const;
export type ScreeningTier = keyof typeof SCREENING_TIERS;
export interface InventoryItem { item: string; gtin: string; model: string }
export type ScreeningOutcome = 'matched_notice' | 'possible_match' | 'no_match_in_coverage' | 'insufficient_information';
export interface ScreeningNotice {
  id: string; agency: string; title: string; url: string; published_on: string | null;
  matched_on: Array<{ kind: string; value: string }>;
  remedy: { classes: readonly string[]; text: string | null };
  provenance: PresentedProductRecall['provenance'];
}
export interface ScreeningItem extends InventoryItem {
  outcome: ScreeningOutcome; explanation: string; notices: ScreeningNotice[]; truncated: boolean;
}
export interface ScreeningResult {
  version: 1; checked_at: string; note: string; coverage_note: string;
  coverage: Record<string, unknown>; attribution: typeof PRODUCT_ATTRIBUTION; items: ScreeningItem[];
}

/** A deliberately small CSV contract: quoted commas/newlines/quotes supported; no guessed columns. */
export function parseInventory(csv: unknown): InventoryItem[] {
  if (typeof csv !== 'string' || new TextEncoder().encode(csv).length > 65536) throw new BadRequest('Upload a UTF-8 CSV of at most 64 KiB.');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  const input = csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i <= input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === undefined) throw new BadRequest('CSV has an unclosed quote.');
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ',' || char === '\n' || char === undefined) {
      row.push(field); field = ''; closed = false;
      if (char !== ',') { if (row.some(value => value.trim())) rows.push(row); row = []; }
    } else if (char === '"' && !field && !closed) quoted = true;
    else { if (closed || char === '"') throw new BadRequest('CSV quotes must surround the whole field.'); field += char; }
  }
  const header = rows.shift()?.map(value => value.trim().toLowerCase()) ?? [];
  if (!header.includes('item') || header.some(value => !['item', 'gtin', 'model'].includes(value)) || new Set(header).size !== header.length) throw new BadRequest('Use columns item,gtin,model (item is required).');
  if (!rows.length || rows.length > MAX_SCREENING_ITEMS) throw new BadRequest(`Include 1–${MAX_SCREENING_ITEMS} inventory rows.`);
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new BadRequest(`Row ${index + 2} has a different number of columns.`);
    const read = (name: string) => (values[header.indexOf(name)] ?? '').trim();
    const item = { item: read('item'), gtin: read('gtin'), model: read('model') };
    if (!item.item || item.item.length > 160 || item.gtin.length > 32 || item.model.length > 80 || Object.values(item).some(value => /[\u0000-\u001f\u007f]/.test(value))) throw new BadRequest(`Row ${index + 2}: use an item label (1–160 characters), GTIN (up to 32) and model (up to 80), without control characters.`);
    return item;
  });
}

export async function screenInventory(env: Env, items: InventoryItem[], now = new Date()): Promise<ScreeningResult> {
  const coverage = await productStats(env.DB);
  const successes = coverage['last_successful_sync'] as Record<string, string>;
  const recent = ['CPSC', 'HC'].every(agency => {
    const date = Date.parse(successes[agency] ?? '');
    return Number.isFinite(date) && date <= now.getTime() && now.getTime() - date <= 48 * 3600_000;
  });
  const results: ScreeningItem[] = [];
  const memo = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const gtins = gtinCandidates(item.gtin);
    const model = modelKey(item.model);
    const valid = (!item.gtin || gtins.length > 0) && (!item.model || model.length >= 2);
    const queries = [ ...(gtins.length ? [{ code: item.gtin, kind: 'gtin' }] : []), ...(model.length >= 2 ? [{ code: item.model, kind: 'model' }] : []) ];
    const notices = new Map<string, ScreeningNotice>(); let truncated = false; let exactGtin = false;
    for (const query of queries) {
      // Existing published deterministic identifiers only; the extraction gate is not expanded.
      let response = memo.get(query.code);
      if (!response) { response = await lookupProductCode(env.DB, env.RAW_ARTIFACTS, query.code, false, false); memo.set(query.code, response); }
      truncated ||= response['truncated'] === true;
      const matches = response['data'] as Array<{ matched_on: Array<{ kind: string; value: string }>; recall: PresentedProductRecall }>;
      for (const match of matches) {
        const on = match.matched_on.filter(value => value.kind === query.kind);
        if (!on.length) continue;
        exactGtin ||= query.kind === 'gtin';
        const recall = match.recall;
        const previous = notices.get(recall.id);
        notices.set(recall.id, { id: recall.id, agency: recall.agency, title: recall.title, url: recall.url,
          published_on: recall.published_on, matched_on: [...(previous?.matched_on ?? []), ...on],
          remedy: recall.remedy, provenance: recall.provenance });
      }
    }
    // Show every returned concern in the free preview. The canonical lookup explicitly caps each query at 100.
    const outcome: ScreeningOutcome = notices.size ? (exactGtin && valid ? 'matched_notice' : 'possible_match') : (!queries.length || !valid || !recent || truncated ? 'insufficient_information' : 'no_match_in_coverage');
    const explanation = notices.size
      ? (!valid ? 'A notice matches a supplied identifier, but another supplied identifier is invalid. Resolve the identifiers and confirm the official notice before acting.' : outcome === 'matched_notice' ? 'An exact barcode appears in a notice. Verify affected batches and product details.' : 'A model identifier appears in a notice. Confirm manufacturer and product identity; model numbers are not globally unique.')
      : !queries.length || !valid ? 'Supply a valid barcode or a model number with at least two letters or digits. Invalid or missing identifiers cannot clear an item.'
      : !recent ? 'No identifier matched, but one or more sources lack a successful sync within 48 hours. Coverage is unavailable for a negative assessment.'
      : truncated ? 'The lookup was truncated; this item needs manual review.' : 'No exact indexed identifier matched in the available consumer-product notices. This does not establish safety.';
    results.push({ ...item, outcome, explanation, notices: [...notices.values()], truncated });
  }
  return { version: 1, checked_at: now.toISOString(), note: SCREENING_NOTE, coverage_note: COVERAGE_NOTE, coverage, attribution: PRODUCT_ATTRIBUTION, items: results };
}

/** Quoting alone does not prevent spreadsheet formula execution. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function reportCsv(result: ScreeningResult): string {
  const rows: unknown[][] = [['item', 'gtin', 'model', 'outcome', 'explanation', 'notice_id', 'official_notice', 'published_remedies', 'evidence_sha256', 'checked_at', 'coverage_limits', 'notice', 'source_sync_at_check', 'source_attribution']];
  const attribution = result.attribution.sources.map(source => `${source.source}. ${source.license}`).join(' | ') + ' | ' + result.attribution.disclaimer;
  for (const item of result.items) for (const notice of item.notices.length ? item.notices : [null]) {
    rows.push([item.item, item.gtin, item.model, item.outcome, item.explanation + (item.truncated ? ' Additional matches may exist; lookup truncated.' : ''), notice?.id, notice?.url, notice?.remedy.classes.join('; '), notice?.provenance.raw_sha256, result.checked_at, result.coverage_note, result.note, JSON.stringify(result.coverage['last_successful_sync']), attribution]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
