import type {
  AcquisitionMethod,
  RightsAssetClass,
  RightsOutputClass,
  SourceId,
} from '@data-foundry/canonical-schema';
import {
  loadStoredRightsContext,
  type ScheduledRightsReceipt,
  type ScheduledRightsReceiptStage,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  evaluateRights,
  type RightsEvaluation,
} from '@data-foundry/rights-engine';
import type { RefreshAdmission } from '@data-foundry/acquisition';

export interface StoredAcquisitionScope {
  readonly sourceId: SourceId;
  readonly sourceKey: string;
  readonly targetId: string;
  readonly targetUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: RightsAssetClass;
  readonly outputClass: RightsOutputClass;
  /** Database-derived digest returned by the immutable scheduled claim. */
  readonly rightsScopeDigest: string;
}

declare const capabilityBrand: unique symbol;
/** Runtime-opaque: only this module can register an object in CAPABILITIES. */
export interface StoredAcquisitionCapability {
  readonly [capabilityBrand]: never;
}

const CAPABILITIES = new WeakMap<object, StoredAcquisitionScope>();
const OPERATIONS = ['ACQUIRE', 'STORE', 'CACHE'] as const;

export class StoredAcquisitionRefusal extends Error {
  readonly receipt: ScheduledRightsReceipt;

  constructor(receipt: ScheduledRightsReceipt) {
    super('Stored ACQUIRE/STORE/CACHE rights refused for the scheduled target.');
    this.name = 'StoredAcquisitionRefusal';
    this.receipt = receipt;
  }
}

function receiptFor(
  stage: ScheduledRightsReceiptStage,
  asOf: string,
  scope: StoredAcquisitionScope,
  decisions: readonly RightsEvaluation[],
): ScheduledRightsReceipt {
  return {
    stage,
    basis: decisions.every((decision) => decision.permitted) ? 'ADMITTED' : 'RIGHTS_REFUSED',
    scopeDigest: scope.rightsScopeDigest,
    evaluatedAt: new Date(asOf).toISOString() as ScheduledRightsReceipt['evaluatedAt'],
    decisions: OPERATIONS.map((operation, index) => {
      const decision = decisions[index];
      if (decision === undefined) throw new Error('stored rights evaluation is incomplete');
      return {
        operation,
        permitted: decision.permitted,
        state: decision.state,
        reasonCode: decision.reasonCode,
        cellId: decision.cellId,
        decisionId: decision.decisionId,
        termsVersionId: decision.termsVersionId,
      };
    }),
  };
}

async function evaluateStored(
  driver: SqlDriver,
  scope: StoredAcquisitionScope,
  asOf: string,
  stage: ScheduledRightsReceiptStage,
): Promise<ScheduledRightsReceipt> {
  const context = await loadStoredRightsContext(driver, scope.sourceId, asOf);
  const decisions: RightsEvaluation[] = [];
  for (const operation of OPERATIONS) {
    if (context === null) {
      decisions.push({
        permitted: false,
        state: 'UNKNOWN',
        reasonCode: 'NO_GRANT',
        cellId: null,
        decisionId: null,
        blockingDecisionIds: [],
        exceptionIds: [],
        unmetConditions: [],
        obligations: [],
        termsVersionId: null,
        evaluatedAt: asOf,
      });
      continue;
    }
    decisions.push(
      evaluateRights(
        {
          source: context.source,
          sourceStatusRequirement: 'ACTIVE',
          acquisitionRoute: scope.acquisitionRoute,
          accountOrProductPlan: scope.accountOrProductPlan,
          jurisdiction: scope.jurisdiction,
          assetClass: scope.assetClass,
          fieldKey: null,
          fieldGroupIds: [],
          outputClass: scope.outputClass,
          operation,
          channel: 'INTERNAL_PROCESSING',
          asOf,
          conditionReceipts: [],
        },
        context.snapshot,
      ),
    );
  }
  return receiptFor(stage, asOf, scope, decisions);
}

export async function authorizeStoredAcquisition(
  driver: SqlDriver,
  scope: StoredAcquisitionScope,
  asOf: string,
  stage: Extract<ScheduledRightsReceiptStage, 'INITIAL'> = 'INITIAL',
): Promise<{
  readonly capability: StoredAcquisitionCapability;
  readonly receipt: ScheduledRightsReceipt;
}> {
  const receipt = await evaluateStored(driver, scope, asOf, stage);
  if (!receipt.decisions.every((decision) => decision.permitted)) {
    throw new StoredAcquisitionRefusal(receipt);
  }
  const capability = Object.freeze({}) as StoredAcquisitionCapability;
  CAPABILITIES.set(capability as object, Object.freeze({ ...scope }));
  return { capability, receipt };
}

export async function recheckStoredAcquisition(
  capability: StoredAcquisitionCapability,
  driver: SqlDriver,
  asOf: string,
  stage: Exclude<ScheduledRightsReceiptStage, 'INITIAL'>,
): Promise<ScheduledRightsReceipt> {
  const scope = CAPABILITIES.get(capability as object);
  if (scope === undefined) throw new Error('A trusted acquisition capability is required.');
  const receipt = await evaluateStored(driver, scope, asOf, stage);
  if (!receipt.decisions.every((decision) => decision.permitted)) {
    throw new StoredAcquisitionRefusal(receipt);
  }
  return receipt;
}

/** Convert an opaque capability into the pure planner's exact structural view. */
export function plannerAdmission(
  capability: StoredAcquisitionCapability,
  receipt: ScheduledRightsReceipt,
): RefreshAdmission {
  const scope = CAPABILITIES.get(capability as object);
  if (scope === undefined) throw new Error('A trusted acquisition capability is required.');
  return {
    sourceId: scope.sourceId,
    sourceKey: scope.sourceKey,
    targetId: scope.targetId,
    targetUrl: scope.targetUrl,
    acquisitionRoute: scope.acquisitionRoute,
    accountOrProductPlan: scope.accountOrProductPlan,
    jurisdiction: scope.jurisdiction,
    channel: 'INTERNAL_PROCESSING',
    assetClass: scope.assetClass as RefreshAdmission['assetClass'],
    outputClass: scope.outputClass as RefreshAdmission['outputClass'],
    fieldKey: null,
    evaluatedAt: receipt.evaluatedAt,
    decisions: {
      ACQUIRE: receipt.decisions.find(({ operation }) => operation === 'ACQUIRE')!,
      STORE: receipt.decisions.find(({ operation }) => operation === 'STORE')!,
      CACHE: receipt.decisions.find(({ operation }) => operation === 'CACHE')!,
    },
  };
}
