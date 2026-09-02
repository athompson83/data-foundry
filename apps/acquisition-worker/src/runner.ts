import {
  AcquisitionRefusedError,
  ArtifactStoreError,
  ProviderTransportError,
  SqlPolicySnapshotRecorder,
  planRefresh,
  sha256Hex,
  stableStringify,
  systemClock,
  type AcquisitionProvider,
  type AcquisitionProviderDeps,
  type AcquisitionRuntime,
  type AcquisitionRuntimeTarget,
  type ArtifactStore,
  type Clock,
  type FetchLike,
} from '@data-foundry/acquisition';
import {
  SCHEDULED_ACQUISITION_PROVIDERS,
  ScheduledAcquisitionClaimOwnershipError,
  createCanonicalStore,
  createScheduledAcquisitionStore,
  type ScheduledAcquisitionFreshnessScope,
  type ScheduledAcquisitionProvider,
  type ScheduledAcquisitionRun,
  type ScheduledAcquisitionRunObservation,
  type ScheduledAcquisitionValidators,
  type ScheduledRightsReceipt,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  InMemorySourceRegistry,
  toSourceInsert,
  type SourceRegistryEntry,
} from '@data-foundry/source-registry';
import {
  StoredAcquisitionRefusal,
  authorizeStoredAcquisition,
  plannerAdmission,
  recheckStoredAcquisition,
  type StoredAcquisitionCapability,
} from './admission.js';
import type { AcquisitionWorkerEnv } from './env.js';
import { createScheduledProvider, providerMethodsFor } from './providers.js';
import {
  ScheduledResultManifestError,
  classifyScheduledResult,
} from './result-policy.js';

export type ScheduledExecutionDisposition =
  | 'DUPLICATE'
  | 'SUCCEEDED'
  | 'SKIPPED'
  | 'REFUSED'
  | 'FAILED';

export interface ScheduledTargetExecution {
  readonly targetId: string;
  readonly disposition: ScheduledExecutionDisposition;
  readonly runId: string | null;
}

export interface ScheduledAcquisitionResult {
  readonly verticalSlug: string;
  readonly scheduledFor: string;
  readonly executions: readonly ScheduledTargetExecution[];
}

export interface RunScheduledAcquisitionInput {
  readonly driver: SqlDriver;
  readonly runtime: AcquisitionRuntime;
  readonly scheduledFor: string;
  readonly artifactStore: ArtifactStore;
  readonly env: AcquisitionWorkerEnv;
  readonly clock?: Clock | undefined;
  readonly fetch?: FetchLike | undefined;
}

export class ScheduledAcquisitionClaimBusyError extends Error {
  constructor() {
    super('A scheduled acquisition slot still has an active claim owner; retry after its lease.');
    this.name = 'ScheduledAcquisitionClaimBusyError';
  }
}

interface AdmittedClaim {
  readonly target: AcquisitionRuntimeTarget;
  readonly run: ScheduledAcquisitionRun;
  readonly capability: StoredAcquisitionCapability;
  readonly initialReceipt: ScheduledRightsReceipt;
  readonly latest: ScheduledAcquisitionRunObservation | null;
}

const asProvider = (id: string): ScheduledAcquisitionProvider | null =>
  (SCHEDULED_ACQUISITION_PROVIDERS as readonly string[]).includes(id)
    ? (id as ScheduledAcquisitionProvider)
    : null;

function exactRuntimeSources(runtime: AcquisitionRuntime): readonly SourceRegistryEntry[] {
  if (runtime.targets.length === 0) throw new Error('The acquisition runtime has no targets.');
  const byKey = new Map<string, SourceRegistryEntry>();
  for (const target of runtime.targets) {
    if (target.source.vertical_slug !== runtime.vertical_slug) {
      throw new Error('The acquisition runtime crosses a vertical boundary.');
    }
    const prior = byKey.get(target.source.key);
    if (prior !== undefined && stableStringify(prior) !== stableStringify(target.source)) {
      throw new Error('The acquisition runtime contains conflicting source declarations.');
    }
    byKey.set(target.source.key, target.source);
  }
  return [...byKey.values()];
}

function freshnessScope(
  target: AcquisitionRuntimeTarget,
  sourceId: ScheduledAcquisitionRun['sourceId'],
  runtimeDigest: string,
): ScheduledAcquisitionFreshnessScope {
  return {
    sourceId,
    targetId: target.target_id,
    targetUrl: target.target_url,
    acquisitionRoute: target.source.acquisition_policy.method,
    accountOrProductPlan: target.source.acquisition_policy.account_or_product_plan,
    jurisdiction: target.source.acquisition_policy.jurisdiction,
    assetClass: target.asset_class,
    outputClass: target.output_class,
    resultUrlPolicy: target.result_url_policy,
    runtimeDigest,
  };
}

function idempotencyKey(runtime: AcquisitionRuntime, target: AcquisitionRuntimeTarget, slot: string) {
  return `scheduled-acquisition-v1:${sha256Hex(
    stableStringify({
      verticalSlug: runtime.vertical_slug,
      targetId: target.target_id,
      scheduledFor: slot,
      runtimeDigest: runtime.runtime_digest,
    }),
  )}`;
}

const atOrAfter = (
  candidate: string,
  ...floors: readonly string[]
): ScheduledAcquisitionRun['claimedAt'] => new Date(Math.max(
  Date.parse(candidate),
  ...floors.map((value) => Date.parse(value)),
)).toISOString() as ScheduledAcquisitionRun['claimedAt'];

const observedAt = async (
  driver: SqlDriver,
  ...floors: readonly string[]
): Promise<ScheduledAcquisitionRun['claimedAt']> => {
  const rows = await driver.query<{ acquisition_observed_at: string }>(
    `SELECT statement_timestamp()::text AS acquisition_observed_at`,
  );
  const databaseTime = rows[0]?.acquisition_observed_at;
  if (databaseTime === undefined) {
    throw new Error('PostgreSQL did not return the acquisition observation time.');
  }
  return atOrAfter(databaseTime, ...floors);
};

const scheduledValidators = (
  value: Readonly<{ etag?: string | undefined; lastModified?: string | undefined; contentHash?: string | undefined }>,
): ScheduledAcquisitionValidators => ({
  ...(value.etag === undefined ? {} : { etag: value.etag }),
  ...(value.lastModified === undefined ? {} : { lastModified: value.lastModified }),
  ...(value.contentHash === undefined ? {} : { contentHash: value.contentHash }),
});

/**
 * Execute one durable Cron slot. Claim rows are created before admission so
 * refusals are auditable, while the opaque capability never crosses this
 * composition root.
 */
export async function runScheduledAcquisition(
  input: RunScheduledAcquisitionInput,
): Promise<ScheduledAcquisitionResult> {
  const clock = input.clock ?? systemClock;
  const slot = new Date(input.scheduledFor).toISOString();
  if (slot !== input.scheduledFor) {
    throw new Error('scheduledFor must be a canonical UTC ISO timestamp.');
  }
  const sources = exactRuntimeSources(input.runtime);
  const canonical = createCanonicalStore(input.driver);
  const firstSource = sources[0];
  if (firstSource === undefined) throw new Error('The acquisition runtime has no sources.');
  const vertical = await canonical.registerVertical({
    slug: firstSource.vertical_slug,
    name: input.runtime.vertical_name,
    schema_version: input.runtime.vertical_schema_version,
    status: input.runtime.vertical_status,
    default_refresh_policy: input.runtime.default_refresh_policy,
  });

  // Monotone synchronization lives in canonical-store.registerSource: explicit
  // bundled TRUE can engage a stop; neither bundled value may clear stored TRUE.
  const sourceIds = new Map<string, ScheduledAcquisitionRun['sourceId']>();
  for (const entry of sources) {
    const source = await canonical.registerSource(toSourceInsert(entry, vertical.id));
    sourceIds.set(entry.key, source.id);
  }

  const store = createScheduledAcquisitionStore(input.driver);
  const registry = new InMemorySourceRegistry(sources);
  const executions: ScheduledTargetExecution[] = [];
  const claimed: { target: AcquisitionRuntimeTarget; run: ScheduledAcquisitionRun }[] = [];
  let activeClaims = 0;
  try {
  for (const target of input.runtime.targets) {
    const sourceId = sourceIds.get(target.source.key);
    if (sourceId === undefined) throw new Error('A runtime target has no synchronized source.');
    const acquisition = await store.acquire({
      idempotencyKey: idempotencyKey(input.runtime, target, slot),
      verticalSlug: input.runtime.vertical_slug,
      sourceId,
      sourceKey: target.source.key,
      targetId: target.target_id,
      targetUrl: target.target_url,
      acquisitionRoute: target.source.acquisition_policy.method,
      accountOrProductPlan: target.source.acquisition_policy.account_or_product_plan,
      jurisdiction: target.source.acquisition_policy.jurisdiction,
      assetClass: target.asset_class,
      outputClass: target.output_class,
      resultUrlPolicy: target.result_url_policy,
      scheduledFor: slot as ScheduledAcquisitionRun['scheduledFor'],
      runtimeDigest: input.runtime.runtime_digest,
    });
    if (acquisition.disposition === 'TERMINAL') {
      executions.push({ targetId: target.target_id, disposition: 'DUPLICATE', runId: null });
    } else if (acquisition.disposition === 'ACTIVE') {
      activeClaims += 1;
    } else {
      claimed.push({ target, run: acquisition.run });
    }
  }

  const rightsAsOf = await observedAt(
    input.driver,
    ...claimed.map(({ run }) => run.claimLeaseAcquiredAt),
  );
  const plannerAsOf = atOrAfter(slot, rightsAsOf);
  const admitted: AdmittedClaim[] = [];
  for (const item of claimed) {
    const scope = {
      sourceId: item.run.sourceId,
      sourceKey: item.run.sourceKey,
      targetId: item.run.targetId,
      targetUrl: item.run.targetUrl,
      acquisitionRoute: item.run.acquisitionRoute,
      accountOrProductPlan: item.run.accountOrProductPlan,
      jurisdiction: item.run.jurisdiction,
      assetClass: item.run.assetClass,
      outputClass: item.run.outputClass,
      rightsScopeDigest: item.run.rightsScopeDigest,
    } as const;
    try {
      const authorization = await authorizeStoredAcquisition(
        input.driver,
        scope,
        rightsAsOf,
      );
      admitted.push({
        ...item,
        capability: authorization.capability,
        initialReceipt: authorization.receipt,
        latest: await store.latestSuccess(
          freshnessScope(item.target, item.run.sourceId, input.runtime.runtime_digest),
        ),
      });
    } catch (error) {
      if (!(error instanceof StoredAcquisitionRefusal)) throw error;
      await store.fail({
        runId: item.run.id,
        claimToken: item.run.claimToken,
        status: 'REFUSED',
        outcome: null,
        failureCode: 'RIGHTS_REFUSED',
        completedAt: await observedAt(
          input.driver,
          item.run.claimLeaseAcquiredAt,
          error.receipt.evaluatedAt,
        ),
        rightsReceipt: [error.receipt],
      });
      executions.push({
        targetId: item.target.target_id,
        disposition: 'REFUSED',
        runId: item.run.id,
      });
    }
  }

  const decisions = planRefresh({
    candidates: admitted.map((item) => ({
      entry: item.target.source,
      sourceId: item.run.sourceId,
      targetId: item.target.target_id,
      targetUrl: item.target.target_url,
      assetClass: item.target.asset_class,
      outputClass: item.target.output_class,
      providerMethods: providerMethodsFor(item.target.source.acquisition_policy.method),
      admission: plannerAdmission(item.capability, item.initialReceipt),
      lastAcquiredAt: item.latest?.freshAt ?? null,
    })),
    policy: input.runtime.default_refresh_policy,
    rightsAsOf,
    now: plannerAsOf,
  });

  const byTarget = new Map(admitted.map((item) => [item.target.target_id, item]));
  for (const decision of decisions) {
    const item = byTarget.get(decision.targetId);
    if (item === undefined) throw new Error('Planner returned an undeclared target.');
    if (!decision.due) {
      await store.fail({
        runId: item.run.id,
        claimToken: item.run.claimToken,
        status: 'SKIPPED',
        outcome: null,
        failureCode: 'NOT_DUE',
        completedAt: await observedAt(
          input.driver,
          item.run.claimLeaseAcquiredAt,
          item.initialReceipt.evaluatedAt,
        ),
        rightsReceipt: [{ ...item.initialReceipt, basis: 'NOT_DUE' }],
      });
      executions.push({
        targetId: item.target.target_id,
        disposition: 'SKIPPED',
        runId: item.run.id,
      });
      continue;
    }
    const disposition = await executeClaim({ ...input, clock, registry, store, item });
    executions.push({ targetId: item.target.target_id, disposition, runId: item.run.id });
  }

  const targetOrder = new Map(input.runtime.targets.map((target, index) => [target.target_id, index]));
  executions.sort(
    (left, right) =>
      (targetOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) -
      (targetOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER),
  );
  if (activeClaims > 0) throw new ScheduledAcquisitionClaimBusyError();
  return {
    verticalSlug: input.runtime.vertical_slug,
    scheduledFor: slot,
    executions,
  };
  } catch (error) {
    await Promise.allSettled(claimed.map(({ run }) => store.release({
      runId: run.id,
      claimToken: run.claimToken,
      reason: 'UNEXPECTED_ERROR',
    })));
    throw error;
  }
}

async function executeClaim(
  input: RunScheduledAcquisitionInput & {
    readonly clock: Clock;
    readonly registry: InMemorySourceRegistry;
    readonly store: ReturnType<typeof createScheduledAcquisitionStore>;
    readonly item: AdmittedClaim;
  },
): Promise<Exclude<ScheduledExecutionDisposition, 'DUPLICATE' | 'SKIPPED'>> {
  const { item, clock, store } = input;
  const receipts: ScheduledRightsReceipt[] = [item.initialReceipt];
  try {
    receipts.push(
      await recheckStoredAcquisition(
        item.capability,
        input.driver,
        await observedAt(
          input.driver,
          item.run.claimLeaseAcquiredAt,
          ...receipts.map(({ evaluatedAt }) => evaluatedAt),
        ),
        'PRE_PROVIDER',
      ),
    );
    await store.assertLease(item.run.id, item.run.claimToken);
  } catch (error) {
    if (!(error instanceof StoredAcquisitionRefusal)) throw error;
    receipts.push(error.receipt);
    await store.fail({
      runId: item.run.id,
      claimToken: item.run.claimToken,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'RIGHTS_REFUSED',
      completedAt: await observedAt(
        input.driver,
        item.run.claimLeaseAcquiredAt,
        ...receipts.map(({ evaluatedAt }) => evaluatedAt),
      ),
      rightsReceipt: receipts,
    });
    return 'REFUSED';
  }

  let preTransportReceipt: ScheduledRightsReceipt | null = null;
  let prePersistenceReceipt: ScheduledRightsReceipt | null = null;
  let prePersistenceChecks = 0;
  let ledgerPersistenceStarted = false;
  const deps: AcquisitionProviderDeps = {
    registry: input.registry,
    artifactStore: input.artifactStore,
    policyRecorder: new SqlPolicySnapshotRecorder(input.driver),
    clock,
    beforeTransport: async () => {
      try {
        preTransportReceipt = await recheckStoredAcquisition(
          item.capability,
          input.driver,
          await observedAt(
            input.driver,
            item.run.claimLeaseAcquiredAt,
            ...receipts.map(({ evaluatedAt }) => evaluatedAt),
          ),
          'PRE_TRANSPORT',
        );
        await store.assertLease(item.run.id, item.run.claimToken);
      } catch (error) {
        if (error instanceof StoredAcquisitionRefusal) preTransportReceipt = error.receipt;
        throw error;
      }
    },
    beforePersistence: async () => {
      prePersistenceChecks += 1;
      if (prePersistenceChecks !== 1) {
        throw new Error('The provider invoked the pre-persistence recheck more than once.');
      }
      try {
        prePersistenceReceipt = await recheckStoredAcquisition(
          item.capability,
          input.driver,
          await observedAt(
            input.driver,
            item.run.claimLeaseAcquiredAt,
            preTransportReceipt?.evaluatedAt ?? item.initialReceipt.evaluatedAt,
          ),
          'PRE_PERSISTENCE',
        );
        // BaseAcquisitionProvider invokes this hook after complete manifest
        // preflight and immediately before the first R2 write.
        await store.assertLease(item.run.id, item.run.claimToken);
      } catch (error) {
        if (error instanceof StoredAcquisitionRefusal) prePersistenceReceipt = error.receipt;
        throw error;
      }
    },
  };

  let provider: AcquisitionProvider;
  try {
    provider = createScheduledProvider({
      entry: item.target.source,
      ...(item.target.max_direct_http_response_bytes === undefined
        ? {}
        : { maxBytes: item.target.max_direct_http_response_bytes }),
      deps,
      env: input.env,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
  } catch {
    await store.fail({
      runId: item.run.id,
      claimToken: item.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'PROVIDER_CONFIGURATION',
      completedAt: await observedAt(
        input.driver,
        item.run.claimLeaseAcquiredAt,
        ...receipts.map(({ evaluatedAt }) => evaluatedAt),
      ),
      rightsReceipt: receipts,
      provider: null,
    });
    return 'FAILED';
  }
  const providerId = asProvider(provider.id);
  if (providerId === null) {
    await store.fail({
      runId: item.run.id,
      claimToken: item.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'PROVIDER_UNAVAILABLE',
      completedAt: await observedAt(
        input.driver,
        item.run.claimLeaseAcquiredAt,
        ...receipts.map(({ evaluatedAt }) => evaluatedAt),
      ),
      rightsReceipt: receipts,
      provider: null,
    });
    return 'FAILED';
  }

  try {
    const result = await provider.fetch({
      sourceId: item.run.sourceId,
      sourceKey: item.run.sourceKey,
      verticalSlug: item.run.verticalSlug,
      url: item.run.targetUrl,
      retrievalScopeId: item.run.id,
      resultUrlPolicy: item.target.result_url_policy,
      ...(item.target.max_direct_http_response_bytes === undefined
        ? {}
        : { maxBytes: item.target.max_direct_http_response_bytes }),
      ...(item.latest === null ? {} : { conditional: item.latest.validators }),
    });
    if (preTransportReceipt === null) {
      throw new Error('The provider returned without the mandatory pre-transport recheck.');
    }
    receipts.push(preTransportReceipt);
    if (result.provider !== providerId) {
      throw new Error('The provider result identity does not match the selected provider.');
    }
    if (result.outcome === 'EMPTY') {
      await store.fail({
        runId: item.run.id,
        claimToken: item.run.claimToken,
        status: 'FAILED',
        outcome: 'EMPTY',
        failureCode: 'EMPTY_RESPONSE',
        completedAt: await observedAt(
          input.driver,
          item.run.claimLeaseAcquiredAt,
          ...receipts.map(({ evaluatedAt }) => evaluatedAt),
        ),
        rightsReceipt: receipts,
        provider: providerId,
      });
      return 'FAILED';
    }
    if (prePersistenceChecks !== 1 || prePersistenceReceipt === null) {
      throw new Error('The provider returned success without the mandatory pre-persistence recheck.');
    }
    receipts.push(prePersistenceReceipt);
    if (result.artifacts.length !== result.stored.length) {
      throw new Error('The provider returned an incomplete artifact/retrieval association.');
    }
    const artifacts = result.artifacts.map((artifact, index) => {
      const stored = result.stored[index];
      if (stored === undefined) throw new Error('A provider artifact has no retrieval record.');
      return {
        artifact,
        retrievalKey: stored.retrievalKey,
        resultRelation: classifyScheduledResult(item.target, artifact.url),
      } as const;
    });
    ledgerPersistenceStarted = true;
    const finishedAt = await observedAt(
      input.driver,
      item.run.claimLeaseAcquiredAt,
      ...receipts.map(({ evaluatedAt }) => evaluatedAt),
    );
    const freshAt = new Date(Math.min(
      Date.parse(finishedAt),
      Math.max(Date.parse(item.run.claimLeaseAcquiredAt), Date.parse(result.fetchedAt)),
    )).toISOString() as ScheduledAcquisitionRun['claimedAt'];
    await store.complete({
      runId: item.run.id,
      claimToken: item.run.claimToken,
      outcome: result.outcome,
      completedAt: finishedAt,
      freshAt,
      provider: providerId,
      validators: scheduledValidators(result.validators),
      rightsReceipt: receipts,
      artifacts,
    });
    return 'SUCCEEDED';
  } catch (error) {
    if (error instanceof ScheduledAcquisitionClaimOwnershipError) throw error;
    if (error instanceof StoredAcquisitionRefusal) {
      if (preTransportReceipt !== null && !receipts.some(({ stage }) => stage === 'PRE_TRANSPORT')) {
        receipts.push(preTransportReceipt);
      }
      if (
        prePersistenceReceipt !== null &&
        !receipts.some(({ stage }) => stage === 'PRE_PERSISTENCE')
      ) {
        receipts.push(prePersistenceReceipt);
      }
      await store.fail({
        runId: item.run.id,
        claimToken: item.run.claimToken,
        status: 'REFUSED',
        outcome: null,
        failureCode: 'RIGHTS_REFUSED',
        completedAt: await observedAt(
          input.driver,
          item.run.claimLeaseAcquiredAt,
          ...receipts.map(({ evaluatedAt }) => evaluatedAt),
        ),
        rightsReceipt: receipts,
      });
      return 'REFUSED';
    }
    if (preTransportReceipt !== null && receipts.length === 2) receipts.push(preTransportReceipt);
    if (
      prePersistenceReceipt !== null &&
      !receipts.some(({ stage }) => stage === 'PRE_PERSISTENCE')
    ) {
      receipts.push(prePersistenceReceipt);
    }
    const failureCode =
      error instanceof ArtifactStoreError || ledgerPersistenceStarted
        ? 'PERSISTENCE_FAILED'
        : error instanceof ScheduledResultManifestError ||
            error instanceof ProviderTransportError ||
            error instanceof AcquisitionRefusedError
          ? 'TRANSPORT_FAILED'
          : 'TRANSPORT_FAILED';
    await store.fail({
      runId: item.run.id,
      claimToken: item.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode,
      completedAt: await observedAt(
        input.driver,
        item.run.claimLeaseAcquiredAt,
        ...receipts.map(({ evaluatedAt }) => evaluatedAt),
      ),
      rightsReceipt: receipts,
      provider: providerId,
    });
    return 'FAILED';
  }
}
