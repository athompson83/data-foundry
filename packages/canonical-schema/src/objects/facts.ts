import { z } from 'zod';
import { FactConfidenceSchema } from '../confidence.js';
import {
  EntityIdSchema,
  FactEvidenceIdSchema,
  FactIdSchema,
  SourceArtifactIdSchema,
  SourceRecordIdSchema,
} from '../ids.js';
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  LocatorTypeSchema,
} from '../primitives.js';

/**
 * A normalized canonical value is deliberately shallow: scalars, arrays of
 * scalars, or a flat map of scalars. Anything that needs nesting is still a
 * source-native shape and belongs in `source_records.raw_payload`, not in a
 * canonical fact — nested facts cannot be filtered, faceted or compared.
 */
export const CanonicalScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CanonicalScalar = z.infer<typeof CanonicalScalarSchema>;

export const CanonicalValueSchema = z.union([
  CanonicalScalarSchema,
  z.array(CanonicalScalarSchema),
  z.record(z.string(), CanonicalScalarSchema),
]);
export type CanonicalValue = z.infer<typeof CanonicalValueSchema>;

export const FACT_VALUE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'enum',
  'url',
  'quantity',
  'array',
  'object',
] as const;
export const FactValueTypeSchema = z.enum(FACT_VALUE_TYPES);
export type FactValueType = z.infer<typeof FactValueTypeSchema>;

/** Authoritative classification of how the stored value was produced. */
export const FACT_OUTPUT_KINDS = ['NORMALIZED_FACT', 'DERIVED_METRIC'] as const;
export const FactOutputKindSchema = z.enum(FACT_OUTPUT_KINDS);
export type FactOutputKind = z.infer<typeof FactOutputKindSchema>;

/**
 * Fact lifecycle.
 *
 * `SUPERSEDED` and `RETRACTED` rows stay in the table forever. Nothing in this
 * model deletes or overwrites a fact — a new value is a new row whose
 * `supersedes_fact_id` points at the version it replaces.
 */
export const FACT_STATUSES = [
  'PROPOSED',
  'ACTIVE',
  'SUPERSEDED',
  'DISPUTED',
  'RETRACTED',
] as const;
export const FactStatusSchema = z.enum(FACT_STATUSES);
export type FactStatus = z.infer<typeof FactStatusSchema>;

/**
 * `facts` — field-level claims attached to a canonical entity.
 *
 * Two independent time axes:
 *   - `valid_from` / `valid_to`  — when the claim is true *of the world*.
 *   - `recorded_at`              — when the platform learned it.
 *
 * Both are needed to answer "what did we publish on that date, and why".
 */
export const FactSchema = z.object({
  id: FactIdSchema,
  entity_id: EntityIdSchema,
  /** Vertical-defined property identifier, e.g. `voltage`, `seer2_rating`. */
  property: IdentifierSchema,
  normalized_value: CanonicalValueSchema,
  value_type: FactValueTypeSchema,
  /** NULL is retained only for unclassified rows from an upgraded database. */
  output_kind: FactOutputKindSchema.nullable(),
  /** Unit symbol for `quantity` values (`V`, `BTU/h`, `in`); null otherwise. */
  unit: z.string().min(1).max(40).nullable(),
  valid_from: IsoDateTimeSchema,
  /** Open-ended when null: this version is current. */
  valid_to: IsoDateTimeSchema.nullable(),
  status: FactStatusSchema,
  confidence: FactConfidenceSchema,
  /** Previous version of this (entity, property); null for the first version. */
  supersedes_fact_id: FactIdSchema.nullable(),
  recorded_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type Fact = z.infer<typeof FactSchema>;

export const FactInsertSchema = FactSchema.omit({ id: true, created_at: true, output_kind: true }).extend({
  output_kind: FactOutputKindSchema,
});
export type FactInsert = z.infer<typeof FactInsertSchema>;

/**
 * `fact_evidence` — the many-to-many join that makes AGENTS.md rule 2
 * enforceable ("No published fact without evidence").
 *
 * Every row pins a claim to an exact place in an exact artifact, so a
 * disputed value can be re-checked without re-crawling.
 */
export const FactEvidenceSchema = z.object({
  id: FactEvidenceIdSchema,
  fact_id: FactIdSchema,
  artifact_id: SourceArtifactIdSchema,
  source_record_id: SourceRecordIdSchema,
  /** The value exactly as it appeared in the source, pre-normalization. */
  source_value: z.string().max(4000),
  locator_type: LocatorTypeSchema,
  /** Selector / pointer / page number. Empty string for WHOLE_DOCUMENT. */
  locator_value: z.string().max(2000),
  observed_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type FactEvidence = z.infer<typeof FactEvidenceSchema>;

export const FactEvidenceInsertSchema = FactEvidenceSchema.omit({
  id: true,
  created_at: true,
});
export type FactEvidenceInsert = z.infer<typeof FactEvidenceInsertSchema>;
