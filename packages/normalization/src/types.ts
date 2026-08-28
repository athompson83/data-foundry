import type {
  CanonicalValue,
  ExtractionConfidence,
  FactValueType,
  Identifier,
  JsonObject,
  LocatorType,
  SourceArtifactId,
  SourceRecordKey,
} from '@data-foundry/canonical-schema';
import type { NormalizationFailure } from './failures.js';

/**
 * Where a value was observed inside an artifact.
 *
 * Structurally identical to the locator `@data-foundry/extraction` emits and to
 * the `locator_type` / `locator_value` pair on `fact_evidence`. It is *declared*
 * here rather than imported so normalization depends on no particular extraction
 * provider package — a source-native record could equally arrive from a Python
 * extractor or a replay of `source_records` out of Postgres. TypeScript's
 * structural typing makes extraction's output assignable to this without a cast.
 */
export interface EvidenceLocator {
  readonly type: LocatorType;
  readonly value: string;
}

/** One source-native field read off an artifact. */
export interface SourceNativeValue {
  readonly field: Identifier;
  /** Exactly as it appeared in the source. `null` when the field was absent. */
  readonly raw: string | null;
  readonly locator: EvidenceLocator;
}

/**
 * The input contract: a claim made by a source, not an entity.
 *
 * Normalization turns these into **typed canonical candidates**. It does not
 * resolve identity, does not merge records, does not look anything up, and does
 * not import `canonical-store` or `entity-resolution`.
 */
export interface SourceNativeRecord {
  readonly source_record_key: SourceRecordKey;
  readonly entity_type: Identifier;
  readonly values: readonly SourceNativeValue[];
  readonly extraction_confidence: ExtractionConfidence;
  readonly artifact_id?: SourceArtifactId;
}

/**
 * A deterministic, normalization-local score.
 *
 * Deliberately *not* `fact_confidence` — that is produced by validation, and
 * `canonical-schema` brands the five canonical scores precisely so stages cannot
 * launder one into another. This score answers only: *how certain was the
 * mapping from source text to typed value?* An exact vocabulary hit is 1; a unit
 * assumed because the source omitted it is not.
 */
declare const NORMALIZATION_CONFIDENCE: unique symbol;
export type NormalizationConfidence = number & {
  readonly [NORMALIZATION_CONFIDENCE]: 'NormalizationConfidence';
};

export const normalizationConfidence = (value: number): NormalizationConfidence => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`normalization confidence must be within [0, 1], received ${value}`);
  }
  return (Math.round(value * 10_000) / 10_000) as NormalizationConfidence;
};

export const rawNormalizationConfidence = (score: NormalizationConfidence): number =>
  score as unknown as number;

/**
 * A typed canonical candidate: everything the canonical store needs to attach a
 * fact *with evidence*, and nothing that would require resolving an entity first.
 *
 * `unit` and `source_unit` are both retained. Dropping the source unit would make
 * `2` unfalsifiable — two tons, two stages and two hundred pounds all look the
 * same once the unit is gone.
 */
export interface CanonicalCandidate {
  readonly property: Identifier;
  readonly normalized_value: CanonicalValue;
  readonly value_type: FactValueType;
  readonly output_kind: import('@data-foundry/canonical-schema').FactOutputKind;
  readonly derived_from_property?: Identifier;
  readonly transformation_ref?: string;
  /** Canonical unit symbol for quantities; `null` for unitless value types. */
  readonly unit: string | null;
  readonly confidence: NormalizationConfidence;
  /** Carried through unchanged from the record. Never mixed with `confidence`. */
  readonly extraction_confidence: ExtractionConfidence;
  readonly locator: EvidenceLocator;
  readonly source_field: Identifier;
  /** The value exactly as extraction saw it; becomes `fact_evidence.source_value`. */
  readonly source_value: string;
  /** The unit as written in the source, before conversion. */
  readonly source_unit: string | null;
  /** Ordered audit trail of the transforms that produced `normalized_value`. */
  readonly transforms: readonly string[];
}

/**
 * A normalized identifier candidate, shaped for `entity_aliases`.
 *
 * `alias_value` is the display form, preserved exactly. `normalized_value` is the
 * matching form. Entity resolution consumes the second and the UI shows the
 * first; conflating them is how a catalogue starts displaying `24ACC636A003` as
 * `24acc636a003`.
 */
export interface IdentifierCandidate {
  readonly alias_type: Identifier;
  readonly alias_value: string;
  readonly normalized_value: string;
  readonly confidence: NormalizationConfidence;
  readonly extraction_confidence: ExtractionConfidence;
  readonly locator: EvidenceLocator;
  readonly source_field: Identifier;
}

export interface NormalizationResult {
  readonly source_record_key: SourceRecordKey;
  readonly entity_type: Identifier;
  readonly candidates: readonly CanonicalCandidate[];
  readonly identifiers: readonly IdentifierCandidate[];
  readonly failures: readonly NormalizationFailure[];
  /** Shape written to `source_records.normalized_payload`. */
  readonly normalized_payload: JsonObject;
  readonly rule_set_id: string;
  readonly rule_set_version: string;
}
