/**
 * The "Verified" badge policy.
 *
 * doc 04 ("Confidence model") deliberately refuses to specify this:
 *
 *   > A user-facing "Verified" badge should require policy-based criteria,
 *   > not just a high LLM confidence number.
 *
 * That refusal is the point. Confidence scores are a model's opinion about its
 * own output; a badge is a claim WE make to a user, and in a paid data product
 * it is the claim most likely to be quoted back at us. So the rule has to be
 * written down, testable, and explainable — not inferred from a float.
 *
 * This module derives the raw signals from a `FactExplanation` (mechanical, no
 * judgement) and then applies `isVerified` (all judgement, no mechanics).
 * Keeping those apart is what makes the policy reviewable by someone who does
 * not read TypeScript: they only have to read one function.
 *
 * @see explainFact — produces the `FactExplanation` this consumes
 * @see docs/foundation/04-data-model-and-knowledge-graph.md
 */

import type { SourceType } from '@data-foundry/canonical-schema';
import type { FactExplanation } from './explain.js';

/**
 * Source types we treat as speaking with primary authority about a fact,
 * as opposed to restating someone else's claim.
 *
 * A certification body publishing a rating it measured is primary. A
 * marketplace listing repeating that rating is not — even when it is correct,
 * and even when there are fifty of them.
 */
export const AUTHORITATIVE_SOURCE_TYPES: readonly SourceType[] = [
  'REGULATORY',
  'STANDARDS_BODY',
  'CERTIFICATION_BODY',
  'MANUFACTURER',
];

/**
 * Mechanically derived inputs to the policy. Every field here is a fact about
 * the evidence, not an opinion about it.
 */
export interface VerificationSignals {
  /** Distinct publishers whose evidence backs the SELECTED claim. */
  readonly corroboratingPublishers: number;
  /** True when at least one backer is a primary-authority source type. */
  readonly hasAuthoritativeSource: boolean;
  /** Highest `authority_rank` among the selected claim's backers (0 when none). */
  readonly maxAuthorityRank: number;
  /** True when every backing source is publishable under its rights classification. */
  readonly allEvidencePublishable: boolean;
  /** Age in days of the most recent supporting retrieval; null when unknown. */
  readonly freshestEvidenceAgeDays: number | null;
  /**
   * True when at least one *authoritative* backer carries a usable retrieval
   * date. Separate from {@link freshestEvidenceAgeDays} because the badge's
   * promise is about the authoritative evidence: a marketplace listing crawled
   * this morning does not date a manufacturer sheet of unknown vintage.
   */
  readonly hasDatedAuthoritativeEvidence: boolean;
  /** Age in days of the most recent *authoritative* retrieval; null when none is dated. */
  readonly freshestAuthoritativeEvidenceAgeDays: number | null;
  /** A rival claim survives that contradicts the selected one. */
  readonly hasUnresolvedConflict: boolean;
  /** The selected claim carries at least one evidence row at all (rule 2). */
  readonly hasEvidence: boolean;
  /** Which doc-04 rule decided selection — e.g. a bare tiebreak is weak ground. */
  readonly decidedBy: FactExplanation['rule'];
}

/**
 * Blocker codes, listed in the priority order used to pick the PRIMARY
 * customer-facing reason. All applicable blockers are always retained; the
 * order only decides which one leads.
 */
export const VERIFICATION_BLOCKERS = [
  'NO_EVIDENCE',
  'UNRESOLVED_CONFLICT',
  'NO_AUTHORITATIVE_SUPPORT',
  'NON_AUTHORITATIVE_ADJUDICATION',
  'RIGHTS_RESTRICTED',
  'UNKNOWN_EVIDENCE_DATE',
] as const;
export type VerificationBlocker = (typeof VERIFICATION_BLOCKERS)[number];

/**
 * Stamped onto every verdict so the historical meaning of the badge is
 * auditable. Bump it whenever the policy's *meaning* changes, never for a
 * refactor: a stored verdict is only re-readable if the version it names still
 * describes the rule that produced it.
 */
export const VERIFICATION_POLICY_VERSION = 'verification-policy-v2';

/**
 * Every policy version that has ever been stamped onto a stored verdict, oldest
 * first. A verdict recorded under an older version is not re-interpretable
 * under the current one — that is the whole reason the version travels with it
 * — so the list is append-only and a version is never reused or removed.
 *
 * v1 → v2: the date requirement moved from "some backer is dated" to "an
 * authoritative backer is dated". A v1 verdict may therefore be `verified`
 * where v2 would refuse.
 */
export const VERIFICATION_POLICY_VERSIONS = [
  'verification-policy-v1',
  'verification-policy-v2',
] as const;
export type VerificationPolicyVersion = (typeof VERIFICATION_POLICY_VERSIONS)[number];

/**
 * The customer-facing meaning of the badge. The compact UI may render
 * "Verified"; this is what that word is contractually shorthand for.
 *
 * Deliberately claims nothing about independent testing, certification,
 * compatibility, availability, or fitness for a particular installation.
 */
export const SOURCE_VERIFIED_DEFINITION =
  'Source verified means this value is supported by dated, publishable authoritative ' +
  'evidence, was selected through an auditable authority-based rule, and has no ' +
  'unresolved conflicting source. It does not guarantee current availability, ' +
  'completeness, compatibility, or suitability for a particular use.';

export interface VerificationVerdict {
  readonly verified: boolean;
  /** Primary user-facing justification, chosen by blocker priority. */
  readonly reason: string;
  /** Every applicable blocker, so the panel can render them all at once. */
  readonly blockers: readonly VerificationBlocker[];
  readonly policy_version: typeof VERIFICATION_POLICY_VERSION;
  readonly signals: VerificationSignals;
}

const DAY_MS = 86_400_000;

/**
 * Mechanical signal extraction. No policy decisions live here — if you find
 * yourself wanting to change a threshold, change `isVerified` instead.
 *
 * `now` is injected rather than read from the clock so that verification is
 * deterministic and testable, matching the normalization layer's rule against
 * clock reads inside transforms.
 */
export function verificationSignals(
  explanation: FactExplanation,
  now: Date,
): VerificationSignals {
  const selected = explanation.selected;
  const backers = selected?.attributions ?? [];

  const publishers = new Set(backers.map((a) => a.publisher));

  let freshestMs: number | null = null;
  let freshestAuthoritativeMs: number | null = null;
  for (const a of backers) {
    const t = Date.parse(a.retrieved_at);
    if (Number.isNaN(t)) continue;
    if (freshestMs === null || t > freshestMs) freshestMs = t;
    if (!AUTHORITATIVE_SOURCE_TYPES.includes(a.source_type)) continue;
    if (freshestAuthoritativeMs === null || t > freshestAuthoritativeMs) {
      freshestAuthoritativeMs = t;
    }
  }
  const ageDays = (at: number | null): number | null =>
    at === null ? null : Math.floor((now.getTime() - at) / DAY_MS);

  return {
    corroboratingPublishers: publishers.size,
    hasAuthoritativeSource: backers.some((a) =>
      AUTHORITATIVE_SOURCE_TYPES.includes(a.source_type),
    ),
    maxAuthorityRank: backers.reduce((max, a) => Math.max(max, a.authority_rank), 0),
    allEvidencePublishable: backers.length > 0 && backers.every((a) => a.publishable),
    freshestEvidenceAgeDays: ageDays(freshestMs),
    hasDatedAuthoritativeEvidence: freshestAuthoritativeMs !== null,
    freshestAuthoritativeEvidenceAgeDays: ageDays(freshestAuthoritativeMs),
    hasUnresolvedConflict: explanation.unresolved_conflict,
    hasEvidence: backers.length > 0,
    decidedBy: explanation.rule,
  };
}

/**
 * Decision paths that may earn the badge. An explicit ALLOWLIST, never a
 * denylist: `decidedBy !== 'SOMETHING_BAD'` would fail OPEN, silently admitting
 * any selection rule added later.
 *
 * `SOLE_ELIGIBLE_CANDIDATE` is included deliberately. `fact-selection.ts`
 * short-circuits when exactly one claim survives eligibility, returning
 * `SOLE_ELIGIBLE_CANDIDATE` *before* `DIRECT_AUTHORITATIVE_SOURCE` is ever
 * evaluated — so a lone certification-body claim would otherwise be
 * unverifiable, contradicting "a single authoritative source is sufficient".
 * It cannot fail open: `hasAuthoritativeSource` is checked independently, so a
 * lone DISTRIBUTOR claim still takes the same path and is still refused.
 *
 * Do not add a rule here without a defined audit contract. Notably
 * `EDITORIAL_OVERRIDE` is excluded: staff assertion is not source verification.
 */
export const VERIFIED_DECIDERS: ReadonlySet<VerificationSignals['decidedBy']> = new Set([
  'DIRECT_AUTHORITATIVE_SOURCE',
  'SOLE_ELIGIBLE_CANDIDATE',
] satisfies VerificationSignals['decidedBy'][]);

/** Customer-facing text per blocker. Written to be read by a technician. */
const BLOCKER_REASON: Record<VerificationBlocker, string> = {
  NO_EVIDENCE: 'No source evidence is attached to this value.',
  UNRESOLVED_CONFLICT:
    'Source documents disagree, and the conflict has not been resolved.',
  NO_AUTHORITATIVE_SUPPORT:
    'No authoritative source supports this value. Agreement among non-authoritative ' +
    'publishers does not qualify as verification.',
  NON_AUTHORITATIVE_ADJUDICATION:
    'The selected value was not determined by an authoritative-source rule.',
  RIGHTS_RESTRICTED:
    'The supporting evidence cannot be displayed or cited under its current usage rights.',
  UNKNOWN_EVIDENCE_DATE:
    'The authoritative evidence for this value could not be dated, so its verification status ' +
    'cannot be established.',
};

/**
 * The policy. Deterministic, conservative, and fails closed.
 *
 * A value is source verified only when ALL hold:
 *   1. evidence exists                        (AGENTS.md rule 2 floor)
 *   2. an authoritative source backs it       (authority, not consensus)
 *   3. an allowlisted decision path chose it  (auditable adjudication)
 *   4. no unresolved contradiction remains
 *   5. every supporting row is publishable    (rules 1 and 9 — we must be able
 *                                              to SHOW the basis of the claim)
 *   6. the AUTHORITATIVE evidence can be dated (unknown date ≠ fresh, and a
 *                                              dated non-authoritative backer
 *                                              does not date an authoritative
 *                                              one)
 *
 * Note what is deliberately ABSENT: any maximum evidence age. An authoritative
 * 2019 spec may be exactly correct for a discontinued 2019 model. "Verified"
 * (defensible) and "current" (recent) are separate questions, and conflating
 * them here would silently un-verify correct historical data.
 */
export function isVerified(s: VerificationSignals): VerificationVerdict {
  // Evaluated in VERIFICATION_BLOCKERS order, so `blockers[0]` is the primary
  // reason and the whole list is available for a "why this is not verified" panel.
  const blockers: VerificationBlocker[] = [];
  if (!s.hasEvidence) blockers.push('NO_EVIDENCE');
  if (s.hasUnresolvedConflict) blockers.push('UNRESOLVED_CONFLICT');
  if (!s.hasAuthoritativeSource) blockers.push('NO_AUTHORITATIVE_SUPPORT');
  if (!VERIFIED_DECIDERS.has(s.decidedBy)) blockers.push('NON_AUTHORITATIVE_ADJUDICATION');
  if (!s.allEvidencePublishable) blockers.push('RIGHTS_RESTRICTED');
  // Keyed on the AUTHORITATIVE evidence, not on the freshest of everything.
  // Mixed attributions were the gap: an undated manufacturer sheet alongside a
  // distributor listing crawled this morning satisfied "dated" and earned a
  // badge whose text promises dated authoritative evidence.
  // Gated on the source existing: "undated" and "absent" are different refusals,
  // and NO_AUTHORITATIVE_SUPPORT above already states the second. Ungated, a
  // value with no authoritative backer at all was told its authoritative
  // evidence could not be dated, which names evidence that is not there.
  if (s.hasAuthoritativeSource && !s.hasDatedAuthoritativeEvidence) {
    blockers.push('UNKNOWN_EVIDENCE_DATE');
  }

  const primary = blockers[0];
  return {
    verified: primary === undefined,
    reason:
      primary === undefined
        ? 'Supported by dated, publishable authoritative evidence with no unresolved conflict.'
        : BLOCKER_REASON[primary],
    blockers,
    policy_version: VERIFICATION_POLICY_VERSION,
    signals: s,
  };
}

/** Convenience wrapper: explanation in, verdict out. */
export function verifyFact(explanation: FactExplanation, now: Date): VerificationVerdict {
  return isVerified(verificationSignals(explanation, now));
}
