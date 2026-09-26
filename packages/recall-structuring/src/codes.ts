/**
 * Product identification codes buried in `code_info` / `product_description`
 * prose. Exact identifiers are the product: GS1 numbers are accepted only with a
 * valid check digit, NDCs only in a recognised segment layout, and lots only
 * after an explicit lot marker.
 */

export interface ProductCodes {
  /** GTIN-14 normalised (UPC-A, EAN-13 and UDI-DI all map here), check digit verified. */
  readonly gtins: readonly string[];
  /** NDC normalised to the 11-digit 5-4-2 billing form, hyphenated. */
  readonly ndcs: readonly string[];
  readonly lots: readonly string[];
  readonly serial_numbers: readonly string[];
  readonly model_numbers: readonly string[];
  /** ISO dates (YYYY-MM-DD, or YYYY-MM when the day is absent). */
  readonly expiration_dates: readonly string[];
}

export function gs1CheckDigitValid(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += index % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function toGtin14(digits: string): string {
  return digits.padStart(14, '0');
}

/** Normalise a hyphenated NDC to 5-4-2. Returns null for non-NDC layouts. */
export function normaliseNdc(value: string): string | null {
  const match = /^(\d{4,5})-(\d{3,4})-(\d{1,2})$/.exec(value);
  if (!match) return null;
  const [, labeler = '', product = '', pack = ''] = match;
  const layout = `${labeler.length}-${product.length}-${pack.length}`;
  switch (layout) {
    case '4-4-2': return `0${labeler}-${product}-${pack}`;
    case '5-3-2': return `${labeler}-0${product}-${pack}`;
    case '5-4-1': return `${labeler}-${product}-0${pack}`;
    case '5-4-2': return `${labeler}-${product}-${pack}`;
    default: return null;
  }
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function year4(value: string): number | null {
  const n = Number(value);
  if (value.length === 4) return n >= 1990 && n <= 2099 ? n : null;
  if (value.length === 2) return 2000 + n;
  return null;
}

/** Parse one date token in the formats FDA text uses. */
export function parseLooseDate(token: string): string | null {
  const text = token.trim().replace(/\.$/, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const y = year4(m[3] as string);
    return y === null ? null : valid(y, Number(m[1]), Number(m[2]));
  }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) {
    const month = Number(m[1]);
    const y = Number(m[2]);
    return month >= 1 && month <= 12 && y >= 1990 && y <= 2099 ? `${y}-${pad(month)}` : null;
  }
  m = /^(\d{1,2})[\s-]?([A-Za-z]{3,9})[\s,-]*(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[(m[2] as string).slice(0, 4).toLowerCase()] ?? MONTHS[(m[2] as string).slice(0, 3).toLowerCase()];
    const y = year4(m[3] as string);
    return month && y ? valid(y, month, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})\.?\s*(\d{1,2})?,?\s*(\d{4}|\d{2})$/.exec(text);
  if (m) {
    const month = MONTHS[(m[1] as string).slice(0, 4).toLowerCase()] ?? MONTHS[(m[1] as string).slice(0, 3).toLowerCase()];
    const y = year4(m[3] as string);
    if (!month || !y) return null;
    return m[2] ? valid(y, month, Number(m[2])) : `${y}-${pad(month)}`;
  }
  return null;
}

function valid(y: number, month: number, day: number): string | null {
  if (y < 1990 || y > 2099 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
  return day <= last ? `${y}-${pad(month)}-${pad(day)}` : null;
}

const MONTH_NAME = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_TOKEN = new RegExp(
  [
    String.raw`\b\d{4}-\d{1,2}-\d{1,2}\b`,
    String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b`,
    String.raw`\b\d{1,2}[/.-]\d{4}\b`,
    String.raw`\b\d{1,2}[\s-]?${MONTH_NAME}\.?[\s,-]*(?:\d{4}|\d{2})\b`,
    String.raw`\b${MONTH_NAME}\.?\s*(?:\d{1,2},?\s*)?\d{4}\b`,
  ].join('|'),
  'gi',
);

const EXPIRY_MARKER =
  /\b(?:exp(?:iry|iration|ires)?\.?(?:\s*date)?|use[\s-]*by|best[\s-]*(?:by|before|if\s+used\s+by)|sell[\s-]*by|BUD|beyond[\s-]+use(?:\s+date)?|enjoy\s+by)\s*(?:date)?\s*[:#.\-]?\s*/gi;

/** A code token: must contain a digit, 3–30 chars of the lot alphabet. */
const LOT_TOKEN = /^(?=.*\d)[A-Z0-9][A-Z0-9\-/.]{1,28}[A-Z0-9]$/i;

const LOT_MARKER = /\b(?:lot|batch)(?:\s*(?:#|no\.?|nos\.?|numbers?|codes?|s))?\s*[:#.]?\s*/gi;
const SERIAL_MARKER = /\bserial(?:\s*(?:#|no\.?|nos\.?|numbers?|s))?\s*[:#.]?\s*/gi;
const MODEL_MARKER = /\b(?:model|catalog(?:ue)?|cat\.?|REF|part|item)(?:\s*(?:#|no\.?|nos\.?|numbers?|codes?|s))?\s*[:#.]?\s*/gi;

/** Markers that end a code list of a different kind. */
const STOPS: Readonly<Record<'lot' | 'serial' | 'model', RegExp>> = {
  lot: /\b(?:udi|upc|gtin|ndc|serial|model|catalog|ref|sku|item\s+(?:#|no|number|code)|distributed|manufactured|packaged)\b|[()\n]/i,
  serial: /\b(?:udi|upc|gtin|ndc|lot|batch|model|catalog|ref|sku|distributed|manufactured)\b|[()\n]/i,
  model: /\b(?:udi|upc|gtin|ndc|lot|batch|serial|sku|distributed|manufactured)\b|[;()\n]/i,
};

function listAfter(text: string, marker: RegExp, kind: keyof typeof STOPS, limit = 600): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(marker)) {
    const start = (match.index ?? 0) + match[0].length;
    let segment = text.slice(start, start + limit);
    const stop = STOPS[kind].exec(segment);
    if (stop && stop.index > 0) segment = segment.slice(0, stop.index);
    // Expiry phrases and dates sit between lots ("A, Exp 1/2/27; B, Exp ...");
    // remove them so they neither end the list nor become lots.
    segment = segment.replace(EXPIRY_MARKER, ' ').replace(DATE_TOKEN, ' ');
    for (const raw of segment.split(/[\s,;&]+|\band\b/i)) {
      const token = raw.replace(/^[#:.\-/]+|[.,:\-/]+$/g, '');
      if (!token) continue;
      if (!LOT_TOKEN.test(token)) {
        // A real word ends the list; short noise ("#", "No", "BUD") is skipped.
        if (/^[A-Za-z]{4,}$/.test(token) && !/^(?:code|codes|number|numbers|date|dates|lots?)$/i.test(token)) break;
        continue;
      }
      if (parseLooseDate(token) !== null) continue;
      found.push(token.toUpperCase());
      if (found.length > 500) return found;
    }
  }
  return found;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function parseCodes(...texts: ReadonlyArray<string | null | undefined>): ProductCodes {
  const text = texts.filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');

  const gtins = new Set<string>();
  // GS1 application identifier form: (01)00801741121067
  for (const match of text.matchAll(/\(01\)\s?(\d{14})/g)) {
    const digits = match[1] as string;
    if (gs1CheckDigitValid(digits)) gtins.add(digits);
  }
  // Bare 12/13/14-digit runs (UPC-A, EAN-13, GTIN-14 / UDI-DI), check-digit gated.
  for (const match of text.matchAll(/(?<![\d-])(\d{12,14})(?![\d-])/g)) {
    const digits = match[1] as string;
    if (gs1CheckDigitValid(digits)) gtins.add(toGtin14(digits));
  }
  // Spaced UPC as printed on labels: "0 12345 67890 5"
  for (const match of text.matchAll(/(?<!\d)(\d)[\s-](\d{5})[\s-](\d{5})[\s-](\d)(?!\d)/g)) {
    const digits = `${match[1]}${match[2]}${match[3]}${match[4]}`;
    if (gs1CheckDigitValid(digits)) gtins.add(toGtin14(digits));
  }

  const ndcs = new Set<string>();
  for (const match of text.matchAll(/(?<![\d-])(\d{4,5}-\d{3,4}-\d{1,2})(?![\d-])/g)) {
    const normalised = normaliseNdc(match[1] as string);
    if (normalised) ndcs.add(normalised);
  }

  const expirations = new Set<string>();
  for (const marker of text.matchAll(EXPIRY_MARKER)) {
    const start = (marker.index ?? 0) + marker[0].length;
    const window = text.slice(start, start + 40);
    DATE_TOKEN.lastIndex = 0;
    const date = DATE_TOKEN.exec(window);
    if (date && date.index <= 3) {
      const parsed = parseLooseDate(date[0]);
      if (parsed) expirations.add(parsed);
    }
  }
  // Parenthesised "(exp.11/13/2026)" is covered by the marker; also catch
  // "Exp 11/13/26" variants already handled. Nothing inferred without a marker.

  const lots = listAfter(text, LOT_MARKER, 'lot').filter((token) => !gtins.has(toGtin14(token)));
  const serials = listAfter(text, SERIAL_MARKER, 'serial');
  const models = listAfter(text, MODEL_MARKER, 'model', 200);

  return {
    gtins: uniqueSorted(gtins),
    ndcs: uniqueSorted(ndcs),
    lots: uniqueSorted(lots),
    serial_numbers: uniqueSorted(serials),
    model_numbers: uniqueSorted(models),
    expiration_dates: uniqueSorted(expirations),
  };
}
