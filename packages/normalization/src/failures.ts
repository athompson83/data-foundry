import type { Identifier } from '@data-foundry/canonical-schema';
import type { EvidenceLocator } from './types.js';

/**
 * Normalization failures are data, not exceptions.
 *
 * The rule this file exists to enforce: **an unmappable value is recorded as a
 * failure with a reason, never silently coerced or dropped.** `"36,000 BTU/h"`
 * must not quietly become `36000` with the unit thrown away; `"Two-Stage"` must
 * not quietly become `null`; an unrecognised refrigerant must not quietly become
 * the string it happened to arrive as. Every one of those is a published fact
 * that nobody can explain later.
 *
 * A failure is therefore a first-class output of the pipeline, carrying enough
 * context (property, source field, raw value, locator) for a human or a rule
 * change to fix the actual cause.
 */
export const NORMALIZATION_FAILURE_REASONS = [
  /** A rule marked `required` had no value in the source record. */
  'MISSING_REQUIRED_FIELD',
  /** The rule names a source field the record does not contain. */
  'NO_SOURCE_FIELD',
  /** The value was present but empty after primitive cleanup. */
  'EMPTY_VALUE',
  'UNPARSEABLE_NUMBER',
  /** A numeric transform was handed a value that still carries a unit. */
  'UNIT_IN_NUMERIC_VALUE',
  'UNPARSEABLE_BOOLEAN',
  'UNPARSEABLE_DATE',
  /** A datetime was requested but the value has no time-of-day/offset. */
  'MISSING_TIME_COMPONENT',
  'UNKNOWN_UNIT',
  'INCOMPATIBLE_UNIT_DIMENSION',
  /** The property declares a unit and the value arrived without one. */
  'MISSING_UNIT',
  'UNKNOWN_VOCABULARY',
  'UNMAPPED_VOCABULARY_TERM',
  /** The transform chain produced a kind the declared `value_type` cannot hold. */
  'VALUE_TYPE_MISMATCH',
  /** A transform was applied to a value of the wrong kind (e.g. `round` on text). */
  'TRANSFORM_NOT_APPLICABLE',
  /** A numeric value fell outside the range the rule declares as plausible. */
  'VALUE_OUT_OF_RANGE',
  /** An identifier normalised away to nothing (`"-"`, `"N/A"`, punctuation only). */
  'IDENTIFIER_EMPTY_AFTER_NORMALIZATION',
] as const;
export type NormalizationFailureReason = (typeof NORMALIZATION_FAILURE_REASONS)[number];

export interface NormalizationFailure {
  readonly reason: NormalizationFailureReason;
  /** Human-readable explanation naming the rule and the offending value. */
  readonly message: string;
  readonly property: Identifier | null;
  readonly alias_type: Identifier | null;
  readonly source_field: Identifier | null;
  readonly source_value: string | null;
  readonly locator: EvidenceLocator | null;
}

export interface FailureInput {
  readonly reason: NormalizationFailureReason;
  readonly message: string;
  readonly property?: Identifier;
  readonly alias_type?: Identifier;
  readonly source_field?: Identifier;
  readonly source_value?: string | null;
  readonly locator?: EvidenceLocator;
}

export const normalizationFailure = (input: FailureInput): NormalizationFailure => ({
  reason: input.reason,
  message: input.message,
  property: input.property ?? null,
  alias_type: input.alias_type ?? null,
  source_field: input.source_field ?? null,
  source_value: input.source_value ?? null,
  locator: input.locator ?? null,
});

/** Result of a single deterministic transform: a value, or a reason it is not one. */
export type Normalized<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: NormalizationFailureReason; readonly message: string };

export const ok = <T>(value: T): Normalized<T> => ({ ok: true, value });

export const fail = <T>(
  reason: NormalizationFailureReason,
  message: string,
): Normalized<T> => ({ ok: false, reason, message });
