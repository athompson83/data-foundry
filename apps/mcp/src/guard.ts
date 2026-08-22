/**
 * The reviewer-identity control.
 *
 * `packages/query-model/src/serialization.ts` has documented since it was
 * written that "the REVIEWER IDENTITY is never projected onto any of these
 * shapes", and the repo has already learned once what happens when a guarantee
 * like that is a comment: the function named as the enforcement did not exist.
 * So this app does not repeat the sentence. It enforces it, twice, and returns
 * an error instead of an answer when the enforcement trips.
 *
 * WHY MCP NEEDS ITS OWN ENFORCEMENT AT ALL. `CanonicalFactView` carries only
 * the customer-visible reason and `canonicalFacts` already refuses a reason
 * that names its reviewer. But the trust tool reads `explainFact`, which is the
 * INTERNAL surface: it carries `editorial_correction.reviewer` verbatim, and
 * its `narrative` contains a rendered line reading "Reviewer: <name>". A
 * projection that spread that object, or passed the narrative through, would
 * publish a staff member's name to every agent that asked why a value changed.
 *
 * TWO LAYERS, deliberately:
 *
 *   1. `assertNoReviewerIdentity` — the query layer's own exported control,
 *      called here on the projected correction fields. Named, specific, and
 *      shared with every other surface so they cannot disagree about what
 *      counts as a leak.
 *   2. `assertPayloadCarriesNoReviewer` — a sweep of the FINISHED payload. Layer
 *      1 checks one field; this checks everything a projection actually
 *      assembled, including a field added next year by someone who never read
 *      this file. It is the layer that makes the guarantee survive edits.
 *
 * Neither layer repeats the identity in its error, for the reason
 * `ReviewerIdentityLeak` gives: a privacy guard that logs the thing it guards
 * is worse than none.
 */
import { McpToolError } from './errors.js';
import {
  assertNoReviewerIdentity,
  reviewerIdentityTokens,
  type FactExplanation,
  type WireCorrectionFields,
} from './query-layer.js';

/**
 * Reviewer names behind the corrections in these explanations.
 *
 * This is the ONE place `editorial_correction.reviewer` is read, and it is read
 * in order to search for it, never to project it.
 */
export function reviewersIn(explanations: Iterable<FactExplanation>): string[] {
  const reviewers = new Set<string>();
  for (const explanation of explanations) {
    const reviewer = explanation.editorial_correction?.reviewer;
    if (reviewer !== undefined && reviewer.trim() !== '') reviewers.add(reviewer);
  }
  return [...reviewers];
}

/** Every searchable form of every reviewer, lowercased. */
export function reviewerTokens(reviewers: Iterable<string>): string[] {
  const tokens = new Set<string>();
  for (const reviewer of reviewers) {
    for (const token of reviewerIdentityTokens(reviewer)) tokens.add(token);
  }
  return [...tokens];
}

/** Does this rendered line name a reviewer? Used to drop narrative lines. */
export function namesReviewer(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

/**
 * Layer 1: the query layer's own control, applied at this boundary.
 *
 * Converts `ReviewerIdentityLeak` into a tool error so the caller gets a
 * structured refusal rather than a thrown stack — but note the refusal is the
 * point. There is no path here that returns the payload anyway.
 */
export function guardCorrectionFields(
  fields: WireCorrectionFields,
  reviewers: readonly string[],
): void {
  try {
    assertNoReviewerIdentity(fields, reviewers);
  } catch {
    throw reviewerBlocked('editorialCorrectionReason');
  }
}

/**
 * Layer 2: sweep the assembled payload.
 *
 * Serializing and searching is crude on purpose. A structural walk would have
 * to know which fields exist, and the failure this defends against is a field
 * nobody remembered to check.
 */
export function assertPayloadCarriesNoReviewer(payload: unknown, tokens: readonly string[]): void {
  if (tokens.length === 0) return;
  const haystack = JSON.stringify(payload)?.toLowerCase() ?? '';
  for (const token of tokens) {
    if (haystack.includes(token)) throw reviewerBlocked('tool result');
  }
}

/**
 * The same sweep, for sources that failed the publish gate.
 *
 * `explainFact` renders a narrative line for EVERY claim it considered,
 * including the ones excluded on rights — publisher, the value they asserted
 * and the document it was read from, all in one sentence. The projection drops
 * those lines; this is the backstop that turns a missed line into a refusal
 * instead of a rule-1 breach.
 *
 * Tokens are publishers, domains and artifact URLs, never asserted VALUES: a
 * value like "99" occurs inside unrelated numbers and would refuse everything.
 * Dropping the line by its publisher removes the value with it.
 */
export function assertPayloadCarriesNoWithheldSource(
  payload: unknown,
  tokens: readonly string[],
): void {
  if (tokens.length === 0) return;
  const haystack = JSON.stringify(payload)?.toLowerCase() ?? '';
  for (const token of tokens) {
    if (haystack.includes(token)) {
      throw new McpToolError(
        'UNPUBLISHABLE_SOURCE_BLOCKED',
        'This result was withheld because it would have repeated a claim from a source that ' +
          'fails the publish gate. An UNREVIEWED or RED source does not publish (AGENTS.md ' +
          'rule 1), and that holds for an explanation of a value just as much as for the value.',
        { withheld: 'tool result' },
      );
    }
  }
}

function reviewerBlocked(where: string): McpToolError {
  return new McpToolError(
    'REVIEWER_IDENTITY_BLOCKED',
    `This result was withheld because ${where} would have carried the identity of the staff ` +
      'reviewer who authorised an editorial correction. The correction itself and its ' +
      'customer-visible reason are publishable; who made it is not. Rewrite the override reason ' +
      "in the vertical's fact-selection config so it explains the correction without naming who " +
      'made it.',
    { withheld: where },
  );
}
