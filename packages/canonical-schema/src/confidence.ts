import { z } from 'zod';

/**
 * The five confidence scores of doc 04 are five *different measurements*, each
 * produced by a different stage, each meaning something different:
 *
 * | score                   | produced by        | answers                                                     |
 * |-------------------------|--------------------|-------------------------------------------------------------|
 * | `extraction_confidence` | extraction         | "did we read this value off the artifact correctly?"        |
 * | `identity_confidence`   | entity resolution  | "are these two records the same real-world thing?"          |
 * | `fact_confidence`       | validation         | "is this claim about this entity true?"                     |
 * | `relationship_confidence` | validation       | "does this edge between two entities hold?"                 |
 * | `entity_quality_score`  | quality worker     | "how complete/corroborated/fresh is this entity overall?"   |
 *
 * They are branded so they cannot be assigned to each other, averaged into a
 * single "confidence", or accidentally propagated across stage boundaries. A
 * perfectly-extracted value from a badly-resolved entity is not a confident
 * fact, and collapsing the two numbers destroys the ability to say why.
 *
 * All five are unit-interval scores in `[0, 1]`.
 */
function scoreSchema<B extends string>() {
  return z.number().min(0).max(1).brand<B>();
}

export const ExtractionConfidenceSchema = scoreSchema<'ExtractionConfidence'>();
export type ExtractionConfidence = z.infer<typeof ExtractionConfidenceSchema>;

export const IdentityConfidenceSchema = scoreSchema<'IdentityConfidence'>();
export type IdentityConfidence = z.infer<typeof IdentityConfidenceSchema>;

export const FactConfidenceSchema = scoreSchema<'FactConfidence'>();
export type FactConfidence = z.infer<typeof FactConfidenceSchema>;

export const RelationshipConfidenceSchema = scoreSchema<'RelationshipConfidence'>();
export type RelationshipConfidence = z.infer<typeof RelationshipConfidenceSchema>;

export const EntityQualityScoreSchema = scoreSchema<'EntityQualityScore'>();
export type EntityQualityScore = z.infer<typeof EntityQualityScoreSchema>;

export const extractionConfidence = (value: number): ExtractionConfidence =>
  ExtractionConfidenceSchema.parse(value);
export const identityConfidence = (value: number): IdentityConfidence =>
  IdentityConfidenceSchema.parse(value);
export const factConfidence = (value: number): FactConfidence => FactConfidenceSchema.parse(value);
export const relationshipConfidence = (value: number): RelationshipConfidence =>
  RelationshipConfidenceSchema.parse(value);
export const entityQualityScore = (value: number): EntityQualityScore =>
  EntityQualityScoreSchema.parse(value);

/** Names of the five scores, for introspection and admin UIs. */
export const CONFIDENCE_SCORE_KINDS = [
  'extraction_confidence',
  'identity_confidence',
  'fact_confidence',
  'relationship_confidence',
  'entity_quality_score',
] as const;
export type ConfidenceScoreKind = (typeof CONFIDENCE_SCORE_KINDS)[number];

/**
 * Strip the brand for arithmetic/serialisation. Deliberately explicit: reaching
 * for this is the moment to ask whether two different scores are about to be
 * mixed.
 */
export const rawScore = (
  score:
    | ExtractionConfidence
    | IdentityConfidence
    | FactConfidence
    | RelationshipConfidence
    | EntityQualityScore,
): number => score as unknown as number;
