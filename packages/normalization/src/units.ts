import { fail, ok, type Normalized } from './failures.js';
import {
  collapseWhitespace,
  comparisonKey,
  normalizePunctuation,
  normalizeUnicode,
} from './text.js';

/**
 * Units, with conversion and **retention**.
 *
 * Doc 06, layer 2: "SI/base units with original unit retained". The retention
 * half is the part that gets skipped and the part that matters: a pipeline that
 * turns `"3 tons"` into `3` has not normalized anything, it has destroyed the
 * only thing that made the number meaningful. Every conversion in this module
 * reports the source unit alongside the target one, and a value whose unit is
 * unknown fails rather than passing through bare.
 *
 * `power` uses `BTU/h` as its base rather than the SI watt because the HVAC
 * vertical's own vocabulary is BTU/h and tons, and `1 ton = 12,000 BTU/h`
 * exactly — routing that identity through watts would introduce rounding error
 * into the single most common conversion in the domain.
 */
export const UNIT_DIMENSIONS = [
  'power',
  'voltage',
  'sound',
  'mass',
  'length',
  'airflow',
  'temperature',
] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export interface UnitDefinition {
  readonly symbol: string;
  readonly dimension: UnitDimension;
  /** `base = value * to_base + offset`. */
  readonly to_base: number;
  readonly offset?: number;
  readonly aliases: readonly string[];
}

/** 1 ton of refrigeration = 12,000 BTU/h. Exact by definition. */
export const BTU_PER_HOUR_PER_TON = 12_000;

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  // power / cooling capacity — base BTU/h
  { symbol: 'BTU/h', dimension: 'power', to_base: 1, aliases: ['btu/h', 'btuh', 'btu/hr', 'btu per hour', 'btu', 'btus'] },
  { symbol: 'kBTU/h', dimension: 'power', to_base: 1_000, aliases: ['kbtu/h', 'kbtuh', 'kbtu', 'mbh'] },
  { symbol: 'ton', dimension: 'power', to_base: BTU_PER_HOUR_PER_TON, aliases: ['tons', 'tr', 'ton of refrigeration', 'nominal ton', 'nominal tons'] },
  { symbol: 'W', dimension: 'power', to_base: 3.412142, aliases: ['watt', 'watts'] },
  { symbol: 'kW', dimension: 'power', to_base: 3_412.142, aliases: ['kilowatt', 'kilowatts'] },
  { symbol: 'hp', dimension: 'power', to_base: 2_544.4336, aliases: ['horsepower'] },

  // voltage — base V
  { symbol: 'V', dimension: 'voltage', to_base: 1, aliases: ['volt', 'volts', 'vac', 'vdc'] },
  { symbol: 'kV', dimension: 'voltage', to_base: 1_000, aliases: ['kilovolt', 'kilovolts'] },
  { symbol: 'mV', dimension: 'voltage', to_base: 0.001, aliases: ['millivolt', 'millivolts'] },

  // sound — base dB. dBA is A-weighted and *not* interconvertible with dB, so it
  // is its own symbol with the same base rather than an alias.
  { symbol: 'dB', dimension: 'sound', to_base: 1, aliases: ['db', 'decibel', 'decibels'] },
  { symbol: 'dBA', dimension: 'sound', to_base: 1, aliases: ['dba', 'db(a)', 'dB(A)'] },

  // mass — base lb
  { symbol: 'lb', dimension: 'mass', to_base: 1, aliases: ['lbs', 'pound', 'pounds', 'lbm'] },
  { symbol: 'oz', dimension: 'mass', to_base: 0.0625, aliases: ['ounce', 'ounces'] },
  { symbol: 'kg', dimension: 'mass', to_base: 2.20462262185, aliases: ['kilogram', 'kilograms'] },
  { symbol: 'g', dimension: 'mass', to_base: 0.00220462262185, aliases: ['gram', 'grams'] },

  // length — base in
  { symbol: 'in', dimension: 'length', to_base: 1, aliases: ['inch', 'inches', '"'] },
  { symbol: 'ft', dimension: 'length', to_base: 12, aliases: ['foot', 'feet', "'"] },
  { symbol: 'mm', dimension: 'length', to_base: 1 / 25.4, aliases: ['millimeter', 'millimetre', 'millimeters', 'millimetres'] },
  { symbol: 'cm', dimension: 'length', to_base: 1 / 2.54, aliases: ['centimeter', 'centimetre', 'centimeters', 'centimetres'] },
  { symbol: 'm', dimension: 'length', to_base: 1_000 / 25.4, aliases: ['meter', 'metre', 'meters', 'metres'] },

  // airflow — base CFM
  { symbol: 'CFM', dimension: 'airflow', to_base: 1, aliases: ['cfm', 'ft3/min', 'cu ft/min'] },
  { symbol: 'm3/h', dimension: 'airflow', to_base: 0.5885777886, aliases: ['m³/h', 'cmh'] },

  // temperature — affine, base °F
  { symbol: '°F', dimension: 'temperature', to_base: 1, offset: 0, aliases: ['f', 'degf', 'deg f', 'fahrenheit'] },
  { symbol: '°C', dimension: 'temperature', to_base: 1.8, offset: 32, aliases: ['c', 'degc', 'deg c', 'celsius', 'centigrade'] },
];

const UNIT_INDEX: ReadonlyMap<string, UnitDefinition> = (() => {
  const index = new Map<string, UnitDefinition>();
  for (const definition of UNIT_DEFINITIONS) {
    index.set(comparisonKey(definition.symbol), definition);
    for (const alias of definition.aliases) index.set(comparisonKey(alias), definition);
  }
  return index;
})();

export const findUnit = (symbolOrAlias: string): UnitDefinition | undefined =>
  UNIT_INDEX.get(comparisonKey(symbolOrAlias));

export const isKnownUnit = (symbolOrAlias: string): boolean => findUnit(symbolOrAlias) !== undefined;

export interface ConvertedQuantity {
  readonly value: number;
  readonly unit: string;
  readonly source_unit: string;
}

/**
 * Converts between two units of the same dimension.
 *
 * Returns a failure — never a bare number — when the unit is unknown or the
 * dimensions disagree, because `convert(36000, 'BTU/h', 'lb')` has no sane
 * answer and any value returned would be a lie with a locator attached to it.
 */
export function convertUnit(
  value: number,
  from: string,
  to: string,
): Normalized<ConvertedQuantity> {
  const source = findUnit(from);
  if (source === undefined) {
    return fail('UNKNOWN_UNIT', `unit ${JSON.stringify(from)} is not in the unit registry`);
  }
  const target = findUnit(to);
  if (target === undefined) {
    return fail('UNKNOWN_UNIT', `unit ${JSON.stringify(to)} is not in the unit registry`);
  }
  if (source.dimension !== target.dimension) {
    return fail(
      'INCOMPATIBLE_UNIT_DIMENSION',
      `cannot convert ${source.symbol} (${source.dimension}) to ${target.symbol} (${target.dimension})`,
    );
  }

  const base = value * source.to_base + (source.offset ?? 0);
  const converted = (base - (target.offset ?? 0)) / target.to_base;
  return ok({ value: converted, unit: target.symbol, source_unit: source.symbol });
}

/** Named because it is the single most common conversion in the HVAC vertical. */
export const btuPerHourToTons = (btuPerHour: number): number =>
  btuPerHour / BTU_PER_HOUR_PER_TON;

export const tonsToBtuPerHour = (tons: number): number => tons * BTU_PER_HOUR_PER_TON;

export interface ParsedQuantity {
  readonly value: number;
  /** `null` when the source wrote a bare number with no unit. */
  readonly unit: string | null;
  /** The unit text exactly as written, before registry lookup. */
  readonly source_unit: string | null;
}

export interface QuantityParseOptions {
  readonly decimal_separator?: string;
  readonly group_separator?: string;
}

/**
 * The numeric head of a quantity string.
 *
 * `'` and `"` are deliberately **not** part of the number: they are the foot and
 * inch symbols. Treating `'` as a Swiss group separator here would make `32'`
 * parse as a bare `32` and throw the unit away — a vertical that genuinely uses
 * `1'234'567` sets `group_separator: "'"` explicitly instead.
 */
const NUMBER_HEAD = /^\s*([+-]?[0-9][0-9\s.,]*|[+-]?[.,][0-9]+)\s*(.*)$/;

/**
 * Splits `"36,000 BTU/h"` into `36000` and `BTU/h`.
 *
 * The unit text is looked up in the registry; an unrecognised trailing token is
 * a failure rather than something to shrug off, because `"36,000 BTU/h (nominal)"`
 * silently parsed as unitless `36000` is exactly the class of bug this package
 * exists to prevent.
 */
export function parseQuantity(
  raw: string,
  options: QuantityParseOptions = {},
): Normalized<ParsedQuantity> {
  const cleaned = collapseWhitespace(normalizePunctuation(normalizeUnicode(raw)));
  if (cleaned === '') return fail('EMPTY_VALUE', 'quantity is empty');

  const match = NUMBER_HEAD.exec(cleaned);
  if (match === null) {
    return fail('UNPARSEABLE_NUMBER', `${JSON.stringify(raw)} does not start with a number`);
  }
  const numberText = match[1] ?? '';
  const unitText = (match[2] ?? '').trim();

  const parsedNumber = parseDecimal(numberText, options);
  if (!parsedNumber.ok) return parsedNumber;

  if (unitText === '') {
    return ok({ value: parsedNumber.value, unit: null, source_unit: null });
  }

  const definition = findUnit(unitText);
  if (definition === undefined) {
    return fail(
      'UNKNOWN_UNIT',
      `unit ${JSON.stringify(unitText)} in ${JSON.stringify(raw)} is not in the unit registry`,
    );
  }
  return ok({ value: parsedNumber.value, unit: definition.symbol, source_unit: unitText });
}

/**
 * Parses a decimal with configurable separators.
 *
 * Defaults to `.` decimal / `,` group. A vertical whose sources use European
 * notation sets `decimal_separator: ','` in its rule set — configuration, not a
 * fork (AGENTS.md rule 4).
 */
export function parseDecimal(
  raw: string,
  options: QuantityParseOptions = {},
): Normalized<number> {
  const decimalSeparator = options.decimal_separator ?? '.';
  const groupSeparator = options.group_separator ?? ',';

  let text = collapseWhitespace(normalizePunctuation(normalizeUnicode(raw))).replace(/\s/g, '');
  if (text === '') return fail('EMPTY_VALUE', 'number is empty');

  text = text.split(groupSeparator).join('');
  if (decimalSeparator !== '.') text = text.split(decimalSeparator).join('.');

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return fail('UNPARSEABLE_NUMBER', `${JSON.stringify(raw)} is not a decimal number`);
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return fail('UNPARSEABLE_NUMBER', `${JSON.stringify(raw)} is not a finite number`);
  }
  return ok(value);
}
