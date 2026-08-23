import type { IsoDate, IsoDateTime } from '@data-foundry/canonical-schema';
import { fail, ok, type Normalized } from './failures.js';
import {
  collapseWhitespace,
  comparisonKey,
  isNullToken,
  normalizePunctuation,
  normalizeUnicode,
} from './text.js';

/**
 * Layer 2 of doc 06: typed values — booleans, dates, timestamps.
 *
 * Nothing here reads the clock, calls `Date.parse`, or consults the host
 * locale. `Date.parse('03/04/2026')` gives a different answer depending on the
 * runtime's interpretation of ambiguous formats; a pipeline built on it produces
 * facts that change when it is redeployed. Formats are declared by the vertical
 * and parsed explicitly.
 */

export interface BooleanVocabulary {
  readonly true_values?: readonly string[];
  readonly false_values?: readonly string[];
}

const DEFAULT_TRUE = ['true', 'yes', 'y', '1', 'on', 'included', 'standard', 'equipped', 'available'];
const DEFAULT_FALSE = ['false', 'no', 'n', '0', 'off', 'excluded', 'not included', 'unavailable'];

/**
 * Boolean vocabularies are closed sets. An unrecognised token is a failure, not
 * `false` — `"optional"` and `"field-installed"` are neither yes nor no, and
 * coercing them would publish a claim the source never made.
 */
export function normalizeBoolean(
  raw: string,
  vocabulary: BooleanVocabulary = {},
): Normalized<boolean> {
  const key = comparisonKey(raw);
  if (key === '') return fail('EMPTY_VALUE', 'boolean value is empty');

  const trueValues = new Set((vocabulary.true_values ?? DEFAULT_TRUE).map(comparisonKey));
  const falseValues = new Set((vocabulary.false_values ?? DEFAULT_FALSE).map(comparisonKey));

  if (trueValues.has(key)) return ok(true);
  if (falseValues.has(key)) return ok(false);
  return fail(
    'UNPARSEABLE_BOOLEAN',
    `${JSON.stringify(raw)} is in neither the true vocabulary [${[...trueValues].join(', ')}] nor the false vocabulary [${[...falseValues].join(', ')}]`,
  );
}

/** Declarative date formats. Adding one is a config change in the vertical. */
export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'YYYYMMDD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'MMM D, YYYY',
  'D MMM YYYY',
  'MMMM D, YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTH_NAMES: readonly string[] = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const monthFromName = (name: string): number | null => {
  const key = name.toLowerCase();
  const index = MONTH_NAMES.findIndex(
    (month) => month === key || month.slice(0, 3) === key.slice(0, 3),
  );
  return index < 0 ? null : index + 1;
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const isRealDate = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= max;
};

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const FORMAT_PATTERNS: Readonly<Record<DateFormat, RegExp>> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  'YYYY/MM/DD': /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
  YYYYMMDD: /^(\d{4})(\d{2})(\d{2})$/,
  'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  'MM-DD-YYYY': /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  'DD-MM-YYYY': /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  'MMM D, YYYY': /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/,
  'D MMM YYYY': /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/,
  'MMMM D, YYYY': /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/,
};

function applyFormat(text: string, format: DateFormat): DateParts | null {
  const match = FORMAT_PATTERNS[format].exec(text);
  if (match === null) return null;
  const [, a, b, c] = match;
  if (a === undefined || b === undefined || c === undefined) return null;

  switch (format) {
    case 'YYYY-MM-DD':
    case 'YYYY/MM/DD':
    case 'YYYYMMDD':
      return { year: Number(a), month: Number(b), day: Number(c) };
    case 'MM/DD/YYYY':
    case 'MM-DD-YYYY':
      return { year: Number(c), month: Number(a), day: Number(b) };
    case 'DD/MM/YYYY':
    case 'DD-MM-YYYY':
      return { year: Number(c), month: Number(b), day: Number(a) };
    case 'MMM D, YYYY':
    case 'MMMM D, YYYY': {
      const month = monthFromName(a);
      return month === null ? null : { year: Number(c), month, day: Number(b) };
    }
    case 'D MMM YYYY': {
      const month = monthFromName(b);
      return month === null ? null : { year: Number(c), month, day: Number(a) };
    }
  }
}

export interface DateNormalization {
  readonly iso: IsoDate;
  /** Which declared format matched, and where it sat in the list. */
  readonly format: DateFormat;
  readonly format_index: number;
  /**
   * True when more than one declared format matched with *different* results —
   * `03/04/2026` under both `MM/DD/YYYY` and `DD/MM/YYYY`. The value is still
   * produced (first format wins, deterministically) but confidence drops.
   */
  readonly ambiguous: boolean;
}

/**
 * Parses a date against an ordered list of declared formats.
 *
 * Order is the tie-breaker and it is the vertical's decision: a US
 * manufacturer's feed lists `MM/DD/YYYY` first, a European one lists
 * `DD/MM/YYYY` first. The pipeline never guesses from the runtime locale.
 */
export function normalizeDate(
  raw: string,
  formats: readonly DateFormat[] = DATE_FORMATS,
): Normalized<DateNormalization> {
  const text = collapseWhitespace(normalizePunctuation(normalizeUnicode(raw)));
  if (text === '' || isNullToken(text)) return fail('EMPTY_VALUE', 'date value is empty');
  if (formats.length === 0) {
    return fail('UNPARSEABLE_DATE', 'no date formats were declared for this rule');
  }

  const results: Array<{ readonly parts: DateParts; readonly format: DateFormat; readonly index: number }> =
    [];
  formats.forEach((format, index) => {
    const parts = applyFormat(text, format);
    if (parts !== null && isRealDate(parts.year, parts.month, parts.day)) {
      results.push({ parts, format, index });
    }
  });

  const first = results[0];
  if (first === undefined) {
    return fail(
      'UNPARSEABLE_DATE',
      `${JSON.stringify(raw)} does not match any declared format [${formats.join(', ')}]`,
    );
  }

  const distinct = new Set(
    results.map((result) => `${result.parts.year}-${result.parts.month}-${result.parts.day}`),
  );

  return ok({
    iso: `${pad(first.parts.year, 4)}-${pad(first.parts.month, 2)}-${pad(first.parts.day, 2)}`,
    format: first.format,
    format_index: first.index,
    ambiguous: distinct.size > 1,
  });
}

const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|z|[+-]\d{2}:?\d{2})$/;

/**
 * ISO-8601 timestamps only, and the offset is mandatory.
 *
 * `canonical-schema` declares `IsoDateTime` as `z.iso.datetime({ offset: true })`.
 * A source that supplies a wall-clock time with no zone is a
 * `MISSING_TIME_COMPONENT` failure rather than something to stamp `Z` onto —
 * inventing a timezone is inventing a fact.
 */
export function normalizeDateTime(raw: string): Normalized<IsoDateTime> {
  const text = collapseWhitespace(normalizePunctuation(normalizeUnicode(raw)));
  if (text === '' || isNullToken(text)) return fail('EMPTY_VALUE', 'datetime value is empty');

  const match = ISO_DATETIME.exec(text);
  if (match === null) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return fail(
        'MISSING_TIME_COMPONENT',
        `${JSON.stringify(raw)} is a date with no time of day or UTC offset; refusing to invent one`,
      );
    }
    return fail(
      'UNPARSEABLE_DATE',
      `${JSON.stringify(raw)} is not an ISO-8601 timestamp with a UTC offset`,
    );
  }

  const [, year, month, day, hour, minute, second, zone] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    zone === undefined
  ) {
    return fail('UNPARSEABLE_DATE', `${JSON.stringify(raw)} is not a complete timestamp`);
  }
  if (!isRealDate(Number(year), Number(month), Number(day))) {
    return fail('UNPARSEABLE_DATE', `${JSON.stringify(raw)} is not a real calendar date`);
  }
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? '0') > 59) {
    return fail('UNPARSEABLE_DATE', `${JSON.stringify(raw)} has an out-of-range time`);
  }

  const offset =
    zone.toUpperCase() === 'Z'
      ? 'Z'
      : zone.includes(':')
        ? zone
        : `${zone.slice(0, 3)}:${zone.slice(3)}`;

  return ok(`${year}-${month}-${day}T${hour}:${minute}:${second ?? '00'}${offset}`);
}
