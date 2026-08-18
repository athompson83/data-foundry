import { z } from 'zod';
import { IdentityConfidenceSchema } from '../confidence.js';
import {
  EntityIdSchema,
  ResolutionCandidateIdSchema,
  ResolutionJudgmentIdSchema,
  SourceRecordIdSchema,
  VerticalIdSchema,
} from '../ids.js';
import { IsoDateTimeSchema, JsonObjectSchema } from '../primitives.js';

/** The resolution ladder from doc 02: deterministic → normalized → probabilistic → LLM → human. */
export const RESOLUTION_METHODS = [
  'DETERMINISTIC',
  'NORMALIZED',
  'PROBABILISTIC',
  'LLM',
  'HUMAN',
] as const;
export const ResolutionMethodSchema = z.enum(RESOLUTION_METHODS);
export type ResolutionMethod = z.infer<typeof ResolutionMethodSchema>;

export const RESOLUTION_DECISIONS = ['PENDING', 'MATCH', 'NO_MATCH', 'NEEDS_REVIEW'] as const;
export const ResolutionDecisionSchema = z.enum(RESOLUTION_DECISIONS);
export type ResolutionDecision = z.infer<typeof ResolutionDecisionSchema>;

/**
 * One side of a candidate pair: either an already-canonical entity or a
 * source record that has not been resolved yet. Exactly one of the two is set —
 * enforced by a CHECK constraint in the migration and by
 * {@link resolutionSideIsValid} in code.
 */
export const ResolutionSideSchema = z.object({
  entity_id: EntityIdSchema.nullable(),
  source_record_id: SourceRecordIdSchema.nullable(),
});
export type ResolutionSide = z.infer<typeof ResolutionSideSchema>;

export function resolutionSideIsValid(side: ResolutionSide): boolean {
  return (side.entity_id === null) !== (side.source_record_id === null);
}

/**
 * `resolution_candidates` — possible same-entity pairs.
 *
 * `explanation_features` is not decoration: AGENTS.md rule 3 forbids silent LLM
 * merges, so whatever the matcher keyed on (shared MPN, address trigram
 * distance, model-number prefix) has to be readable by the human who reviews or
 * reverses the decision.
 */
export const ResolutionCandidateSchema = z.object({
  id: ResolutionCandidateIdSchema,
  vertical_id: VerticalIdSchema,
  left_entity_id: EntityIdSchema.nullable(),
  left_source_record_id: SourceRecordIdSchema.nullable(),
  right_entity_id: EntityIdSchema.nullable(),
  right_source_record_id: SourceRecordIdSchema.nullable(),
  method: ResolutionMethodSchema,
  score: IdentityConfidenceSchema,
  explanation_features: JsonObjectSchema,
  decision: ResolutionDecisionSchema,
  reviewed_by: z.string().max(200).nullable(),
  reviewed_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type ResolutionCandidate = z.infer<typeof ResolutionCandidateSchema>;

export const ResolutionCandidateInsertSchema = ResolutionCandidateSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type ResolutionCandidateInsert = z.infer<typeof ResolutionCandidateInsertSchema>;

export const RESOLUTION_JUDGMENT_VERDICTS = ['MERGE', 'NOT_MERGE', 'SPLIT'] as const;
export const ResolutionJudgmentVerdictSchema = z.enum(RESOLUTION_JUDGMENT_VERDICTS);
export type ResolutionJudgmentVerdict = z.infer<typeof ResolutionJudgmentVerdictSchema>;

export const JUDGMENT_ACTOR_KINDS = ['HUMAN', 'RULE', 'MODEL'] as const;
export const JudgmentActorKindSchema = z.enum(JUDGMENT_ACTOR_KINDS);
export type JudgmentActorKind = z.infer<typeof JudgmentActorKindSchema>;

/**
 * `resolution_judgments` — durable merge / not-merge decisions.
 *
 * Negative judgments are the valuable ones: they stop the matcher from
 * re-proposing the same wrong pair every crawl. Nothing here is ever deleted.
 * A reversal is a *new* judgment whose `reverses_judgment_id` points at the old
 * one, which is what makes merges auditable and reversible (AGENTS.md rule 3).
 */
export const ResolutionJudgmentSchema = z.object({
  id: ResolutionJudgmentIdSchema,
  vertical_id: VerticalIdSchema,
  candidate_id: ResolutionCandidateIdSchema.nullable(),
  verdict: ResolutionJudgmentVerdictSchema,
  left_entity_id: EntityIdSchema.nullable(),
  left_source_record_id: SourceRecordIdSchema.nullable(),
  right_entity_id: EntityIdSchema.nullable(),
  right_source_record_id: SourceRecordIdSchema.nullable(),
  /** Surviving entity for a MERGE; null for NOT_MERGE. */
  merged_into_entity_id: EntityIdSchema.nullable(),
  decided_by_kind: JudgmentActorKindSchema,
  /** Reviewer email, rule id or model id — never just "ai". */
  decided_by_actor: z.string().min(1).max(200),
  decided_at: IsoDateTimeSchema,
  identity_confidence: IdentityConfidenceSchema,
  rationale: z.string().max(4000),
  /** Set on the *new* row when it undoes an earlier judgment. */
  reverses_judgment_id: ResolutionJudgmentIdSchema.nullable(),
  /** False once a later judgment reverses this one. History is never deleted. */
  active: z.boolean(),
  created_at: IsoDateTimeSchema,
});
export type ResolutionJudgment = z.infer<typeof ResolutionJudgmentSchema>;

export const ResolutionJudgmentInsertSchema = ResolutionJudgmentSchema.omit({
  id: true,
  created_at: true,
});
export type ResolutionJudgmentInsert = z.infer<typeof ResolutionJudgmentInsertSchema>;
