import {
  AcquisitionProviderRegistry, artifactContentKey, artifactRetrievalReceiptId, artifactRetrievalKey,
  metadataFromRecord, sha256Hex,
  type ArtifactStore, type ArtifactRetrievalRecord,
} from '@data-foundry/acquisition';
import {
  createIngestionDeliveryStore, createScheduledAcquisitionStore, enqueueIngestionDelivery,
  loadStoredRightsContext, mapSourceArtifact, toIso,
  IngestionSupersededError,
  type IngestionClaim, type IngestionFailureCode, type ScheduledAcquisitionRunObservation,
  type SqlDriver, type SqlExecutor, type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import { evaluateRights } from '@data-foundry/rights-engine';
import type { IsoDateTime } from '@data-foundry/canonical-schema';
import {
  ArtifactPipeline, INGESTION_LIMITS, loadIngestionRuntime,
  type AcquiredArtifact, type IngestionRuntime,
} from '../../../services/ingest-worker/src/runtime.js';

export interface IngestionObject {
  readonly size: number;
  readonly customMetadata?: Readonly<Record<string, string>>;
  bytes(): Promise<Uint8Array>;
}
export interface IngestionBucket { get(key: string): Promise<IngestionObject | null> }
export interface ProcessDeliveryInput {
  readonly driver: SqlDriver; readonly deliveryId: string; readonly runtime: IngestionRuntime;
  readonly bucket: IngestionBucket; readonly bucketName: string;
  /** Local regression seam; production never emits raw provider/database errors. */
  readonly onError?: (error: unknown) => void;
}
class InputRefusal extends Error {
  constructor(readonly code: IngestionFailureCode) { super(code); }
}
const refuse = (): never => { throw new InputRefusal('INPUT_REFUSED'); };

/** Nested canonical operations stay on the lease-owning transaction and cannot commit independently. */
export function bindIngestionTransaction(driver: SqlDriver, tx: SqlTransactionExecutor): SqlDriver {
  return {
    label: `${driver.label}:ingestion`, dialect: driver.dialect,
    capabilityCacheKey: driver.capabilityCacheKey ?? driver,
    query: (sql, params) => tx.query(sql, params),
    transaction: async callback => callback(tx),
    exec: async () => { throw new Error('INGESTION_DDL_REFUSED'); },
    close: async () => undefined,
  };
}
async function databaseNow(tx: SqlExecutor): Promise<string> {
  const rows = await tx.query('SELECT clock_timestamp() AS at');
  return toIso(rows[0]!['at']);
}
async function requireCurrentRights(tx: SqlExecutor, run: ScheduledAcquisitionRunObservation): Promise<void> {
  const at = await databaseNow(tx);
  const context = await loadStoredRightsContext(tx, run.sourceId, at);
  if (!context) throw new InputRefusal('RIGHTS_REFUSED');
  for (const operation of ['ACQUIRE', 'STORE', 'CACHE'] as const) {
    const decision = evaluateRights({ source: context.source, sourceStatusRequirement: 'ACTIVE',
      acquisitionRoute: run.acquisitionRoute, accountOrProductPlan: run.accountOrProductPlan,
      jurisdiction: run.jurisdiction, assetClass: run.assetClass, outputClass: run.outputClass,
      fieldKey: null, fieldGroupIds: [], operation, channel: 'INTERNAL_PROCESSING', asOf: at,
      conditionReceipts: [], }, context.snapshot);
    if (!decision.permitted) throw new InputRefusal('RIGHTS_REFUSED');
  }
}
async function lockCurrentSource(tx: SqlExecutor, run: ScheduledAcquisitionRunObservation): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('source-stream-set'), hashtext($1))`, [run.sourceId]);
  const newer = await tx.query(`SELECT 1 FROM ingestion_deliveries delivery
    JOIN scheduled_acquisition_runs accepted ON accepted.id=delivery.artifact_run_id
    WHERE accepted.source_id=$1 AND delivery.status='PUBLISHED' AND delivery.work_kind='PROCESS_ARTIFACTS'
      AND accepted.fresh_at > $2 LIMIT 1`, [run.sourceId, run.freshAt]);
  if (newer.length) return refuse();
}

async function verifyCurrentEntities(tx: SqlExecutor, run: ScheduledAcquisitionRunObservation, verifiedAt: string): Promise<void> {
  const at = await databaseNow(tx);
  const context = await loadStoredRightsContext(tx, run.sourceId, at);
  if (!context) throw new InputRefusal('RIGHTS_REFUSED');
  const facts = await tx.query<{ entity_id: string; property: string; output_kind: string }>(`SELECT DISTINCT fact.entity_id, fact.property, fact.output_kind
    FROM facts fact JOIN fact_evidence evidence ON evidence.fact_id=fact.id
    JOIN source_records record ON record.id=evidence.source_record_id
    JOIN scheduled_acquisition_run_artifacts link ON link.artifact_id=evidence.artifact_id
    WHERE fact.status='ACTIVE' AND fact.valid_to IS NULL AND record.is_current=TRUE
      AND record.revision_state='FINALIZED' AND link.run_id=$1 LIMIT 10001`, [run.id]);
  if (facts.length > 10000) return refuse();
  const authorized = new Set<string>();
  const refused = new Set<string>();
  for (const fact of facts) {
    for (const operation of ['NORMALIZE', 'DERIVE'] as const) {
      const fieldGroupIds = [...(context.snapshot.fieldGroupMembers ?? new Map())]
        .filter(([, members]) => members.includes(fact.property)).map(([id]) => id);
      const decision = evaluateRights({ source: context.source, sourceStatusRequirement: 'ACTIVE',
        acquisitionRoute: run.acquisitionRoute, accountOrProductPlan: run.accountOrProductPlan,
        jurisdiction: run.jurisdiction, assetClass: 'DATA', outputClass: fact.output_kind as 'NORMALIZED_FACT' | 'DERIVED_METRIC',
        fieldKey: fact.property, fieldGroupIds, operation, channel: 'INTERNAL_PROCESSING', asOf: at, conditionReceipts: [], }, context.snapshot);
      if (!decision.permitted) refused.add(fact.entity_id);
    }
    authorized.add(fact.entity_id);
  }
  for (const entityId of authorized) if (!refused.has(entityId)) {
    await tx.query(`UPDATE entities SET last_verified_at=GREATEST(last_verified_at,$2::timestamptz)
      WHERE id=$1 AND NOT EXISTS (
        SELECT 1 FROM facts fact WHERE fact.entity_id=$1 AND fact.status='ACTIVE' AND fact.valid_to IS NULL
          AND NOT EXISTS (SELECT 1 FROM fact_evidence evidence JOIN source_records record ON record.id=evidence.source_record_id
            JOIN scheduled_acquisition_run_artifacts link ON link.artifact_id=evidence.artifact_id
            WHERE evidence.fact_id=fact.id AND record.is_current=TRUE AND record.revision_state='FINALIZED' AND link.run_id=$3))`,
      [entityId, verifiedAt, run.id]);
  }
}
async function boundedObject(bucket: IngestionBucket, key: string, limit: number): Promise<{ bytes: Uint8Array; object: IngestionObject }> {
  const object = await bucket.get(key);
  if (!object || !Number.isSafeInteger(object.size) || object.size < 0 || object.size > limit) return refuse();
  const bytes = await object.bytes();
  if (bytes.byteLength !== object.size || bytes.byteLength > limit) return refuse();
  return { bytes, object };
}

export async function readVerifiedManifest(input: ProcessDeliveryInput, claim: IngestionClaim,
  run: ScheduledAcquisitionRunObservation): Promise<readonly AcquiredArtifact[]> {
  const rows = await input.driver.query(`SELECT artifact.*, link.ordinal, link.retrieval_key,
      link.result_url, link.acquisition_provider AS receipt_provider
    FROM scheduled_acquisition_run_artifacts link JOIN source_artifacts artifact ON artifact.id = link.artifact_id
    WHERE link.run_id = $1 ORDER BY link.ordinal LIMIT $2`, [claim.artifactRunId, INGESTION_LIMITS.maxArtifacts + 1]);
  if (!rows.length || rows.length !== run.artifactCount || rows.length > INGESTION_LIMITS.maxArtifacts) return refuse();
  const verified: AcquiredArtifact[] = [];
  let totalBytes = 0;
  for (const [ordinal, row] of rows.entries()) {
    if (Number(row['ordinal']) !== ordinal) return refuse();
    const artifact = mapSourceArtifact(row);
    const key = artifactContentKey({ vertical: run.verticalSlug, source: run.sourceKey, contentHash: artifact.content_hash });
    if (artifact.source_id !== run.sourceId || artifact.r2_uri !== `r2://${input.bucketName}/${key}`) return refuse();
    const retrievalKey = String(row['retrieval_key']);
    if (!retrievalKey.startsWith(`raw/${run.verticalSlug}/${run.sourceKey}/retrieved/`) || retrievalKey.includes('..')) return refuse();
    const receiptBody = await boundedObject(input.bucket, retrievalKey, INGESTION_LIMITS.maxReceiptBytes);
    let receipt: ArtifactRetrievalRecord;
    try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receiptBody.bytes)) as ArtifactRetrievalRecord; }
    catch { return refuse(); }
    if (receipt === null || typeof receipt !== 'object' ||
      receipt.content_key !== key || receipt.content_hash !== artifact.content_hash ||
      receipt.source_key !== run.sourceKey || receipt.vertical_slug !== run.verticalSlug ||
      receipt.url !== row['result_url'] || receipt.acquisition_provider !== row['receipt_provider'] ||
      receipt.acquisition_route !== run.acquisitionRoute ||
      receipt.account_or_product_plan !== run.accountOrProductPlan || receipt.acquisition_jurisdiction !== run.jurisdiction ||
      receipt.retrieval_receipt_id !== artifactRetrievalReceiptId(run.id, receipt.url, receipt.acquisition_provider) ||
      !Number.isFinite(Date.parse(receipt.retrieved_at)) ||
      Date.parse(receipt.retrieved_at) < Date.parse(run.claimLeaseAcquiredAt) ||
      Date.parse(receipt.retrieved_at) > Date.parse(run.completedAt ?? '') ||
      !Number.isSafeInteger(receipt.byte_size) || receipt.byte_size < 0 || receipt.byte_size > INGESTION_LIMITS.maxArtifactBytes) return refuse();
    if (retrievalKey !== artifactRetrievalKey({ vertical: run.verticalSlug, source: run.sourceKey,
      contentHash: artifact.content_hash, retrievedAt: receipt.retrieved_at,
      policySnapshotId: receipt.policy_snapshot_id, retrievalReceiptId: receipt.retrieval_receipt_id })) return refuse();
    totalBytes += receipt.byte_size;
    if (totalBytes > INGESTION_LIMITS.maxTotalBytes) return refuse();
    const body = await boundedObject(input.bucket, key, INGESTION_LIMITS.maxArtifactBytes);
    if (body.bytes.byteLength !== receipt.byte_size || sha256Hex(body.bytes) !== artifact.content_hash) return refuse();
    // Qualified JSON/CSV are UTF-8. Replacement decoding would invent canonical
    // characters not present in the hash-verified source bytes.
    try { new TextDecoder('utf-8', { fatal: true }).decode(body.bytes); } catch { return refuse(); }
    // First-retrieval metadata is immutable. The separate receipt above describes this acquisition.
    const metadata = metadataFromRecord(body.object.customMetadata);
    if (metadata === null || metadata.content_hash !== artifact.content_hash || metadata.source_key !== run.sourceKey ||
      metadata.vertical_slug !== run.verticalSlug || metadata.byte_size !== body.bytes.byteLength || metadata.mime_type !== artifact.mime_type) return refuse();
    await createIngestionDeliveryStore(input.driver).checkpoint(claim, { ordinal, artifactId: artifact.id,
      contentHash: artifact.content_hash, byteSize: body.bytes.byteLength });
    verified.push({ artifact, body: body.bytes, stored: { key, uri: artifact.r2_uri,
      contentHash: artifact.content_hash, byteSize: body.bytes.byteLength, deduplicated: true,
      retrievalKey, retrievalReceiptId: receipt.retrieval_receipt_id, metadata: {
        ...metadata, url: receipt.url, retrieved_at: receipt.retrieved_at, http_status: receipt.http_status,
        policy_snapshot_id: receipt.policy_snapshot_id, acquisition_provider: receipt.acquisition_provider,
        acquisition_route: receipt.acquisition_route, account_or_product_plan: receipt.account_or_product_plan,
        acquisition_jurisdiction: receipt.acquisition_jurisdiction, etag: receipt.etag, last_modified: receipt.last_modified,
      } } });
  }
  return verified;
}

/** A delivery either atomically publishes a complete bounded manifest, or leaves no canonical writes. */
export async function processIngestionDelivery(input: ProcessDeliveryInput): Promise<'PUBLISHED' | 'TERMINAL' | 'RETRY'> {
  const store = createIngestionDeliveryStore(input.driver);
  const claimed = await store.claim(input.deliveryId, input.runtime.runtime_digest);
  if (claimed.disposition === 'ACTIVE' || claimed.disposition === 'INCOMPATIBLE') return 'RETRY';
  if (claimed.disposition !== 'ACQUIRED') return 'TERMINAL';
  const claim = claimed.claim;
  try {
    const config = loadIngestionRuntime(input.runtime);
    if (claim.runtimeDigest !== input.runtime.runtime_digest) throw new InputRefusal('RUNTIME_MISMATCH');
    const run = await createScheduledAcquisitionStore(input.driver).get(claim.artifactRunId);
    if (!run || run.status !== 'SUCCEEDED' || run.outcome !== 'FETCHED' ||
        run.verticalSlug !== config.slug || !input.runtime.supported_source_keys.includes(run.sourceKey) ||
        !input.runtime.source_targets.some(target => target.source_key === run.sourceKey && target.target_id === run.targetId)) return refuse();
    const entry = config.sources.find(source => source.key === run.sourceKey);
    if (!entry || entry.acquisition_policy.method !== run.acquisitionRoute ||
        entry.acquisition_policy.account_or_product_plan !== run.accountOrProductPlan ||
        entry.acquisition_policy.jurisdiction !== run.jurisdiction) return refuse();
    const sameSource = await input.driver.query(`SELECT 1 FROM sources source JOIN verticals vertical ON vertical.id=source.vertical_id
      WHERE source.id=$1 AND source.domain=$2 AND source.source_type=$3 AND vertical.slug=$4`,
      [run.sourceId, entry.domain, entry.source_type, config.slug]);
    if (!sameSource.length) return refuse();
    await requireCurrentRights(input.driver, run);
    if (claim.workKind === 'VERIFY_UNCHANGED') {
      const verification = await createScheduledAcquisitionStore(input.driver).get(claim.acquisitionRunId);
      if (!verification || verification.status !== 'SUCCEEDED' || verification.outcome !== 'NOT_MODIFIED' ||
          verification.sourceId !== run.sourceId || verification.targetId !== run.targetId || verification.freshAt === null) return refuse();
      const accepted = await input.driver.query<{ id: string }>(`SELECT id FROM ingestion_deliveries WHERE artifact_run_id = $1
        AND runtime_digest = $2 AND work_kind = 'PROCESS_ARTIFACTS' AND status = 'PUBLISHED' LIMIT 1`,
        [claim.artifactRunId, claim.runtimeDigest]);
      if (!accepted.length) {
        await store.processOwned(claim, tx => enqueueIngestionDelivery(tx, {
          acquisitionRunId: claim.artifactRunId, artifactRunId: claim.artifactRunId,
          runtimeDigest: claim.runtimeDigest, workKind: 'PROCESS_ARTIFACTS',
        }));
        await store.releaseOwned(claim, 'PROCESSING_ERROR');
        return 'RETRY';
      }
      await store.publishOwned(claim, async tx => {
        await lockCurrentSource(tx, run);
        const newer = await tx.query(`SELECT 1 FROM scheduled_acquisition_runs WHERE source_id = $1
          AND target_id = $2 AND status = 'SUCCEEDED' AND outcome = 'FETCHED' AND completed_at > $3 LIMIT 1`,
          [run.sourceId, run.targetId, run.completedAt]);
        if (newer.length) return refuse();
        await requireCurrentRights(tx, run);
        await verifyCurrentEntities(tx, run, verification.freshAt!);
      }, accepted[0]!.id);
      return 'PUBLISHED';
    }
    const artifacts = await readVerifiedManifest(input, claim, run);
    await store.publishOwned(claim, async tx => {
      await lockCurrentSource(tx, run);
      const pinned = bindIngestionTransaction(input.driver, tx);
      await requireCurrentRights(tx, run);
      const at = await databaseNow(tx) as IsoDateTime;
      const artifactStore: ArtifactStore = {
        scheme: 'r2', uriFor: key => `r2://${input.bucketName}/${key}`,
        get: async key => { const item = artifacts.find(a => a.stored.key === key); return item ? { body: item.body, metadata: item.stored.metadata } : null; },
        head: async key => artifacts.find(a => a.stored.key === key)?.stored.metadata ?? null,
        put: async () => { throw new Error('INGESTION_ARTIFACT_WRITE_REFUSED'); },
        list: async () => [], delete: async () => { throw new Error('INGESTION_ARTIFACT_DELETE_REFUSED'); },
      };
      const pipeline = new ArtifactPipeline({ driver: pinned, config, providers: new AcquisitionProviderRegistry(),
        artifactStore, fixtures: [], now: at, runId: claim.id, maxRecords: INGESTION_LIMITS.maxRecords,
        maxPromotions: 10_000, promoteBeforePublished: true, persistedGovernanceOnly: true,
        processingRuntimeDigest: claim.runtimeDigest, verifiedAt: run.freshAt! });
      const result = await pipeline.runArtifacts(run.sourceKey, { targetUrl: run.targetUrl,
        fetchedAt: run.freshAt!, artifacts });
      if (result.finalState !== 'PUBLISHED') {
        if (/RIGHTS|MATRIX_REFUSED/.test(result.error ?? '')) throw new InputRefusal('RIGHTS_REFUSED');
        if (/LIMIT|CONFIGURATION|SNAPSHOT/.test(result.error ?? '')) return refuse();
        throw new Error('INGESTION_PIPELINE_FAILED');
      }
      await pipeline.assertCurrentInternalRights(await databaseNow(tx));
      await requireCurrentRights(tx, run);
    });
    return 'PUBLISHED';
  } catch (error) {
    input.onError?.(error);
    const terminal = error instanceof InputRefusal || error instanceof IngestionSupersededError;
    await store.releaseOwned(claim, terminal ? error.code : 'PROCESSING_ERROR', terminal);
    return terminal ? 'TERMINAL' : 'RETRY';
  }
}
