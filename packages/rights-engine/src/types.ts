import type {
  AcquisitionMethod,
  RightsAssetClass,
  RightsChannel,
  RightsClassification,
  RightsConditionType,
  RightsOperation,
  RightsOutputClass,
  RightsReviewerType,
  RightsReviewStatus,
  RightsState,
  RightsTermsActivationState,
} from '@data-foundry/canonical-schema';

export type {
  RightsAssetClass,
  RightsChannel,
  RightsClassification,
  RightsConditionType,
  RightsOperation,
  RightsOutputClass,
  RightsReviewerType,
  RightsReviewStatus,
  RightsState,
  RightsTermsActivationState,
};
export type RightsAcquisitionRoute = AcquisitionMethod;

export interface RightsSourceGuard {
  readonly id: string;
  readonly publisherId: string | null;
  readonly status: string;
  readonly rightsClassification: RightsClassification;
  readonly killSwitchEngaged: boolean;
  readonly prohibited: boolean;
}

export interface RightsCell {
  readonly id: string;
  readonly publisherId: string | null;
  readonly sourceId: string | null;
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: RightsAssetClass | null;
  readonly fieldKey: string | null;
  readonly fieldGroupId: string | null;
  readonly outputClass: RightsOutputClass | null;
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
}

export interface RightsDecisionVersion {
  readonly id: string;
  readonly cellId: string;
  readonly state: RightsState;
  readonly controllingTermsVersionId: string | null;
  readonly evidenceArtifactId: string | null;
  readonly clauseRef: string | null;
  readonly reviewStatus: RightsReviewStatus;
  readonly reviewerType: RightsReviewerType;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
  readonly recheckAt: string | null;
}

export interface RightsTermsVersion {
  readonly id: string;
  readonly termsCellId: string;
  readonly evidenceArtifactId: string;
  readonly contentSha256: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly recheckAt: string;
}

export interface RightsTermsScope {
  readonly publisherId: string | null;
  readonly sourceId: string | null;
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
}

export interface RightsTermsBinding {
  readonly version: RightsTermsVersion;
  readonly scope: RightsTermsScope;
  readonly currentVersionId: string | null;
  readonly activationState: RightsTermsActivationState | null;
  readonly activationActorType: RightsReviewerType | null;
  readonly activationOccurredAt: string | null;
}

export interface RightsDecisionCondition {
  readonly id: string;
  readonly decisionId: string;
  readonly conditionKey: string;
  readonly conditionType: RightsConditionType;
  readonly evaluatorKey: string;
  readonly evaluatorVersion: string;
  readonly parametersSha256: string;
  readonly parametersCanonical: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly auditRequired: boolean;
}

export interface RightsDecisionCandidate {
  readonly cell: RightsCell;
  readonly decision: RightsDecisionVersion;
  readonly terms: RightsTermsBinding | null;
  readonly conditions: readonly RightsDecisionCondition[];
  readonly activation: {
    readonly decisionId: string;
    readonly cellId: string;
    readonly sequenceNo: number;
    readonly actorType: RightsReviewerType;
    readonly actor: string;
    readonly occurredAt: string;
  };
}

export interface RightsDenyException {
  readonly id: string;
  readonly denyDecisionId: string;
  readonly exceptionDecisionId: string;
  readonly evidenceArtifactId: string;
  readonly clauseRef: string;
  readonly reviewerType: Extract<RightsReviewerType, 'HUMAN' | 'COUNSEL'>;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly recheckAt: string;
}

export interface RightsSnapshot {
  /** Current decision candidates only. Historical versions must not be supplied. */
  readonly candidates: readonly RightsDecisionCandidate[];
  readonly denyExceptions: readonly RightsDenyException[];
  /** source id -> publisher id, used to prove publisher-to-source exception narrowing. */
  readonly sourcePublisherIds?: ReadonlyMap<string, string>;
  /** field group id -> member field keys. Groups are non-overlapping in storage. */
  readonly fieldGroupMembers?: ReadonlyMap<string, readonly string[]>;
}

export interface RightsConditionReceipt {
  readonly conditionId: string;
  readonly evaluatorKey: string;
  readonly evaluatorVersion: string;
  readonly parametersSha256: string;
  /** Exact canonical parameters the trusted evaluator consumed. */
  readonly parametersCanonical: string;
  readonly satisfied: boolean;
  readonly auditRef: string | null;
  readonly evaluatedAt: string;
  readonly validUntil: string;
}

export interface RightsEvaluationRequest {
  readonly source: RightsSourceGuard;
  readonly sourceStatusRequirement: 'ACTIVE' | 'APPROVED_OR_ACTIVE';
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: RightsAssetClass;
  readonly fieldKey: string | null;
  readonly fieldGroupIds: readonly string[];
  readonly outputClass: RightsOutputClass;
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
  readonly asOf: string;
  /** Trusted server-computed receipts only; never populate this from client input. */
  readonly conditionReceipts: readonly RightsConditionReceipt[];
}

export const RIGHTS_REASON_CODES = [
  'ALLOW',
  'CONDITIONAL_ALLOW',
  'NO_GRANT',
  'EXPLICIT_UNKNOWN',
  'MISSING_PROVENANCE',
  'MALFORMED_SNAPSHOT',
  'SOURCE_PROHIBITED',
  'KILL_SWITCH_ENGAGED',
  'SOURCE_STATUS_BLOCKED',
  'RIGHTS_CLASSIFICATION_BLOCKED',
  'PUBLISHER_UNMAPPED',
  'STICKY_DENY',
  'AMBIGUOUS_SCOPE',
  'NOT_APPLICABLE',
  'TERMS_MISSING',
  'TERMS_NOT_CURRENT',
  'TERMS_REVOKED',
  'TERMS_NOT_EFFECTIVE',
  'TERMS_VERSION_INVALID',
  'TERMS_SCOPE_MISMATCH',
  'DECISION_NOT_EFFECTIVE',
  'REVIEW_DUE',
  'AUTOMATED_PERMISSION',
  'PERMISSION_REVIEW_INVALID',
  'CONDITION_MISSING',
  'UNKNOWN_CONDITION_EVALUATOR',
  'CONDITION_UNMET',
  'CONDITION_AUDIT_MISSING',
  'CONDITION_RECEIPT_INVALID',
  'CONDITION_RECEIPT_STALE',
  'ACTIVATION_INVALID',
] as const;
export type RightsReasonCode = (typeof RIGHTS_REASON_CODES)[number];

export interface RightsObligation {
  readonly conditionKey: string;
  readonly conditionType: RightsConditionType;
  readonly evaluatorKey: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly auditRef: string | null;
}

export interface RightsEvaluation {
  readonly permitted: boolean;
  readonly state: RightsState;
  readonly reasonCode: RightsReasonCode;
  readonly cellId: string | null;
  readonly decisionId: string | null;
  readonly blockingDecisionIds: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly unmetConditions: readonly string[];
  readonly obligations: readonly RightsObligation[];
  readonly termsVersionId: string | null;
  readonly evaluatedAt: string;
}

export interface RightsEvaluationOptions {
  readonly trustedConditionEvaluators?: readonly string[];
}

export interface RightsContribution {
  readonly requirementId: string;
  readonly contributionId: string;
  readonly request: RightsEvaluationRequest;
  readonly snapshot: RightsSnapshot;
}

export interface ContributionDecision {
  readonly requirementId: string;
  readonly contributionId: string;
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
  readonly decision: RightsEvaluation;
}

export interface ContributionRightsEvaluation {
  readonly permitted: boolean;
  readonly reasonCode: 'ALLOW' | 'MISSING_PROVENANCE' | 'REQUIREMENT_BLOCKED';
  readonly decisions: readonly ContributionDecision[];
}
