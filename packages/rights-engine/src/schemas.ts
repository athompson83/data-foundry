import { z } from 'zod';
import {
  AcquisitionMethodSchema,
  RIGHTS_CLASSIFICATIONS,
  RightsAssetClassSchema,
  RightsChannelSchema,
  RightsConditionTypeSchema,
  RightsOperationSchema,
  RightsOutputClassSchema,
  RightsReviewerTypeSchema,
  RightsReviewStatusSchema,
  RightsStateSchema,
  RightsTermsActivationStateSchema,
} from '@data-foundry/canonical-schema';

const nonempty = z.string().trim().min(1);
const nullableNonempty = nonempty.nullable();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const RightsSourceGuardSchema = z
  .object({
    id: nonempty,
    publisherId: nullableNonempty,
    status: nonempty,
    rightsClassification: z.enum(RIGHTS_CLASSIFICATIONS),
    killSwitchEngaged: z.boolean(),
    prohibited: z.boolean(),
  })
  .strict();

export const RightsCellSchema = z
  .object({
    id: nonempty,
    publisherId: nullableNonempty,
    sourceId: nullableNonempty,
    acquisitionRoute: AcquisitionMethodSchema.nullable(),
    accountOrProductPlan: nullableNonempty,
    jurisdiction: nullableNonempty,
    assetClass: RightsAssetClassSchema.nullable(),
    fieldKey: nullableNonempty,
    fieldGroupId: nullableNonempty,
    outputClass: RightsOutputClassSchema.nullable(),
    operation: RightsOperationSchema,
    channel: RightsChannelSchema,
  })
  .strict()
  .superRefine((cell, context) => {
    if ((cell.publisherId === null) === (cell.sourceId === null)) {
      context.addIssue({ code: 'custom', message: 'exactly one publisherId/sourceId is required' });
    }
    if (cell.fieldKey !== null && cell.fieldGroupId !== null) {
      context.addIssue({ code: 'custom', message: 'fieldKey and fieldGroupId are mutually exclusive' });
    }
    if ((cell.fieldKey !== null || cell.fieldGroupId !== null) && cell.sourceId === null) {
      context.addIssue({ code: 'custom', message: 'field scopes require sourceId' });
    }
  });

export const RightsDecisionVersionSchema = z
  .object({
    id: nonempty,
    cellId: nonempty,
    state: RightsStateSchema,
    controllingTermsVersionId: nullableNonempty,
    evidenceArtifactId: nullableNonempty,
    clauseRef: nullableNonempty,
    reviewStatus: RightsReviewStatusSchema,
    reviewerType: RightsReviewerTypeSchema,
    reviewedBy: nullableNonempty,
    reviewedAt: nonempty,
    effectiveFrom: nullableNonempty,
    effectiveUntil: nullableNonempty,
    recheckAt: nullableNonempty,
  })
  .strict();

export const RightsTermsBindingSchema = z
  .object({
    version: z
      .object({
        id: nonempty,
        termsCellId: nonempty,
        evidenceArtifactId: nonempty,
        contentSha256: sha256,
        effectiveFrom: nonempty,
        effectiveUntil: nullableNonempty,
        recheckAt: nonempty,
      })
      .strict(),
    scope: z
      .object({
        publisherId: nullableNonempty,
        sourceId: nullableNonempty,
        acquisitionRoute: AcquisitionMethodSchema.nullable(),
        accountOrProductPlan: nullableNonempty,
        jurisdiction: nullableNonempty,
      })
      .strict()
      .superRefine((scope, context) => {
        if ((scope.publisherId === null) === (scope.sourceId === null)) {
          context.addIssue({ code: 'custom', message: 'terms scope needs exactly one subject' });
        }
      }),
    currentVersionId: nullableNonempty,
    activationState: RightsTermsActivationStateSchema.nullable(),
    activationActorType: RightsReviewerTypeSchema.nullable(),
    activationOccurredAt: nullableNonempty,
  })
  .strict();

export const RightsDecisionConditionSchema = z
  .object({
    id: nonempty,
    decisionId: nonempty,
    conditionKey: nonempty,
    conditionType: RightsConditionTypeSchema,
    evaluatorKey: nonempty,
    evaluatorVersion: nonempty,
    parametersSha256: sha256,
    parametersCanonical: nonempty,
    parameters: z.record(z.string(), z.unknown()),
    auditRequired: z.boolean(),
  })
  .strict();

export const RightsDecisionCandidateSchema = z
  .object({
    cell: RightsCellSchema,
    decision: RightsDecisionVersionSchema,
    terms: RightsTermsBindingSchema.nullable(),
    conditions: z.array(RightsDecisionConditionSchema),
    activation: z
      .object({
        decisionId: nonempty,
        cellId: nonempty,
        sequenceNo: z.number().int().positive(),
        actorType: RightsReviewerTypeSchema,
        actor: nonempty,
        occurredAt: nonempty,
      })
      .strict(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.decision.cellId !== candidate.cell.id) {
      context.addIssue({ code: 'custom', message: 'decision.cellId does not match cell.id' });
    }
    if (
      candidate.activation.cellId !== candidate.cell.id ||
      candidate.activation.decisionId !== candidate.decision.id
    ) {
      context.addIssue({ code: 'custom', message: 'activation does not match candidate' });
    }
    for (const condition of candidate.conditions) {
      if (condition.decisionId !== candidate.decision.id) {
        context.addIssue({ code: 'custom', message: 'condition does not match decision' });
      }
    }
  });

export const RightsDenyExceptionSchema = z
  .object({
    id: nonempty,
    denyDecisionId: nonempty,
    exceptionDecisionId: nonempty,
    evidenceArtifactId: nonempty,
    clauseRef: nonempty,
    reviewerType: z.enum(['HUMAN', 'COUNSEL']),
    reviewedBy: nonempty,
    reviewedAt: nonempty,
    effectiveFrom: nonempty,
    effectiveUntil: nullableNonempty,
    recheckAt: nonempty,
  })
  .strict();

export const RightsSnapshotSchema = z
  .object({
    candidates: z.array(RightsDecisionCandidateSchema),
    denyExceptions: z.array(RightsDenyExceptionSchema),
    sourcePublisherIds: z.map(z.string(), z.string()).optional(),
    fieldGroupMembers: z.map(z.string(), z.array(z.string())).optional(),
  })
  .strict();

export const RightsEvaluationRequestSchema = z
  .object({
    source: RightsSourceGuardSchema,
    sourceStatusRequirement: z.enum(['ACTIVE', 'APPROVED_OR_ACTIVE']),
    acquisitionRoute: AcquisitionMethodSchema.nullable(),
    accountOrProductPlan: nullableNonempty,
    jurisdiction: nullableNonempty,
    assetClass: RightsAssetClassSchema,
    fieldKey: nullableNonempty,
    fieldGroupIds: z.array(nonempty),
    outputClass: RightsOutputClassSchema,
    operation: RightsOperationSchema,
    channel: RightsChannelSchema,
    asOf: nonempty,
    conditionReceipts: z.array(
      z
        .object({
          conditionId: nonempty,
          evaluatorKey: nonempty,
          evaluatorVersion: nonempty,
          parametersSha256: sha256,
          parametersCanonical: nonempty,
          satisfied: z.boolean(),
          auditRef: nullableNonempty,
          evaluatedAt: nonempty,
          validUntil: nonempty,
        })
        .strict(),
    ),
  })
  .strict();

export function rightsInputsAreValid(request: unknown, snapshot: unknown): boolean {
  return (
    RightsEvaluationRequestSchema.safeParse(request).success &&
    RightsSnapshotSchema.safeParse(snapshot).success
  );
}
