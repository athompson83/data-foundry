import type {
  ContributionRightsEvaluation,
  RightsCell,
  RightsContribution,
  RightsDecisionCandidate,
  RightsDecisionCondition,
  RightsDenyException,
  RightsEvaluation,
  RightsEvaluationOptions,
  RightsEvaluationRequest,
  RightsReasonCode,
  RightsSnapshot,
  RightsState,
} from './types.js';
import { rightsInputsAreValid } from './schemas.js';

const timestamp = (value: string | null): number | null => {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonEmpty = (value: string | null): value is string =>
  value !== null && value.trim().length > 0;

const result = (
  request: RightsEvaluationRequest,
  state: RightsState,
  reasonCode: RightsReasonCode,
  candidate: RightsDecisionCandidate | null = null,
  additions: Partial<
    Pick<
      RightsEvaluation,
      'blockingDecisionIds' | 'exceptionIds' | 'unmetConditions' | 'obligations'
    >
  > = {},
): RightsEvaluation => ({
  permitted: reasonCode === 'ALLOW' || reasonCode === 'CONDITIONAL_ALLOW',
  state,
  reasonCode,
  cellId: candidate?.cell.id ?? null,
  decisionId: candidate?.decision.id ?? null,
  blockingDecisionIds: additions.blockingDecisionIds ?? [],
  exceptionIds: additions.exceptionIds ?? [],
  unmetConditions: additions.unmetConditions ?? [],
  obligations: additions.obligations ?? [],
  termsVersionId: candidate?.decision.controllingTermsVersionId ?? null,
  evaluatedAt: request.asOf,
});

function hardStop(request: RightsEvaluationRequest): RightsEvaluation | null {
  const { source } = request;
  if (source.prohibited) return result(request, 'DENY', 'SOURCE_PROHIBITED');
  if (source.killSwitchEngaged) return result(request, 'DENY', 'KILL_SWITCH_ENGAGED');
  const statusAllowed =
    request.sourceStatusRequirement === 'ACTIVE'
      ? source.status === 'ACTIVE'
      : source.status === 'APPROVED' || source.status === 'ACTIVE';
  if (!statusAllowed) return result(request, 'DENY', 'SOURCE_STATUS_BLOCKED');
  if (source.rightsClassification === 'RED' || source.rightsClassification === 'UNREVIEWED') {
    return result(request, 'DENY', 'RIGHTS_CLASSIFICATION_BLOCKED');
  }
  if (source.publisherId === null) return result(request, 'UNKNOWN', 'PUBLISHER_UNMAPPED');
  return null;
}

const nullableMatches = (scope: string | null, requested: string | null): boolean =>
  scope === null || scope === requested;

function termsScopeCoversCell(
  candidate: RightsDecisionCandidate,
  request: RightsEvaluationRequest,
): boolean {
  const terms = candidate.terms;
  if (terms === null) return false;
  const scope = terms.scope;
  if (scope.sourceId !== null) {
    if (candidate.cell.sourceId !== scope.sourceId) return false;
  } else if (candidate.cell.publisherId !== null) {
    if (candidate.cell.publisherId !== scope.publisherId) return false;
  } else if (
    candidate.cell.sourceId !== request.source.id ||
    request.source.publisherId !== scope.publisherId
  ) {
    return false;
  }
  if (
    scope.acquisitionRoute !== null &&
    candidate.cell.acquisitionRoute !== scope.acquisitionRoute
  ) {
    return false;
  }
  if (
    scope.accountOrProductPlan !== null &&
    candidate.cell.accountOrProductPlan !== scope.accountOrProductPlan
  ) {
    return false;
  }
  if (scope.jurisdiction !== null && candidate.cell.jurisdiction !== scope.jurisdiction) {
    return false;
  }
  return true;
}

function cellMatches(cell: RightsCell, request: RightsEvaluationRequest): boolean {
  if (cell.operation !== request.operation || cell.channel !== request.channel) return false;
  const identityMatches =
    (cell.sourceId !== null && cell.sourceId === request.source.id) ||
    (cell.publisherId !== null && cell.publisherId === request.source.publisherId);
  if (!identityMatches) return false;
  if (!nullableMatches(cell.acquisitionRoute, request.acquisitionRoute)) return false;
  if (!nullableMatches(cell.accountOrProductPlan, request.accountOrProductPlan)) return false;
  if (!nullableMatches(cell.jurisdiction, request.jurisdiction)) return false;
  if (!nullableMatches(cell.assetClass, request.assetClass)) return false;
  if (!nullableMatches(cell.outputClass, request.outputClass)) return false;
  if (cell.fieldKey !== null && cell.fieldKey !== request.fieldKey) return false;
  if (cell.fieldGroupId !== null && !request.fieldGroupIds.includes(cell.fieldGroupId)) return false;
  return true;
}

type Specificity = readonly [number, number, number, number, number, number, number];

function specificity(cell: RightsCell): Specificity {
  return [
    cell.fieldKey === null ? (cell.fieldGroupId === null ? 0 : 1) : 2,
    cell.outputClass === null ? 0 : 1,
    cell.assetClass === null ? 0 : 1,
    cell.acquisitionRoute === null ? 0 : 1,
    cell.accountOrProductPlan === null ? 0 : 1,
    cell.jurisdiction === null ? 0 : 1,
    cell.sourceId === null ? 0 : 1,
  ];
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

interface NarrowingResult {
  readonly valid: boolean;
  readonly strict: boolean;
}

const narrowerDimension = (broad: string | null, narrow: string | null): NarrowingResult => {
  if (broad !== null) return { valid: narrow === broad, strict: false };
  return { valid: true, strict: narrow !== null };
};

function identityNarrowing(
  deny: RightsCell,
  exception: RightsCell,
  sourcePublisherIds: ReadonlyMap<string, string>,
): NarrowingResult {
  if (deny.sourceId !== null) {
    return {
      valid: exception.sourceId === deny.sourceId && exception.publisherId === null,
      strict: false,
    };
  }
  if (deny.publisherId === null) return { valid: false, strict: false };
  if (exception.publisherId !== null) {
    return { valid: exception.publisherId === deny.publisherId, strict: false };
  }
  if (exception.sourceId === null) return { valid: false, strict: false };
  return {
    valid: sourcePublisherIds.get(exception.sourceId) === deny.publisherId,
    strict: true,
  };
}

function fieldNarrowing(
  deny: RightsCell,
  exception: RightsCell,
  fieldGroupMembers: ReadonlyMap<string, readonly string[]>,
): NarrowingResult {
  if (deny.fieldKey !== null) {
    return {
      valid: exception.fieldKey === deny.fieldKey && exception.fieldGroupId === null,
      strict: false,
    };
  }
  if (deny.fieldGroupId !== null) {
    if (exception.fieldGroupId === deny.fieldGroupId && exception.fieldKey === null) {
      return { valid: true, strict: false };
    }
    if (
      exception.fieldKey !== null &&
      exception.fieldGroupId === null &&
      (fieldGroupMembers.get(deny.fieldGroupId) ?? []).includes(exception.fieldKey)
    ) {
      return { valid: true, strict: true };
    }
    return { valid: false, strict: false };
  }
  return {
    valid: true,
    strict: exception.fieldKey !== null || exception.fieldGroupId !== null,
  };
}

/**
 * Prove that an exception is a proper subset of the exact DENY it names.
 * A relationship that changes operation/channel or widens any dimension is false.
 */
export function scopeIsStrictlyNarrower(
  deny: RightsCell,
  exception: RightsCell,
  fieldGroupMembers: ReadonlyMap<string, readonly string[]>,
  sourcePublisherIds: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (deny.operation !== exception.operation || deny.channel !== exception.channel) return false;
  const dimensions = [
    identityNarrowing(deny, exception, sourcePublisherIds),
    fieldNarrowing(deny, exception, fieldGroupMembers),
    narrowerDimension(deny.outputClass, exception.outputClass),
    narrowerDimension(deny.assetClass, exception.assetClass),
    narrowerDimension(deny.acquisitionRoute, exception.acquisitionRoute),
    narrowerDimension(deny.accountOrProductPlan, exception.accountOrProductPlan),
    narrowerDimension(deny.jurisdiction, exception.jurisdiction),
  ];
  return dimensions.every((dimension) => dimension.valid) && dimensions.some((dimension) => dimension.strict);
}

function isEffectiveWindow(
  effectiveFrom: string | null,
  effectiveUntil: string | null,
  asOf: number,
): boolean {
  const from = timestamp(effectiveFrom);
  const until = timestamp(effectiveUntil);
  return from !== null && from <= asOf && (effectiveUntil === null || (until !== null && asOf < until));
}

function conditionResult(
  request: RightsEvaluationRequest,
  candidate: RightsDecisionCandidate,
  options: RightsEvaluationOptions,
): RightsEvaluation | null {
  const conditions = candidate.conditions;
  if (candidate.decision.state === 'CONDITIONAL' && conditions.length === 0) {
    return result(request, 'CONDITIONAL', 'CONDITION_MISSING', candidate);
  }
  const trusted = new Set(options.trustedConditionEvaluators ?? []);
  const receipts = new Map(request.conditionReceipts.map((receipt) => [receipt.conditionId, receipt]));
  const obligations = conditions.map((condition) => ({
    conditionKey: condition.conditionKey,
    conditionType: condition.conditionType,
    evaluatorKey: condition.evaluatorKey,
    parameters: condition.parameters,
    auditRef: receipts.get(condition.id)?.auditRef ?? null,
  }));
  const unknown = conditions.filter((condition) => !trusted.has(condition.evaluatorKey));
  if (unknown.length > 0) {
    return result(request, candidate.decision.state, 'UNKNOWN_CONDITION_EVALUATOR', candidate, {
      unmetConditions: unknown.map((condition) => condition.conditionKey),
      obligations,
    });
  }
  const invalid = conditions.filter((condition) => {
    const receipt = receipts.get(condition.id);
    return (
      receipt !== undefined &&
      (receipt.evaluatorKey !== condition.evaluatorKey ||
        receipt.evaluatorVersion !== condition.evaluatorVersion ||
        receipt.parametersSha256 !== condition.parametersSha256 ||
        receipt.parametersCanonical !== condition.parametersCanonical)
    );
  });
  if (invalid.length > 0) {
    return result(request, candidate.decision.state, 'CONDITION_RECEIPT_INVALID', candidate, {
      unmetConditions: invalid.map((condition) => condition.conditionKey),
      obligations,
    });
  }
  const asOf = timestamp(request.asOf);
  const stale = conditions.filter((condition) => {
    const receipt = receipts.get(condition.id);
    if (receipt === undefined || asOf === null) return false;
    const evaluatedAt = timestamp(receipt.evaluatedAt);
    const validUntil = timestamp(receipt.validUntil);
    return (
      evaluatedAt === null ||
      validUntil === null ||
      evaluatedAt > asOf ||
      validUntil <= asOf ||
      validUntil <= evaluatedAt
    );
  });
  if (stale.length > 0) {
    return result(request, candidate.decision.state, 'CONDITION_RECEIPT_STALE', candidate, {
      unmetConditions: stale.map((condition) => condition.conditionKey),
      obligations,
    });
  }
  const unmet = conditions.filter(
    (condition) => receipts.get(condition.id)?.satisfied !== true,
  );
  if (unmet.length > 0) {
    return result(request, candidate.decision.state, 'CONDITION_UNMET', candidate, {
      unmetConditions: unmet.map((condition) => condition.conditionKey),
      obligations,
    });
  }
  const unaudited = conditions.filter((condition) => {
    if (!condition.auditRequired) return false;
    return !nonEmpty(receipts.get(condition.id)?.auditRef ?? null);
  });
  if (unaudited.length > 0) {
    return result(request, candidate.decision.state, 'CONDITION_AUDIT_MISSING', candidate, {
      unmetConditions: unaudited.map((condition) => condition.conditionKey),
      obligations,
    });
  }
  return null;
}

function permissionResult(
  request: RightsEvaluationRequest,
  candidate: RightsDecisionCandidate,
  options: RightsEvaluationOptions,
): RightsEvaluation {
  const { decision, terms } = candidate;
  if (decision.state === 'UNKNOWN') {
    return result(request, 'UNKNOWN', 'EXPLICIT_UNKNOWN', candidate);
  }
  if (decision.state === 'NOT_APPLICABLE') {
    return result(request, 'NOT_APPLICABLE', 'NOT_APPLICABLE', candidate);
  }
  if (decision.state === 'DENY') return result(request, 'DENY', 'STICKY_DENY', candidate);
  const asOf = timestamp(request.asOf);
  if (asOf === null) return result(request, decision.state, 'DECISION_NOT_EFFECTIVE', candidate);
  const activationAt = timestamp(candidate.activation.occurredAt);
  if (
    candidate.activation.actorType === 'AUTOMATED' ||
    (candidate.activation.actorType !== 'HUMAN' && candidate.activation.actorType !== 'COUNSEL') ||
    activationAt === null ||
    activationAt > asOf
  ) {
    return result(request, decision.state, 'ACTIVATION_INVALID', candidate);
  }
  if (decision.reviewerType === 'AUTOMATED') {
    return result(request, decision.state, 'AUTOMATED_PERMISSION', candidate);
  }
  if (
    decision.reviewStatus !== 'APPROVED' ||
    (decision.reviewerType !== 'HUMAN' && decision.reviewerType !== 'COUNSEL') ||
    !nonEmpty(decision.reviewedBy) ||
    !nonEmpty(decision.evidenceArtifactId) ||
    !nonEmpty(decision.clauseRef) ||
    timestamp(decision.reviewedAt) === null ||
    (timestamp(decision.reviewedAt) as number) > asOf ||
    (timestamp(decision.reviewedAt) as number) > activationAt ||
    decision.controllingTermsVersionId === null ||
    decision.recheckAt === null
  ) {
    return result(request, decision.state, 'PERMISSION_REVIEW_INVALID', candidate);
  }
  if (terms === null) return result(request, decision.state, 'TERMS_MISSING', candidate);
  if (
    terms.version.id !== decision.controllingTermsVersionId ||
    !/^[0-9a-f]{64}$/.test(terms.version.contentSha256)
  ) {
    return result(request, decision.state, 'TERMS_VERSION_INVALID', candidate);
  }
  if (!termsScopeCoversCell(candidate, request)) {
    return result(request, decision.state, 'TERMS_SCOPE_MISMATCH', candidate);
  }
  if (terms.currentVersionId !== terms.version.id) {
    return result(request, decision.state, 'TERMS_NOT_CURRENT', candidate);
  }
  if (terms.activationState !== 'ACTIVE') {
    return result(request, decision.state, 'TERMS_REVOKED', candidate);
  }
  const termsActivationAt = timestamp(terms.activationOccurredAt);
  if (
    terms.activationActorType === null ||
    terms.activationActorType === 'AUTOMATED' ||
    termsActivationAt === null ||
    termsActivationAt > asOf
  ) {
    return result(request, decision.state, 'TERMS_NOT_CURRENT', candidate);
  }
  if (!isEffectiveWindow(terms.version.effectiveFrom, terms.version.effectiveUntil, asOf)) {
    return result(request, decision.state, 'TERMS_NOT_EFFECTIVE', candidate);
  }
  const termsRecheckAt = timestamp(terms.version.recheckAt);
  if (termsRecheckAt === null || asOf >= termsRecheckAt) {
    return result(request, decision.state, 'REVIEW_DUE', candidate);
  }
  if (!isEffectiveWindow(decision.effectiveFrom, decision.effectiveUntil, asOf)) {
    return result(request, decision.state, 'DECISION_NOT_EFFECTIVE', candidate);
  }
  const recheckAt = timestamp(decision.recheckAt);
  if (recheckAt === null || asOf >= recheckAt) {
    return result(request, decision.state, 'REVIEW_DUE', candidate);
  }
  const blockedCondition = conditionResult(request, candidate, options);
  if (blockedCondition !== null) return blockedCondition;
  const receipts = new Map(request.conditionReceipts.map((receipt) => [receipt.conditionId, receipt]));
  const obligations = candidate.conditions.map((condition: RightsDecisionCondition) => ({
    conditionKey: condition.conditionKey,
    conditionType: condition.conditionType,
    evaluatorKey: condition.evaluatorKey,
    parameters: condition.parameters,
    auditRef: receipts.get(condition.id)?.auditRef ?? null,
  }));
  return result(
    request,
    decision.state,
    decision.state === 'CONDITIONAL' ? 'CONDITIONAL_ALLOW' : 'ALLOW',
    candidate,
    { obligations },
  );
}

function exceptionLinkEffective(link: RightsDenyException, asOf: number): boolean {
  const reviewedAt = timestamp(link.reviewedAt);
  return (
    nonEmpty(link.evidenceArtifactId) &&
    nonEmpty(link.clauseRef) &&
    nonEmpty(link.reviewedBy) &&
    (link.reviewerType === 'HUMAN' || link.reviewerType === 'COUNSEL') &&
    reviewedAt !== null &&
    reviewedAt <= asOf &&
    isEffectiveWindow(link.effectiveFrom, link.effectiveUntil, asOf) &&
    timestamp(link.recheckAt) !== null &&
    asOf < (timestamp(link.recheckAt) as number)
  );
}

export function evaluateRights(
  request: RightsEvaluationRequest,
  snapshot: RightsSnapshot,
  options: RightsEvaluationOptions = {},
): RightsEvaluation {
  if (!rightsInputsAreValid(request, snapshot)) {
    return result(request, 'UNKNOWN', 'MALFORMED_SNAPSHOT');
  }
  const stopped = hardStop(request);
  if (stopped !== null) return stopped;

  const matching = snapshot.candidates.filter((entry) => cellMatches(entry.cell, request));
  if (matching.length === 0) return result(request, 'UNKNOWN', 'NO_GRANT');

  const sourcePublisherIds = new Map(snapshot.sourcePublisherIds ?? []);
  if (request.source.publisherId !== null) {
    sourcePublisherIds.set(request.source.id, request.source.publisherId);
  }
  const fieldGroups = snapshot.fieldGroupMembers ?? new Map<string, readonly string[]>();
  const byDecision = new Map(matching.map((entry) => [entry.decision.id, entry]));
  const asOf = timestamp(request.asOf);
  const clearedExceptionIds: string[] = [];
  const blockingDenies: string[] = [];

  for (const deny of matching.filter((entry) => entry.decision.state === 'DENY')) {
    const clearedBy = snapshot.denyExceptions.find((link) => {
      if (link.denyDecisionId !== deny.decision.id || asOf === null) return false;
      const exception = byDecision.get(link.exceptionDecisionId);
      if (exception === undefined) return false;
      if (exception.decision.state !== 'ALLOW' && exception.decision.state !== 'CONDITIONAL') return false;
      if (
        link.evidenceArtifactId === deny.decision.evidenceArtifactId ||
        link.evidenceArtifactId === exception.decision.evidenceArtifactId
      ) {
        return false;
      }
      if (!scopeIsStrictlyNarrower(deny.cell, exception.cell, fieldGroups, sourcePublisherIds)) {
        return false;
      }
      if (!exceptionLinkEffective(link, asOf)) return false;
      return permissionResult(request, exception, options).permitted;
    });
    if (clearedBy === undefined) blockingDenies.push(deny.decision.id);
    else clearedExceptionIds.push(clearedBy.id);
  }

  if (blockingDenies.length > 0) {
    blockingDenies.sort();
    const first = byDecision.get(blockingDenies[0] as string) ?? null;
    return result(request, 'DENY', 'STICKY_DENY', first, {
      blockingDecisionIds: blockingDenies,
      exceptionIds: clearedExceptionIds.sort(),
    });
  }

  const nonDeny = matching.filter((entry) => entry.decision.state !== 'DENY');
  if (nonDeny.length === 0) {
    return result(request, 'UNKNOWN', 'NO_GRANT', null, {
      exceptionIds: clearedExceptionIds.sort(),
    });
  }
  nonDeny.sort((left, right) => compareSpecificity(specificity(left.cell), specificity(right.cell)));
  const mostSpecific = nonDeny[0] as RightsDecisionCandidate;
  const bestSpecificity = specificity(mostSpecific.cell);
  const tied = nonDeny.filter(
    (entry) => compareSpecificity(specificity(entry.cell), bestSpecificity) === 0,
  );
  if (tied.length > 1) {
    return result(request, 'UNKNOWN', 'AMBIGUOUS_SCOPE', null, {
      exceptionIds: clearedExceptionIds.sort(),
    });
  }
  const resolved = permissionResult(request, mostSpecific, options);
  return { ...resolved, exceptionIds: clearedExceptionIds.sort() };
}

/** Authorization is the AND of every provenance contribution. */
export function evaluateContributionRights(
  contributions: readonly RightsContribution[],
  options: RightsEvaluationOptions = {},
): ContributionRightsEvaluation {
  const decisions = contributions.map((contribution) => ({
    requirementId: contribution.requirementId,
    contributionId: contribution.contributionId,
    operation: contribution.request.operation,
    channel: contribution.request.channel,
    decision: evaluateRights(contribution.request, contribution.snapshot, options),
  }));
  if (decisions.length === 0) {
    return { permitted: false, reasonCode: 'MISSING_PROVENANCE', decisions: [] };
  }
  const permitted = decisions.every((entry) => entry.decision.permitted);
  return { permitted, reasonCode: permitted ? 'ALLOW' : 'REQUIREMENT_BLOCKED', decisions };
}

/** Alias that emphasizes both provenance-AND and multi-intent authorization. */
export const authorizeAll = evaluateContributionRights;
