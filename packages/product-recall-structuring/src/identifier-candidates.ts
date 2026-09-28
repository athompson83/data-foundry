/**
 * Server-side acceptance rules for product-identifier candidates proposed by an
 * extractor that is not trusted: the local collector's language model
 * (apps/local-collector). The model only proposes; these deterministic checks
 * decide. A candidate is accepted only when
 *
 * - it is printed verbatim, on token boundaries, in an allowed field of the
 *   stored source record (never text the extractor supplies);
 * - it looks like a product code (a digit, at least three letters or digits,
 *   not a date, year, phone number, measurement or check-digit-valid barcode);
 * - the nearest identifying label before it in the same sentence is a product
 *   label (model, item, style, SKU, part, catalog, product/article/stock
 *   number), not a lot, batch, serial, date-code, VIN, RN, UPC, model-year or recall label;
 *   or, with no label before it, the nearest code label after it is a product label;
 *   or (a table flattened into prose: "Model  Serial Number Range  GHD30Y7  611TA…") a product label precedes it in
 *   the sentence, no non-product label is within three words before it, and it is not a range endpoint.
 *
 * The label is derived here from that anchor; the extractor's own label is
 * only compared with it. Task `cpsc-product-identifiers@1`.
 */

import { gs1CheckDigitValid } from '@data-foundry/recall-structuring';

import { modelKey } from './text.js';

export const IDENTIFIER_TASK = 'cpsc-product-identifiers@1';
export const IDENTIFIER_LABELS = ['model', 'item', 'style', 'sku', 'part', 'catalog', 'product'] as const;
export type IdentifierLabel = (typeof IDENTIFIER_LABELS)[number];

export type CandidateRejection =
  | 'field_not_allowed'
  | 'not_in_source'
  | 'bad_shape'
  | 'year_or_date'
  | 'phone'
  | 'measurement'
  | 'barcode'
  | 'no_product_label'
  | 'non_product_label';

export type CandidateDecision =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly key: string; readonly label: IdentifierLabel }
  | { readonly ok: false; readonly reason: CandidateRejection };

const LABEL_PATTERNS: ReadonlyArray<readonly [IdentifierLabel, RegExp]> = [
  ['model', /\bmodels?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?/gi],
  ['item', /\bitems?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?/gi],
  ['style', /\bstyles?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?/gi],
  ['sku', /\bskus?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?/gi],
  ['part', /\bpart\s*(?:numbers?\b|nos?\b\.?|#)|\bp\/n\b/gi],
  ['catalog', /\bcatalog(?:ue)?s?\b(?:\s*(?:numbers?\b|nos?\b\.?|#))?|\bcat\.\s*nos?\b\.?/gi],
  ['product', /\b(?:product|article|reference|stock)\s*(?:numbers?\b|nos?\b\.?|#|codes?\b)/gi],
];

/** Labels that introduce a code that is not a product identifier. */
const NEGATIVE = /\bmodel\s*years?\b|\b(?:lots?|batch(?:es)?|serial(?:s|\s*numbers?)?|(?:date|production|manufactur(?:e|ing))\s*codes?|codes?\s*dates?|vins?|rn|upcs?|eans?|gtins?|barcodes?|ca\s*#|wpl|recall\s*(?:numbers?|nos?\b\.?)|release\s*(?:numbers?|#)|phone|telephone|fax|call)\b|\btoll[- ]free\b/gi;

/** Words that may end in a period without ending the sentence. */
const ABBREVIATION = /(?:\bno|\bnos|\bcat|\bref|\bapprox|\binc|\bco|\bcorp|\bltd|\bu\.s|\bst|\bjr|\bmr|\bmrs|\bdr|\bvs|\bft|\bin|\boz|\blbs?|\be\.g|\bi\.e)$/i;

const UNIT_AFTER = /^\s*(?:-\s*)?(?:watts?|volts?|amps?|amperes?|inch(?:es)?|in\.|feet|foot|ft|pounds?|lbs?|ounces?|oz|gallons?|gal|quarts?|liters?|litres?|ml|mm|cm|meters?|btus?|hp|mah|wh|kw|units?|pieces?|pcs|pairs?|sets?|percent|%|degrees?|months?|years?|days?|pack|count|ct)\b/i;
const MEASURE = /^\d+(?:\.\d+)?-?(?:cups?|inch(?:es)?|in|ft|foot|feet|oz|lbs?|mm|cm|m|v|volts?|w|watts?|amps?|a|packs?|pieces?|pcs?|gallons?|gal|quarts?|qt|l|ml|speed|pound|btu|hp|mah|wh|kw|piece|ct)$/i;
const SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9 .\-/#_]{0,38}[A-Za-z0-9])?$/;

/** Fields of a CPSC Recall API record a candidate may cite. */
const FIELD = /^(?:Title|Description|Products\[(\d{1,3})\]\.(?:Name|Description|Model))$/;

/** The text of one allowed field of a CPSC source record, or null when the path is not allowed or absent. */
export function candidateFieldText(record: unknown, field: string): string | null {
  const match = FIELD.exec(field);
  if (!match || !record || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  if (field === 'Title' || field === 'Description') return typeof source[field] === 'string' ? (source[field] as string) : null;
  const products = source['Products'];
  if (!Array.isArray(products)) return null;
  const product = products[Number(match[1])] as Record<string, unknown> | undefined;
  const name = field.slice(field.indexOf('.') + 1);
  const value = product?.[name];
  return typeof value === 'string' ? value : null;
}

/** Every allowed field path present in a CPSC record, in reading order. */
export function candidateFields(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const source = record as Record<string, unknown>;
  const fields = ['Title', 'Description'].filter((field) => typeof source[field] === 'string' && (source[field] as string).trim());
  const products = Array.isArray(source['Products']) ? (source['Products'] as Array<Record<string, unknown>>) : [];
  products.slice(0, 1000).forEach((product, index) => {
    for (const name of ['Name', 'Description', 'Model']) {
      if (typeof product?.[name] === 'string' && (product[name] as string).trim()) fields.push(`Products[${index}].${name}`);
    }
  });
  return fields;
}

function isAlnum(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/** Start and end of the sentence around [start, end). */
function sentenceBounds(text: string, start: number, end: number): [number, number] {
  let from = 0;
  // A semicolon separates list items inside one sentence (and table cells), so it does not end the sentence.
  for (const match of text.slice(0, start).matchAll(/[.!?](?=\s)|\n/g)) {
    const at = match.index ?? 0;
    if (match[0] === '.' && ABBREVIATION.test(text.slice(Math.max(0, at - 6), at))) continue;
    from = at + 1;
  }
  let to = text.length;
  for (const match of text.slice(end).matchAll(/[.!?](?=\s|$)|\n/g)) {
    const at = end + (match.index ?? 0);
    if (match[0] === '.' && ABBREVIATION.test(text.slice(Math.max(0, at - 6), at))) continue;
    to = at;
    break;
  }
  return [from, to];
}

interface Keyword {
  readonly start: number;
  readonly end: number;
  readonly label: IdentifierLabel | null;
}

function keywords(text: string, from: number, to: number): Keyword[] {
  const slice = text.slice(from, to);
  const found: Keyword[] = [];
  for (const [label, pattern] of LABEL_PATTERNS) {
    for (const match of slice.matchAll(pattern)) found.push({ start: from + (match.index ?? 0), end: from + (match.index ?? 0) + match[0].length, label });
  }
  for (const match of slice.matchAll(NEGATIVE)) found.push({ start: from + (match.index ?? 0), end: from + (match.index ?? 0) + match[0].length, label: null });
  return found;
}

/** Distance, in characters, a label may sit before (or, with none before, after) the identifier it anchors. */
export const MAX_ANCHOR_BEFORE = 800;
/** A non-product label this many words or fewer before a value always wins (the table rule never overrides it). */
export const NEGATIVE_NEAR_WORDS = 3;
const RANGE_NEIGHBOUR_BEFORE = /(?:\bthrough|\bthru|\bto|\s[-–]|^[-–])\s*$/i;
const RANGE_NEIGHBOUR_AFTER = /^\s*(?:through\b|thru\b|to\b|[-–]\s)/i;
export const MAX_ANCHOR_AFTER = 40;

function anchor(text: string, start: number, end: number): IdentifierLabel | CandidateRejection {
  const [from, to] = sentenceBounds(text, start, end);
  const found = keywords(text, Math.max(from, start - MAX_ANCHOR_BEFORE), Math.min(to, end + MAX_ANCHOR_AFTER));
  // A keyword overlapping the value itself ("Model 7" inside "Model 7X") is not an anchor for it.
  const before = found.filter((keyword) => keyword.end <= start).sort((a, b) => b.end - a.end || a.start - b.start);
  const nearestBefore = before[0];
  if (nearestBefore) {
    // Several patterns can end at the same place ("item number" and "number"); a product label wins only if no
    // negative label ends there too.
    const tied = before.filter((keyword) => keyword.end === nearestBefore.end);
    if (!tied.some((keyword) => keyword.label === null)) return nearestBefore.label as IdentifierLabel;
    // Table rule: a header row ("Model  Serial Number Range") puts a non-product label nearest to every cell.
    const product = before.find((keyword) => keyword.label !== null);
    const wordsSinceNegative = text.slice(nearestBefore.end, start).match(/[A-Za-z0-9]+/g)?.length ?? 0;
    const rangeEndpoint = RANGE_NEIGHBOUR_BEFORE.test(text.slice(Math.max(0, start - 12), start)) || RANGE_NEIGHBOUR_AFTER.test(text.slice(end, end + 12));
    if (product && wordsSinceNegative > NEGATIVE_NEAR_WORDS && !rangeEndpoint) return product.label as IdentifierLabel;
    return 'non_product_label';
  }
  // After the value, only an explicit code label anchors it ("AB-1234, the catalog number"), never a bare noun
  // ("… submit 99999 as a model").
  const after = found
    .filter((keyword) => keyword.start >= end && (keyword.label === null || /number|\bnos?\b|#|sku|p\/n/i.test(text.slice(keyword.start, keyword.end))))
    .sort((a, b) => a.start - b.start);
  const nearestAfter = after[0];
  if (!nearestAfter) return 'no_product_label';
  return nearestAfter.label ?? 'non_product_label';
}

const MONTH = '(?:0?[1-9]|1[0-2])';
const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const CALENDAR = [
  new RegExp(`^${MONTH}[/.-]${DAY}(?:[/.-](?:\\d{2}|\\d{4}))?$`),
  new RegExp(`^${DAY}[/.-]${MONTH}[/.-](?:\\d{2}|\\d{4})$`),
  new RegExp(`^(?:19|20)\\d\\d[/.-]${MONTH}(?:[/.-]${DAY})?$`),
  /^(?:19|20)\d\d[-/](?:19|20)?\d\d$/,
];

/**
 * A calendar date, a year range, or a bare year that is not introduced as a code. "style numbers 1928 and 2213"
 * keeps 1928 (a product label introduces the list); "Model Year 2021" and "sold since 2019" do not.
 */
function isYearOrDate(value: string, text: string, end: number): boolean {
  if (CALENDAR.some((pattern) => pattern.test(value))) return true;
  if (!/^(?:19|20)\d\d$/.test(value)) return false;
  const start = end - value.length;
  const before = text.slice(Math.max(0, start - 60), start);
  const listed = /\b(?:models?|items?|styles?|skus?|part|catalog(?:ue)?|product|article|stock)\s*(?:numbers?|nos?\.?|#)\s*(?:[:#]\s*)?(?:[A-Za-z0-9-]+\s*(?:,|and|or)\s*)*$/i.test(before);
  return !listed || /\byears?\s*$/i.test(before);
}

function shapeRejection(value: string, text: string, end: number): CandidateRejection | null {
  if (!SHAPE.test(value) || (value.match(/ /g)?.length ?? 0) > 2 || !/\d/.test(value) || modelKey(value).length < 3) return 'bad_shape';
  if (isYearOrDate(value, text, end)) return 'year_or_date';
  if (/^\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}$/.test(value) || /^1-\d{3}-\d{3}-\d{4}$/.test(value)) return 'phone';
  if (MEASURE.test(value) || /^\d{1,3}(?:,\d{3})+$/.test(value) || (/^\d+(?:\.\d+)?$/.test(value) && UNIT_AFTER.test(text.slice(end)))) return 'measurement';
  const digits = value.replace(/[ -]/g, '');
  if (/^\d+$/.test(digits) && [8, 12, 13, 14].includes(digits.length) && gs1CheckDigitValid(digits)) return 'barcode';
  return null;
}

/**
 * Decide one candidate against the exact text of the field it cites. Every
 * boundary-delimited occurrence is tried; the first that passes is recorded.
 * A value cited from a `Products[n].Model` field is anchored by the field itself.
 */
export function decideIdentifierCandidate(text: string, value: string, field: string): CandidateDecision {
  if (!FIELD.test(field)) return { ok: false, reason: 'field_not_allowed' };
  if (!value || value !== value.trim()) return { ok: false, reason: 'bad_shape' };
  let firstRejection: CandidateRejection | null = null;
  let occurred = false;
  for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) {
    const end = at + value.length;
    if (isAlnum(text[at - 1]) || isAlnum(text[end])) continue;
    occurred = true;
    const shape = shapeRejection(value, text, end);
    if (shape) return { ok: false, reason: shape };
    const label = field.endsWith('.Model') ? 'model' : anchor(text, at, end);
    if ((IDENTIFIER_LABELS as readonly string[]).includes(label)) return { ok: true, start: at, end, key: modelKey(value), label: label as IdentifierLabel };
    firstRejection ??= label as CandidateRejection;
  }
  if (!occurred) return { ok: false, reason: 'not_in_source' };
  return { ok: false, reason: firstRejection ?? 'no_product_label' };
}

export type RecordDecision = CandidateDecision & { readonly field: string };

/**
 * Decide a candidate against a whole stored record. The extractor's field claim is only a hint (small models
 * misattribute fields): the claimed field is tried first, then every other allowed field in reading order, and the
 * field where the value actually passes is recorded. A claim naming a field outside the allowed set is refused
 * outright. A value printed nowhere in the allowed fields is `not_in_source`.
 */
export function decideIdentifierInRecord(record: unknown, value: string, claimedField: string): RecordDecision {
  if (!FIELD.test(claimedField)) return { ok: false, reason: 'field_not_allowed', field: claimedField };
  const fields = candidateFields(record);
  const order = [claimedField, ...fields.filter((field) => field !== claimedField)];
  let firstRejection: RecordDecision | null = null;
  for (const field of order) {
    const text = candidateFieldText(record, field);
    if (text === null) continue;
    const decision = decideIdentifierCandidate(text, value, field);
    if (decision.ok) return { ...decision, field };
    if (decision.reason !== 'not_in_source') firstRejection ??= { ...decision, field };
  }
  return firstRejection ?? { ok: false, reason: 'not_in_source', field: claimedField };
}
