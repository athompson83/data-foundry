import { z } from 'zod';
import { RelationshipConfidenceSchema } from '../confidence.js';
import {
  EntityIdSchema,
  RelationshipEvidenceIdSchema,
  RelationshipIdSchema,
  SourceArtifactIdSchema,
  SourceRecordIdSchema,
  VerticalIdSchema,
} from '../ids.js';
import { IdentifierSchema, IsoDateTimeSchema, LocatorTypeSchema } from '../primitives.js';

/**
 * Predicates the platform ships with. Verticals declare their own in
 * `relationships.yaml`; this is a starting vocabulary, not a closed enum.
 */
export const CORE_RELATIONSHIP_PREDICATES = [
  'manufactures',
  'replaces',
  'superseded_by',
  'supersedes',
  'uses_part',
  'compatible_with',
  'certified_by',
  'distributed_by',
  'part_of',
  'variant_of',
] as const;

export const RELATIONSHIP_STATUSES = [
  'PROPOSED',
  'ACTIVE',
  'SUPERSEDED',
  'DISPUTED',
  'RETRACTED',
] as const;
export const RelationshipStatusSchema = z.enum(RELATIONSHIP_STATUSES);
export type RelationshipStatus = z.infer<typeof RelationshipStatusSchema>;

/**
 * `relationships` — canonical graph edges, versioned exactly like facts.
 *
 * An edge is a claim about the world and carries the same append-only
 * `valid_from`/`valid_to` treatment, the same `supersedes_*` chain, and the same
 * mandatory evidence.
 */
export const RelationshipSchema = z.object({
  id: RelationshipIdSchema,
  vertical_id: VerticalIdSchema,
  subject_entity_id: EntityIdSchema,
  predicate: IdentifierSchema,
  object_entity_id: EntityIdSchema,
  confidence: RelationshipConfidenceSchema,
  valid_from: IsoDateTimeSchema,
  valid_to: IsoDateTimeSchema.nullable(),
  status: RelationshipStatusSchema,
  supersedes_relationship_id: RelationshipIdSchema.nullable(),
  recorded_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RelationshipInsertSchema = RelationshipSchema.omit({
  id: true,
  created_at: true,
});
export type RelationshipInsert = z.infer<typeof RelationshipInsertSchema>;

/** "Relationships also require evidence." (doc 04) — same contract as `fact_evidence`. */
export const RelationshipEvidenceSchema = z.object({
  id: RelationshipEvidenceIdSchema,
  relationship_id: RelationshipIdSchema,
  artifact_id: SourceArtifactIdSchema,
  source_record_id: SourceRecordIdSchema,
  source_value: z.string().max(4000),
  locator_type: LocatorTypeSchema,
  locator_value: z.string().max(2000),
  observed_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type RelationshipEvidence = z.infer<typeof RelationshipEvidenceSchema>;

export const RelationshipEvidenceInsertSchema = RelationshipEvidenceSchema.omit({
  id: true,
  created_at: true,
});
export type RelationshipEvidenceInsert = z.infer<typeof RelationshipEvidenceInsertSchema>;
