/**
 * One openFDA enforcement report in, one structured recall out. The raw record
 * is kept verbatim beside the structure and every derived field names the
 * source field and parser version that produced it, so any value can be
 * re-derived or explained from preserved evidence.
 */

import { normaliseNdc, normaliseProductNdc, parseCodes, type ProductCodes } from './codes.js';
import { parseDistribution, type DistributionGeography } from './geography.js';
import { parseQuantity, type ProductQuantity } from './quantity.js';
import { parseReason, type RecallReason } from './reasons.js';

export { parseCodes, gs1CheckDigitValid, normaliseNdc, normaliseProductNdc, productOfPackageNdc, parseLooseDate } from './codes.js';
export { parseDistribution, US_STATES } from './geography.js';
export { parseQuantity } from './quantity.js';
export { parseReason, REASON_CLASSES, ALLERGENS, PATHOGENS } from './reasons.js';
export type { ProductCodes, DistributionGeography, ProductQuantity, RecallReason };

export const PARSER_VERSION = 'recall-structuring@2';

export const RECALL_CATEGORIES = ['food', 'drug', 'device'] as const;
export type RecallCategory = (typeof RECALL_CATEGORIES)[number];

/** The subset of the openFDA enforcement schema this parser reads. */
export interface OpenFdaEnforcementRecord {
  readonly recall_number?: string;
  readonly event_id?: string;
  readonly status?: string;
  readonly classification?: string;
  readonly product_type?: string;
  readonly recalling_firm?: string;
  readonly address_1?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postal_code?: string;
  readonly country?: string;
  readonly voluntary_mandated?: string;
  readonly initial_firm_notification?: string;
  readonly distribution_pattern?: string;
  readonly product_description?: string;
  readonly product_quantity?: string;
  readonly reason_for_recall?: string;
  readonly recall_initiation_date?: string;
  readonly center_classification_date?: string;
  readonly report_date?: string;
  readonly termination_date?: string;
  readonly code_info?: string;
  readonly more_code_info?: string;
  readonly openfda?: { readonly product_ndc?: readonly string[]; readonly package_ndc?: readonly string[] } & Record<string, unknown>;
}

export interface StructuredRecall {
  readonly recall_number: string;
  readonly category: RecallCategory;
  readonly event_id: string | null;
  readonly classification: 'I' | 'II' | 'III' | null;
  readonly status: string | null;
  readonly voluntary: boolean | null;
  readonly firm: {
    readonly name: string | null;
    readonly city: string | null;
    readonly state: string | null;
    readonly postal_code: string | null;
    readonly country: string | null;
  };
  readonly dates: {
    readonly initiated: string | null;
    readonly classified: string | null;
    readonly reported: string | null;
    readonly terminated: string | null;
  };
  readonly product_description: string | null;
  readonly reason_for_recall: string | null;
  readonly distribution: DistributionGeography;
  readonly quantity: ProductQuantity;
  readonly codes: ProductCodes;
  readonly reason: RecallReason;
  readonly provenance: {
    readonly source: 'openfda-enforcement';
    readonly source_url: string;
    readonly parser_version: string;
    readonly derived_fields: Readonly<Record<string, readonly string[]>>;
  };
}

/** openFDA dates are YYYYMMDD strings. */
export function parseOpenFdaDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function classification(value: string | undefined): StructuredRecall['classification'] {
  const match = /\bclass\s+(I{1,3})\b/i.exec(value ?? '');
  return match ? ((match[1] as string).toUpperCase() as 'I' | 'II' | 'III') : null;
}

export function sourceUrl(category: RecallCategory, recallNumber: string): string {
  return `https://api.fda.gov/${category}/enforcement.json?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`;
}

/**
 * Whether a record carries a real recall number. FDA publishes some very
 * recent reports with a placeholder ("N/A") before a number is assigned; such
 * a value is shared by unrelated recalls, so it cannot be an identity. Those
 * records are skipped until FDA assigns the number, and the next sync picks
 * them up under it.
 */
export function isUsableRecallNumber(value: string | undefined): value is string {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && !/^(?:n\/?a|none|unknown|pending|tbd|null|-+)$/i.test(trimmed);
}

export function structureRecall(category: RecallCategory, record: OpenFdaEnforcementRecord): StructuredRecall {
  const recallNumber = text(record.recall_number);
  if (!isUsableRecallNumber(recallNumber ?? undefined)) throw new Error('openFDA enforcement record has no usable recall_number');

  const codes = parseCodes(record.code_info, record.more_code_info, record.product_description);
  const ndcs = new Set(codes.ndcs);
  // openFDA's harmonised NDCs are authoritative where present. Package codes
  // are kept as 5-4-2; product codes (two segments, no package) as 5-4, so a
  // recall of a whole product stays findable by its product code.
  for (const ndc of record.openfda?.package_ndc ?? []) {
    const normalised = normaliseNdc(ndc);
    if (normalised) ndcs.add(normalised);
  }
  for (const ndc of record.openfda?.product_ndc ?? []) {
    const normalised = normaliseProductNdc(ndc) ?? normaliseNdc(ndc);
    if (normalised) ndcs.add(normalised);
  }
  const voluntary = /voluntary/i.test(record.voluntary_mandated ?? '') ? true : /mandat|order/i.test(record.voluntary_mandated ?? '') ? false : null;

  return {
    recall_number: recallNumber as string,
    category,
    event_id: text(record.event_id),
    classification: classification(record.classification),
    status: text(record.status),
    voluntary,
    firm: {
      name: text(record.recalling_firm),
      city: text(record.city),
      state: text(record.state),
      postal_code: text(record.postal_code),
      country: text(record.country),
    },
    dates: {
      initiated: parseOpenFdaDate(record.recall_initiation_date),
      classified: parseOpenFdaDate(record.center_classification_date),
      reported: parseOpenFdaDate(record.report_date),
      terminated: parseOpenFdaDate(record.termination_date),
    },
    product_description: text(record.product_description),
    reason_for_recall: text(record.reason_for_recall),
    distribution: parseDistribution(record.distribution_pattern),
    quantity: parseQuantity(record.product_quantity),
    codes: { ...codes, ndcs: [...ndcs].sort() },
    reason: parseReason(record.reason_for_recall),
    provenance: {
      source: 'openfda-enforcement',
      source_url: sourceUrl(category, recallNumber as string),
      parser_version: PARSER_VERSION,
      derived_fields: {
        distribution: ['distribution_pattern'],
        quantity: ['product_quantity'],
        codes: ['code_info', 'more_code_info', 'product_description', 'openfda.package_ndc', 'openfda.product_ndc'],
        reason: ['reason_for_recall'],
        classification: ['classification'],
        dates: ['recall_initiation_date', 'center_classification_date', 'report_date', 'termination_date'],
      },
    },
  };
}
