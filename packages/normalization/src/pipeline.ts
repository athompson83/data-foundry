import type { CanonicalValue, FactValueType, Identifier, JsonObject } from '@data-foundry/canonical-schema';
import {
  fail,
  normalizationFailure,
  ok,
  type NormalizationFailure,
  type Normalized,
} from './failures.js';
import { normalizeIdentifierForAlias } from './identifier.js';
import {
  ruleSetAppliesTo,
  type IdentifierRule,
  type NormalizationRuleSet,
  type PropertyRule,
  type TransformSpec,
} from './rules.js';
import { normalizeBoolean, normalizeDate, normalizeDateTime, type DateFormat } from './scalars.js';
import {
  applyCase,
  collapseWhitespace,
  decodeHtmlEntities,
  isNullToken,
  normalizePunctuation,
  normalizeUnicode,
  stripInvisibleDebris,
  replacePattern,
  stripCharacters,
} from './text.js';
import {
  normalizationConfidence,
  type CanonicalCandidate,
  type EvidenceLocator,
  type IdentifierCandidate,
  type NormalizationConfidence,
  type NormalizationResult,
  type SourceNativeRecord,
  type SourceNativeValue,
} from './types.js';
import { convertUnit, parseDecimal, parseQuantity } from './units.js';
import { mapVocabulary } from './vocabulary.js';

/**
 * The deterministic normalization pipeline.
 *
 * Deterministic means, precisely: no LLM calls, no network, no randomness, no
 * clock reads, no locale-sensitive operations, no mutable module state. The same
 * `(record, ruleSet)` pair produces byte-identical output on any machine, this
 * year or next — which is what makes `source_records.normalized_payload`
 * reprocessable and golden tests meaningful.
 *
 * Doc 06's principle, stated as a boundary: *"Use AI where ambiguity remains,
 * not where deterministic logic already works."* Everything in this file is the
 * second half. Nothing here resolves identity either — that is the next stage.
 */

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** The real, observable ways a deterministic mapping can still be less than certain. */
export interface NormalizationSignals {
  /** The source wrote a bare number and the rule supplied the unit. */
  readonly assumed_unit: boolean;
  /** More than one declared date format matched, with different results. */
  readonly ambiguous_date_format: boolean;
  /** A vocabulary with `allow_unmapped` let an unknown term through. */
  readonly unmapped_vocabulary_passthrough: boolean;
  /** Rounding changed the value. */
  readonly lossy_rounding: boolean;
}

export interface NormalizationConfidencePolicy {
  readonly assumed_unit_factor?: number;
  readonly ambiguous_date_factor?: number;
  readonly unmapped_vocabulary_factor?: number;
  readonly lossy_rounding_factor?: number;
}

export const DEFAULT_NORMALIZATION_CONFIDENCE_POLICY: Required<NormalizationConfidencePolicy> = {
  /** An assumed unit is the single biggest risk here: 3 could be tons or stages. */
  assumed_unit_factor: 0.8,
  /** An ambiguous date could be off by months. */
  ambiguous_date_factor: 0.7,
  /** An unmapped term is a value we could not place in the ontology at all. */
  unmapped_vocabulary_factor: 0.6,
  lossy_rounding_factor: 0.99,
};

export const NO_SIGNALS: NormalizationSignals = {
  assumed_unit: false,
  ambiguous_date_format: false,
  unmapped_vocabulary_passthrough: false,
  lossy_rounding: false,
};

export function computeNormalizationConfidence(
  signals: NormalizationSignals,
  policy: NormalizationConfidencePolicy = {},
): NormalizationConfidence {
  const resolved = { ...DEFAULT_NORMALIZATION_CONFIDENCE_POLICY, ...policy };
  let score = 1;
  if (signals.assumed_unit) score *= resolved.assumed_unit_factor;
  if (signals.ambiguous_date_format) score *= resolved.ambiguous_date_factor;
  if (signals.unmapped_vocabulary_passthrough) score *= resolved.unmapped_vocabulary_factor;
  if (signals.lossy_rounding) score *= resolved.lossy_rounding_factor;
  return normalizationConfidence(score);
}

// ---------------------------------------------------------------------------
// Transform chain
// ---------------------------------------------------------------------------

export type WorkingValue =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'number';
      readonly value: number;
      readonly unit: string | null;
      readonly source_unit: string | null;
    }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'date'; readonly value: string }
  | { readonly kind: 'datetime'; readonly value: string }
  | { readonly kind: 'enum'; readonly value: string };

export interface TransformOutcome {
  readonly value: WorkingValue;
  readonly signals: NormalizationSignals;
  readonly applied: readonly string[];
}

/**
 * Layer 1 runs implicitly on every value before the declared chain: NFKC,
 * entity decoding, invisible TRANSPORT DEBRIS removed, typographic
 * punctuation, whitespace collapse. These are universal (doc 06 layer 1) and a
 * rule set that had to repeat them on every field would be noise a vertical
 * author would eventually get wrong.
 *
 * Debris only, deliberately: this rewrites the value that gets STORED, so it
 * uses `stripInvisibleDebris` rather than the wider set `comparisonKey` uses.
 * A zero-width joiner is scraping debris in a Latin-script model number and
 * load-bearing in Indic and Arabic text, and this function cannot tell which
 * one it is looking at. Matching can afford to be aggressive because nothing
 * it produces is written back; this cannot.
 *
 * The strip runs after entity decoding on purpose: `&shy;` and `&#8203;` are
 * how a soft hyphen and a zero-width space usually arrive, so stripping first
 * would leave the entity to be decoded into the character afterwards and put
 * it straight back.
 */
const primitiveCleanup = (raw: string): string =>
  collapseWhitespace(
    normalizePunctuation(stripInvisibleDebris(decodeHtmlEntities(normalizeUnicode(raw)))),
  );

/**
 * When a rule declares no transforms, the one implied by its `value_type` is
 * used. Explicit chains always win; this only removes boilerplate.
 */
export function defaultTransformsFor(rule: PropertyRule): readonly TransformSpec[] {
  switch (rule.value_type) {
    case 'number':
      return rule.unit === undefined
        ? [{ kind: 'number' }]
        : [{ kind: 'quantity', target_unit: rule.unit }];
    case 'integer':
      return [{ kind: 'number' }, { kind: 'integer' }];
    case 'quantity':
      return rule.unit === undefined ? [] : [{ kind: 'quantity', target_unit: rule.unit }];
    case 'boolean':
      return [{ kind: 'boolean' }];
    case 'date':
      return [{ kind: 'date' }];
    case 'datetime':
      return [{ kind: 'datetime' }];
    case 'string':
    case 'url':
    case 'enum':
    case 'array':
    case 'object':
      return [];
  }
}

const notApplicable = (transform: string, kind: string): Normalized<never> =>
  fail(
    'TRANSFORM_NOT_APPLICABLE',
    `transform ${transform} expects a different value kind but received ${kind}; check the order of the transform chain`,
  );

/**
 * Applies one declarative transform. Every branch either advances the working
 * value or returns a reason — nothing falls through to a coerced default.
 */
function applyTransform(
  current: WorkingValue,
  transform: TransformSpec,
  ruleSet: NormalizationRuleSet,
  signals: { assumed_unit: boolean; ambiguous_date_format: boolean; unmapped_vocabulary_passthrough: boolean; lossy_rounding: boolean },
): Normalized<WorkingValue> {
  switch (transform.kind) {
    case 'trim':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: current.value.trim() });
    case 'collapse_whitespace':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: collapseWhitespace(current.value) });
    case 'unicode_nfkc':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: normalizeUnicode(current.value) });
    case 'normalize_punctuation':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: normalizePunctuation(current.value) });
    case 'decode_html_entities':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: decodeHtmlEntities(current.value) });
    case 'case':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: applyCase(current.value, transform.to) });
    case 'strip_characters':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({ kind: 'text', value: stripCharacters(current.value, transform.characters) });
    case 'replace':
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      return ok({
        kind: 'text',
        value: replacePattern(
          current.value,
          transform.pattern,
          transform.replacement,
          transform.flags ?? '',
        ),
      });

    case 'number': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const options = {
        ...(transform.decimal_separator === undefined
          ? {}
          : { decimal_separator: transform.decimal_separator }),
        ...(transform.group_separator === undefined
          ? {}
          : { group_separator: transform.group_separator }),
      };
      const quantity = parseQuantity(current.value, options);
      if (quantity.ok) {
        if (quantity.value.unit !== null) {
          // Refusing here is the whole point: `36,000 BTU/h` parsed as the bare
          // number 36000 would drop the unit on the floor forever.
          return fail(
            'UNIT_IN_NUMERIC_VALUE',
            `${JSON.stringify(current.value)} carries the unit ${quantity.value.unit}; use a quantity transform so the unit is converted and retained instead of dropped`,
          );
        }
        return ok({ kind: 'number', value: quantity.value.value, unit: null, source_unit: null });
      }
      if (quantity.reason === 'UNKNOWN_UNIT') {
        return fail(
          'UNIT_IN_NUMERIC_VALUE',
          `${JSON.stringify(current.value)} has trailing non-numeric text; a number transform will not discard it`,
        );
      }
      const decimal = parseDecimal(current.value, options);
      return decimal.ok
        ? ok({ kind: 'number', value: decimal.value, unit: null, source_unit: null })
        : decimal;
    }

    case 'quantity': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const parsed = parseQuantity(current.value);
      if (!parsed.ok) return parsed;

      let sourceUnit = parsed.value.unit;
      if (sourceUnit === null) {
        const assumed = transform.default_unit ?? (transform.allow_unitless === true ? transform.target_unit : undefined);
        if (assumed === undefined) {
          return fail(
            'MISSING_UNIT',
            `${JSON.stringify(current.value)} has no unit and the rule targets ${transform.target_unit}; declare default_unit or allow_unitless rather than guessing`,
          );
        }
        sourceUnit = assumed;
        signals.assumed_unit = true;
      }

      const converted = convertUnit(parsed.value.value, sourceUnit, transform.target_unit);
      if (!converted.ok) return converted;
      return ok({
        kind: 'number',
        value: converted.value.value,
        unit: converted.value.unit,
        // Null when the source wrote nothing: an assumed unit is not a source unit.
        source_unit: parsed.value.source_unit,
      });
    }

    case 'boolean': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const vocabulary = {
        ...(transform.true_values === undefined ? {} : { true_values: transform.true_values }),
        ...(transform.false_values === undefined ? {} : { false_values: transform.false_values }),
      };
      const parsed = normalizeBoolean(current.value, vocabulary);
      return parsed.ok ? ok({ kind: 'boolean', value: parsed.value }) : parsed;
    }

    case 'date': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const formats: readonly DateFormat[] | undefined = transform.formats;
      const parsed = formats === undefined ? normalizeDate(current.value) : normalizeDate(current.value, formats);
      if (!parsed.ok) return parsed;
      if (parsed.value.ambiguous) signals.ambiguous_date_format = true;
      return ok({ kind: 'date', value: parsed.value.iso });
    }

    case 'datetime': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const parsed = normalizeDateTime(current.value);
      return parsed.ok ? ok({ kind: 'datetime', value: parsed.value }) : parsed;
    }

    case 'integer': {
      if (current.kind !== 'number') return notApplicable(transform.kind, current.kind);
      if (!Number.isInteger(current.value)) {
        return fail(
          'VALUE_TYPE_MISMATCH',
          `${current.value} is not an integer; rounding it here would change the source's claim`,
        );
      }
      return ok(current);
    }

    case 'round': {
      if (current.kind !== 'number') return notApplicable(transform.kind, current.kind);
      const factor = 10 ** transform.decimals;
      const rounded = Math.round(current.value * factor) / factor;
      if (rounded !== current.value) signals.lossy_rounding = true;
      return ok({ ...current, value: rounded });
    }

    case 'range': {
      if (current.kind !== 'number') return notApplicable(transform.kind, current.kind);
      if (transform.min !== undefined && current.value < transform.min) {
        return fail(
          'VALUE_OUT_OF_RANGE',
          `${current.value} is below the declared minimum ${transform.min}`,
        );
      }
      if (transform.max !== undefined && current.value > transform.max) {
        return fail(
          'VALUE_OUT_OF_RANGE',
          `${current.value} is above the declared maximum ${transform.max}`,
        );
      }
      return ok(current);
    }

    case 'vocabulary': {
      if (current.kind !== 'text') return notApplicable(transform.kind, current.kind);
      const vocabulary = ruleSet.vocabularies?.[transform.vocabulary];
      if (vocabulary === undefined) {
        return fail(
          'UNKNOWN_VOCABULARY',
          `vocabulary ${transform.vocabulary} is not declared in rule set ${ruleSet.id}`,
        );
      }
      const mapped = mapVocabulary(current.value, vocabulary);
      if (!mapped.ok) return mapped;
      if (mapped.value.via === 'unmapped') signals.unmapped_vocabulary_passthrough = true;
      return ok({ kind: 'enum', value: mapped.value.term });
    }
  }
}

export function applyTransforms(
  raw: string,
  transforms: readonly TransformSpec[],
  ruleSet: NormalizationRuleSet,
): Normalized<TransformOutcome> {
  const signals = { ...NO_SIGNALS };
  const applied: string[] = ['primitive_cleanup'];
  let current: WorkingValue = { kind: 'text', value: primitiveCleanup(raw) };

  for (const transform of transforms) {
    const result = applyTransform(current, transform, ruleSet, signals);
    if (!result.ok) return result;
    current = result.value;
    applied.push(transform.kind);
  }

  return ok({ value: current, signals, applied });
}

// ---------------------------------------------------------------------------
// Value-type reconciliation
// ---------------------------------------------------------------------------

const KIND_FOR_VALUE_TYPE: Readonly<Record<FactValueType, readonly WorkingValue['kind'][]>> = {
  string: ['text', 'enum'],
  url: ['text'],
  number: ['number'],
  integer: ['number'],
  quantity: ['number'],
  boolean: ['boolean'],
  date: ['date'],
  datetime: ['datetime'],
  enum: ['enum', 'text'],
  array: [],
  object: [],
};

const canonicalValueOf = (working: WorkingValue): CanonicalValue => working.value;

// ---------------------------------------------------------------------------
// Record pipeline
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  readonly confidence_policy?: NormalizationConfidencePolicy;
}

const valueIndex = (record: SourceNativeRecord): ReadonlyMap<Identifier, SourceNativeValue> =>
  new Map(record.values.map((value) => [value.field, value] as const));

/**
 * Normalizes one source-native record into typed canonical candidates.
 *
 * Throws only for *configuration* errors (a rule set pointed at the wrong entity
 * type). Every *data* problem is returned as a `NormalizationFailure` with a
 * reason, because a batch of ten thousand records must not be aborted by one bad
 * refrigerant string — and because a failure that reaches a human with a reason
 * attached is how the rule set gets fixed.
 */
export function normalizeRecord(
  record: SourceNativeRecord,
  ruleSet: NormalizationRuleSet,
  options: NormalizeOptions = {},
): NormalizationResult {
  if (!ruleSetAppliesTo(ruleSet, record.entity_type)) {
    throw new Error(
      `rule set ${ruleSet.id} declares entity types [${ruleSet.entity_types.join(', ')}] and cannot normalize a ${record.entity_type} record`,
    );
  }

  const values = valueIndex(record);
  const candidates: CanonicalCandidate[] = [];
  const identifiers: IdentifierCandidate[] = [];
  const failures: NormalizationFailure[] = [];

  for (const rule of ruleSet.properties) {
    const outcome = normalizeProperty(record, values, rule, ruleSet, options);
    if (outcome.candidate !== null) candidates.push(outcome.candidate);
    if (outcome.failure !== null) failures.push(outcome.failure);
  }

  for (const rule of ruleSet.identifiers) {
    const outcome = normalizeIdentifierRule(record, values, rule);
    if (outcome.candidate !== null) identifiers.push(outcome.candidate);
    if (outcome.failure !== null) failures.push(outcome.failure);
  }

  return {
    source_record_key: record.source_record_key,
    entity_type: record.entity_type,
    candidates,
    identifiers,
    failures,
    normalized_payload: buildNormalizedPayload(candidates, identifiers),
    rule_set_id: ruleSet.id,
    rule_set_version: ruleSet.version,
  };
}

interface PropertyOutcome {
  readonly candidate: CanonicalCandidate | null;
  readonly failure: NormalizationFailure | null;
}

function normalizeProperty(
  record: SourceNativeRecord,
  values: ReadonlyMap<Identifier, SourceNativeValue>,
  rule: PropertyRule,
  ruleSet: NormalizationRuleSet,
  options: NormalizeOptions,
): PropertyOutcome {
  const source = values.get(rule.source_field);

  // Absence is not a normalization failure — the source simply made no claim.
  // A *required* absence is, because the vertical said the field must be there.
  if (source === undefined) {
    return {
      candidate: null,
      failure:
        rule.required === true
          ? normalizationFailure({
              reason: 'MISSING_REQUIRED_FIELD',
              message: `required property ${rule.property} reads source field ${rule.source_field}, which the record does not contain`,
              property: rule.property,
              source_field: rule.source_field,
            })
          : null,
    };
  }

  if (source.raw === null || isNullToken(source.raw)) {
    return {
      candidate: null,
      failure:
        rule.required === true
          ? normalizationFailure({
              reason: 'MISSING_REQUIRED_FIELD',
              message: `required property ${rule.property} is empty in the source (${JSON.stringify(source.raw)})`,
              property: rule.property,
              source_field: rule.source_field,
              source_value: source.raw,
              locator: source.locator,
            })
          : null,
    };
  }

  const transforms = rule.transforms ?? defaultTransformsFor(rule);
  const transformed = applyTransforms(source.raw, transforms, ruleSet);
  if (!transformed.ok) {
    return {
      candidate: null,
      failure: normalizationFailure({
        reason: transformed.reason,
        message: `property ${rule.property}: ${transformed.message}`,
        property: rule.property,
        source_field: rule.source_field,
        source_value: source.raw,
        locator: source.locator,
      }),
    };
  }

  const working = transformed.value.value;
  const acceptedKinds = KIND_FOR_VALUE_TYPE[rule.value_type];
  if (!acceptedKinds.includes(working.kind)) {
    return {
      candidate: null,
      failure: normalizationFailure({
        reason: 'VALUE_TYPE_MISMATCH',
        message: `property ${rule.property} declares value_type ${rule.value_type} but the transform chain produced a ${working.kind} value; ${acceptedKinds.length === 0 ? `value_type ${rule.value_type} is not supported by the scalar transform chain` : `declare one of the transforms that yields ${acceptedKinds.join(' or ')}`}`,
        property: rule.property,
        source_field: rule.source_field,
        source_value: source.raw,
        locator: source.locator,
      }),
    };
  }

  let unit: string | null = working.kind === 'number' ? working.unit : null;
  let sourceUnit: string | null = working.kind === 'number' ? working.source_unit : null;
  let value = working;

  if (rule.unit !== undefined) {
    if (working.kind !== 'number') {
      return {
        candidate: null,
        failure: normalizationFailure({
          reason: 'VALUE_TYPE_MISMATCH',
          message: `property ${rule.property} declares unit ${rule.unit} but the transform chain produced a ${working.kind} value`,
          property: rule.property,
          source_field: rule.source_field,
          source_value: source.raw,
          locator: source.locator,
        }),
      };
    }
    if (working.unit === null) {
      return {
        candidate: null,
        failure: normalizationFailure({
          reason: 'MISSING_UNIT',
          message: `property ${rule.property} is declared in ${rule.unit} but ${JSON.stringify(source.raw)} produced a unitless number; a bare number will not be assumed to be ${rule.unit}`,
          property: rule.property,
          source_field: rule.source_field,
          source_value: source.raw,
          locator: source.locator,
        }),
      };
    }
    if (working.unit !== rule.unit) {
      const converted = convertUnit(working.value, working.unit, rule.unit);
      if (!converted.ok) {
        return {
          candidate: null,
          failure: normalizationFailure({
            reason: converted.reason,
            message: `property ${rule.property}: ${converted.message}`,
            property: rule.property,
            source_field: rule.source_field,
            source_value: source.raw,
            locator: source.locator,
          }),
        };
      }
      value = {
        kind: 'number',
        value: converted.value.value,
        unit: converted.value.unit,
        source_unit: sourceUnit ?? working.unit,
      };
      unit = converted.value.unit;
      sourceUnit = sourceUnit ?? working.unit;
    } else {
      unit = working.unit;
    }
  }

  return {
    candidate: {
      property: rule.property,
      normalized_value: canonicalValueOf(value),
      value_type: rule.value_type,
      unit,
      confidence: computeNormalizationConfidence(
        transformed.value.signals,
        options.confidence_policy ?? {},
      ),
      extraction_confidence: record.extraction_confidence,
      locator: source.locator,
      source_field: rule.source_field,
      source_value: source.raw,
      source_unit: sourceUnit,
      transforms: transformed.value.applied,
    },
    failure: null,
  };
}

interface IdentifierOutcome {
  readonly candidate: IdentifierCandidate | null;
  readonly failure: NormalizationFailure | null;
}

function normalizeIdentifierRule(
  record: SourceNativeRecord,
  values: ReadonlyMap<Identifier, SourceNativeValue>,
  rule: IdentifierRule,
): IdentifierOutcome {
  const source = values.get(rule.source_field);
  if (source === undefined || source.raw === null || isNullToken(source.raw)) {
    return {
      candidate: null,
      failure:
        rule.required === true
          ? normalizationFailure({
              reason: 'MISSING_REQUIRED_FIELD',
              message: `required identifier ${rule.alias_type} reads source field ${rule.source_field}, which is absent or empty`,
              alias_type: rule.alias_type,
              source_field: rule.source_field,
              source_value: source?.raw ?? null,
              ...(source === undefined ? {} : { locator: source.locator }),
            })
          : null,
    };
  }

  const normalized = normalizeIdentifierForAlias(rule.alias_type, source.raw, rule.options);
  if (!normalized.ok) {
    return {
      candidate: null,
      failure: normalizationFailure({
        reason: normalized.reason,
        message: `identifier ${rule.alias_type}: ${normalized.message}`,
        alias_type: rule.alias_type,
        source_field: rule.source_field,
        source_value: source.raw,
        locator: source.locator,
      }),
    };
  }

  return {
    candidate: {
      alias_type: rule.alias_type,
      // The display form is the source string, untouched. Always.
      alias_value: normalized.value.display,
      normalized_value: normalized.value.normalized,
      confidence: normalizationConfidence(1),
      extraction_confidence: record.extraction_confidence,
      locator: source.locator,
      source_field: rule.source_field,
    },
    failure: null,
  };
}

/**
 * `source_records.normalized_payload`.
 *
 * Units live beside their values rather than being folded into a string: a
 * consumer that reads `properties.cooling_capacity_btu` must be able to read
 * `units.cooling_capacity_btu` too, and identifiers keep both forms so the
 * payload alone can answer "what do we display" and "what do we match on".
 */
function buildNormalizedPayload(
  candidates: readonly CanonicalCandidate[],
  identifiers: readonly IdentifierCandidate[],
): JsonObject {
  const properties: Record<string, CanonicalValue> = {};
  const units: Record<string, string> = {};
  const identifierValues: Record<string, string> = {};
  const identifierDisplay: Record<string, string> = {};

  for (const candidate of candidates) {
    properties[candidate.property] = candidate.normalized_value;
    if (candidate.unit !== null) units[candidate.property] = candidate.unit;
  }
  for (const identifier of identifiers) {
    identifierValues[identifier.alias_type] = identifier.normalized_value;
    identifierDisplay[identifier.alias_type] = identifier.alias_value;
  }

  return {
    properties,
    units,
    identifiers: identifierValues,
    identifier_display: identifierDisplay,
  };
}

/** Convenience for batch runs; still pure and order-preserving. */
export const normalizeRecords = (
  records: readonly SourceNativeRecord[],
  ruleSet: NormalizationRuleSet,
  options: NormalizeOptions = {},
): readonly NormalizationResult[] =>
  records.map((record) => normalizeRecord(record, ruleSet, options));
