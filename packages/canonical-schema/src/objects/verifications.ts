import { z } from 'zod';
import { EntityIdSchema, FactIdSchema, FactVerificationIdSchema } from '../ids.js';
import { CanonicalValueSchema } from './facts.js';
import { ContentHashSchema, IdentifierSchema, IsoDateTimeSchema } from '../primitives.js';

/**
 * Reasons a value did not earn the "Source verified" badge.
 *
 * The vocabulary is closed and mirrored by a CHECK constraint: a stored refusal
 * naming a code nobody recognises is a refusal nobody can explain later, which
 * defeats the purpose of storing it.
 */
export const VERIFICATION_BLOCKER_CODES = [
  'NO_EVIDENCE',
  'UNRESOLVED_CONFLICT',
  'NO_AUTHORITATIVE_SUPPORT',
  'NON_AUTHORITATIVE_ADJUDICATION',
  'RIGHTS_RESTRICTED',
  'UNKNOWN_EVIDENCE_DATE',
] as const;
export const VerificationBlockerCodeSchema = z.enum(VERIFICATION_BLOCKER_CODES);
export type VerificationBlockerCode = z.infer<typeof VerificationBlockerCodeSchema>;

/** One backer of a verdict, addressed by content so it can be re-checked. */
export const VerificationEvidenceRefSchema = z.object({
  artifact_id: z.uuid(),
  content_hash: ContentHashSchema,
  source_record_id: z.uuid(),
  locator_type: z.string().max(60),
  locator_value: z.string().max(2000),
  artifact_url: z.string().max(2000),
  publisher: z.string().max(200),
  retrieved_at: z.string().max(60),
});
export type VerificationEvidenceRef = z.infer<typeof VerificationEvidenceRefSchema>;

/**
 * `fact_verifications` — the badge, as a stored event rather than a function of
 * today's inputs.
 *
 * "Your export said this was verified in March; on what basis?" cannot be
 * answered by recomputing, because both inputs have moved since: the evidence
 * may have been superseded and the policy rewritten. Everything needed to read
 * an old verdict without trusting today's code is on the row, and
 * `policy_version` is what makes it interpretable — `verification-policy-v2`
 * refuses badges `v1` granted.
 */
export const FactVerificationSchema = z.object({
  id: FactVerificationIdSchema,
  entity_id: EntityIdSchema,
  property: IdentifierSchema,
  fact_id: FactIdSchema,
  /** The value as published when the verdict was reached. */
  selected_value: CanonicalValueSchema,
  unit: z.string().max(60).nullable(),
  verified: z.boolean(),
  reason: z.string().max(2000),
  blockers: z.array(VerificationBlockerCodeSchema),
  /** The mechanical inputs, so a verdict can be re-derived and disputed. */
  signals: z.record(z.string(), z.unknown()),
  evidence_refs: z.array(VerificationEvidenceRefSchema),
  selection_rule: z.string().max(60),
  policy_version: z.string().min(1).max(60),
  evaluated_at: IsoDateTimeSchema,
  /** sha256 over outcome, blockers and evidence: equal means the same verdict. */
  verdict_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: IsoDateTimeSchema,
});
export type FactVerification = z.infer<typeof FactVerificationSchema>;

export const FactVerificationInsertSchema = FactVerificationSchema.omit({
  id: true,
  created_at: true,
});
export type FactVerificationInsert = z.infer<typeof FactVerificationInsertSchema>;

/** A verdict is verified exactly when nothing blocked it. */
export function verificationIsConsistent(verification: {
  readonly verified: boolean;
  readonly blockers: readonly string[];
}): boolean {
  return verification.verified === (verification.blockers.length === 0);
}
