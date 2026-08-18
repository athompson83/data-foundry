import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONFIDENCE_SCORE_KINDS,
  EntityQualityScoreSchema,
  ExtractionConfidenceSchema,
  FactConfidenceSchema,
  IdentityConfidenceSchema,
  RelationshipConfidenceSchema,
  entityQualityScore,
  extractionConfidence,
  factConfidence,
  identityConfidence,
  rawScore,
  relationshipConfidence,
  type ExtractionConfidence,
  type FactConfidence,
  type IdentityConfidence,
} from '../src/confidence.js';

describe('the five confidence scores', () => {
  it('names all five', () => {
    expect(CONFIDENCE_SCORE_KINDS).toEqual([
      'extraction_confidence',
      'identity_confidence',
      'fact_confidence',
      'relationship_confidence',
      'entity_quality_score',
    ]);
  });

  it.each([
    ExtractionConfidenceSchema,
    IdentityConfidenceSchema,
    FactConfidenceSchema,
    RelationshipConfidenceSchema,
    EntityQualityScoreSchema,
  ])('constrains score #%# to the unit interval', (schema) => {
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(true);
    expect(schema.safeParse(0.5).success).toBe(true);
    expect(schema.safeParse(-0.01).success).toBe(false);
    expect(schema.safeParse(1.01).success).toBe(false);
    expect(schema.safeParse('0.5').success).toBe(false);
  });

  it('round-trips through the constructors', () => {
    expect(rawScore(extractionConfidence(0.42))).toBe(0.42);
    expect(rawScore(identityConfidence(0))).toBe(0);
    expect(rawScore(factConfidence(1))).toBe(1);
    expect(rawScore(relationshipConfidence(0.7))).toBe(0.7);
    expect(rawScore(entityQualityScore(0.33))).toBe(0.33);
  });

  it('throws rather than clamping an out-of-range score', () => {
    expect(() => factConfidence(1.5)).toThrow();
  });

  it('keeps the five brands mutually unassignable at the type level', () => {
    // This is the real contract: a perfectly-extracted value from a
    // badly-resolved entity is not a confident fact, and the compiler is what
    // stops the two numbers from being interchanged.
    expectTypeOf<ExtractionConfidence>().not.toEqualTypeOf<FactConfidence>();
    expectTypeOf<IdentityConfidence>().not.toEqualTypeOf<FactConfidence>();
    expectTypeOf<ExtractionConfidence>().not.toMatchTypeOf<FactConfidence>();

    const extraction: ExtractionConfidence = extractionConfidence(0.9);
    // @ts-expect-error extraction confidence is not fact confidence
    const asFact: FactConfidence = extraction;
    expect(rawScore(asFact)).toBe(0.9);
  });

  it('does not accept a bare number where a branded score is required', () => {
    // @ts-expect-error unbranded numbers must go through a constructor
    const score: FactConfidence = 0.9;
    expect(rawScore(score)).toBe(0.9);
  });
});
