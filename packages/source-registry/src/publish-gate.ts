import {
  attributionIsSatisfiable,
  canPublish,
  publishDecision,
  RightsViolationError,
} from '@data-foundry/canonical-schema';
import type { SourceRegistryEntry } from './entry.js';
import { rightsReviewIsCurrent } from './rights-policy.js';
import { decideHost } from './prohibited-sources.js';

/**
 * The rule 1 gate.
 *
 * AGENTS.md: *"No source without rights metadata. Unreviewed/RED sources must
 * not publish."* This module is where that stops being a sentence in a document
 * and starts being a function call that other packages cannot route around.
 *
 * The gate fails **closed** and reports *every* blocker rather than the first,
 * so an admin fixing a source sees the whole list instead of playing
 * whack-a-mole.
 */

export const SOURCE_GATE_CODES = [
  'SOURCE_PROHIBITED',
  'SOURCE_DOMAIN_UNDECIDABLE',
  'RIGHTS_BLOCKED',
  'KILL_SWITCH_ENGAGED',
  'SOURCE_NOT_ACTIVE',
  'RIGHTS_REVIEW_MISSING_OR_LAPSED',
  'REDISTRIBUTION_NOT_ALLOWED',
  'COMMERCIAL_USE_NOT_ALLOWED',
  'DERIVATIVE_NORMALIZATION_NOT_ALLOWED',
  'ATTRIBUTION_UNSATISFIABLE',
  'ACQUISITION_METHOD_NOT_APPROVED',
  'PROVENANCE_RETENTION_NOT_CONFIGURED',
  'IMAGE_POLICY_INCONSISTENT',
] as const;
export type SourceGateCode = (typeof SOURCE_GATE_CODES)[number];

export interface SourceGateFinding {
  readonly code: SourceGateCode;
  readonly message: string;
}

export interface SourceGateResult {
  readonly sourceKey: string;
  readonly allowed: boolean;
  readonly blockers: readonly SourceGateFinding[];
  /** Non-blocking, but someone should look: AMBER rights, lapsing review dates. */
  readonly warnings: readonly SourceGateFinding[];
}

/**
 * May anything derived from this source reach a published surface — web pages,
 * REST, MCP, bulk exports?
 *
 * `asOf` is required rather than defaulted to `Date.now()` so gate decisions are
 * reproducible in tests and re-checkable in audits.
 */
/**
 * The prohibition findings for a declared domain, fail-closed.
 *
 * Two outcomes block, and they are reported as different things because they
 * are different things: the publisher is refused in platform code, or the
 * declared domain does not denote a host we can check at all. Collapsing the
 * second into "not prohibited" is how a malformed domain becomes an allowed
 * one — so it gets its own code and blocks on its own terms.
 */
function domainFindings(domain: string): SourceGateFinding[] {
  const decision = decideHost(domain);
  if (decision.kind === 'PROHIBITED') {
    return [
      {
        code: 'SOURCE_PROHIBITED',
        message:
          `Host "${decision.host}" belongs to ${decision.prohibition.publisher}, which is ` +
          `prohibited in platform code: ${decision.prohibition.reason} ` +
          `Lifting it requires: ${decision.prohibition.liftedBy}`,
      },
    ];
  }
  if (decision.kind === 'UNDECIDABLE') {
    return [{ code: 'SOURCE_DOMAIN_UNDECIDABLE', message: decision.reason }];
  }
  return [];
}

export function evaluateSourcePublishGate(
  entry: SourceRegistryEntry,
  asOf: string,
): SourceGateResult {
  const blockers: SourceGateFinding[] = [];
  const warnings: SourceGateFinding[] = [];

  // First, and not overridable by any other field. A prohibited publisher is
  // not a rights question this declaration gets to answer.
  blockers.push(...domainFindings(entry.domain));

  const decision = publishDecision(entry.rights_classification);
  if (!decision.allowed) {
    blockers.push({ code: 'RIGHTS_BLOCKED', message: decision.reason });
  } else if (decision.requiresReview) {
    warnings.push({
      code: 'RIGHTS_BLOCKED',
      message: 'AMBER: publishable, but terms/redistribution scope still need legal sign-off.',
    });
  }

  if (entry.kill_switch_engaged) {
    blockers.push({
      code: 'KILL_SWITCH_ENGAGED',
      message: 'Source kill switch is engaged; all downstream publication is suspended.',
    });
  }

  if (entry.status !== 'ACTIVE') {
    blockers.push({
      code: 'SOURCE_NOT_ACTIVE',
      message: `Source status is ${entry.status}; only ACTIVE sources may publish.`,
    });
  }

  if (!rightsReviewIsCurrent(entry.rights_policy, asOf)) {
    blockers.push({
      code: 'RIGHTS_REVIEW_MISSING_OR_LAPSED',
      message:
        'No current human rights review on record (missing reviewer/date, or next_review_at has passed).',
    });
  } else if (entry.rights_policy.next_review_at !== null) {
    const daysLeft =
      (Date.parse(`${entry.rights_policy.next_review_at}T23:59:59Z`) - Date.parse(asOf)) / 86_400_000;
    if (daysLeft < 30) {
      warnings.push({
        code: 'RIGHTS_REVIEW_MISSING_OR_LAPSED',
        message: `Rights review lapses in ${Math.max(0, Math.floor(daysLeft))} day(s).`,
      });
    }
  }

  if (!entry.rights_policy.redistribution_allowed) {
    blockers.push({
      code: 'REDISTRIBUTION_NOT_ALLOWED',
      message: 'Rights policy does not permit redistribution of this source.',
    });
  }
  if (!entry.rights_policy.commercial_use_allowed) {
    blockers.push({
      code: 'COMMERCIAL_USE_NOT_ALLOWED',
      message: 'Rights policy does not permit commercial use of this source.',
    });
  }
  if (!entry.rights_policy.derivative_normalization_allowed) {
    blockers.push({
      code: 'DERIVATIVE_NORMALIZATION_NOT_ALLOWED',
      message:
        'Rights policy does not permit derivative normalization; canonical facts cannot be built from it.',
    });
  }

  if (!attributionIsSatisfiable(entry.attribution_requirement)) {
    blockers.push({
      code: 'ATTRIBUTION_UNSATISFIABLE',
      message: 'Attribution is required but no credit line is configured.',
    });
  }
  if (!attributionIsSatisfiable(entry.image_policy.image_attribution)) {
    blockers.push({
      code: 'ATTRIBUTION_UNSATISFIABLE',
      message: 'Image attribution is required but no credit line is configured.',
    });
  }

  if (!entry.acquisition_policy.approved) {
    blockers.push({
      code: 'ACQUISITION_METHOD_NOT_APPROVED',
      message: `Acquisition method ${entry.acquisition_policy.method} has not been approved for this source.`,
    });
  }

  if (!entry.provenance_retention.retain_artifacts) {
    blockers.push({
      code: 'PROVENANCE_RETENTION_NOT_CONFIGURED',
      message:
        'Artifact retention is disabled; published facts would become unexplainable (AGENTS.md rule 10).',
    });
  }

  if (entry.image_policy.cache_to_r2_permitted && !entry.image_policy.images_reusable) {
    blockers.push({
      code: 'IMAGE_POLICY_INCONSISTENT',
      message: 'Image caching is enabled for a source whose images are not marked reusable.',
    });
  }

  return { sourceKey: entry.key, allowed: blockers.length === 0, blockers, warnings };
}

/** Throwing form, for use at publish/export boundaries. */
export function assertSourceCanPublish(entry: SourceRegistryEntry, asOf: string): void {
  const result = evaluateSourcePublishGate(entry, asOf);
  if (!result.allowed) {
    throw new RightsViolationError(
      entry.rights_classification,
      `source "${entry.key}"`,
      result.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(' | '),
    );
  }
}

/**
 * Doc 13's activation checklist: a source cannot progress to `ACTIVE` without
 * classification, acquisition-method approval, attribution configuration, image
 * policy and a provenance retention policy.
 *
 * Weaker than the publish gate — a source can be legitimately ACTIVE for
 * internal analysis while still being unpublishable.
 */
export function evaluateSourceActivationGate(
  entry: SourceRegistryEntry,
  asOf: string,
): SourceGateResult {
  const blockers: SourceGateFinding[] = [];
  const warnings: SourceGateFinding[] = [];

  // The acquisition gate folds this gate's blockers into its own, so naming the
  // prohibition here is what keeps a prohibited source off the network — not
  // only off the published surface.
  blockers.push(...domainFindings(entry.domain));

  if (entry.rights_classification === 'UNREVIEWED') {
    blockers.push({
      code: 'RIGHTS_BLOCKED',
      message: 'Source has no rights classification; classification is a precondition of ACTIVE.',
    });
  }
  if (entry.rights_classification === 'RED') {
    blockers.push({
      code: 'RIGHTS_BLOCKED',
      message: 'RED sources must not be ingested for commercial publishing.',
    });
  }
  if (!rightsReviewIsCurrent(entry.rights_policy, asOf)) {
    blockers.push({
      code: 'RIGHTS_REVIEW_MISSING_OR_LAPSED',
      message: 'A named human reviewer and review date are required before activation.',
    });
  }
  if (!entry.acquisition_policy.approved) {
    blockers.push({
      code: 'ACQUISITION_METHOD_NOT_APPROVED',
      message: 'Acquisition method must be approved before activation.',
    });
  }
  if (!attributionIsSatisfiable(entry.attribution_requirement)) {
    blockers.push({
      code: 'ATTRIBUTION_UNSATISFIABLE',
      message: 'Attribution configuration is incomplete.',
    });
  }
  if (!entry.provenance_retention.retain_artifacts && !entry.provenance_retention.legal_hold) {
    blockers.push({
      code: 'PROVENANCE_RETENTION_NOT_CONFIGURED',
      message: 'A provenance retention policy is required before activation.',
    });
  }
  if (entry.image_policy.cache_to_r2_permitted && !entry.image_policy.images_reusable) {
    blockers.push({
      code: 'IMAGE_POLICY_INCONSISTENT',
      message: 'Image caching enabled without reusable image rights.',
    });
  }
  if (!canPublish(entry.rights_classification)) {
    warnings.push({
      code: 'RIGHTS_BLOCKED',
      message: 'Source may be ingestible but is not publishable; downstream surfaces must exclude it.',
    });
  }

  return { sourceKey: entry.key, allowed: blockers.length === 0, blockers, warnings };
}
