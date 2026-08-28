import type {
  AcquisitionMethod,
  IsoDateTime,
  SourceArtifact,
  SourceArtifactInsert,
  SourceId,
} from '@data-foundry/canonical-schema';
import { ARTIFACT_COLUMNS, mapSourceArtifact, toIso, toIsoOrNull, toJson, toNumber } from './rows.js';
import type { SqlDriver, SqlExecutor, SqlRow } from './sql-driver.js';

export type ScheduledAcquisitionStatus = 'CLAIMED' | 'SUCCEEDED' | 'REFUSED' | 'FAILED';
export type ScheduledAcquisitionOutcome = 'FETCHED' | 'NOT_MODIFIED' | 'EMPTY';
export type AcquisitionAssetClass = 'DOCUMENT' | 'DATA' | 'IMAGE' | 'MODEL_OUTPUT';
export type AcquisitionOutputClass = 'RAW_RECORD' | 'NORMALIZED_FACT' | 'DERIVED_METRIC';

export interface ScheduledAcquisitionRun {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly verticalSlug: string;
  readonly sourceId: SourceId;
  readonly sourceKey: string;
  readonly targetId: string;
  readonly targetUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: AcquisitionAssetClass;
  readonly outputClass: AcquisitionOutputClass;
  readonly scheduledFor: IsoDateTime;
  readonly claimedAt: IsoDateTime;
  readonly completedAt: IsoDateTime | null;
  readonly freshAt: IsoDateTime | null;
  readonly status: ScheduledAcquisitionStatus;
  readonly outcome: ScheduledAcquisitionOutcome | null;
  readonly failureCode: string | null;
  readonly rightsReceipt: readonly unknown[];
  readonly provider: string | null;
  readonly validators: Readonly<Record<string, unknown>>;
  readonly expectedArtifactCount: number;
  readonly artifactCount: number;
  readonly runtimeDigest: string;
}

export interface ScheduledAcquisitionClaim {
  readonly idempotencyKey: string;
  readonly verticalSlug: string;
  readonly sourceId: SourceId;
  readonly sourceKey: string;
  readonly targetId: string;
  readonly targetUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: AcquisitionAssetClass;
  readonly outputClass: AcquisitionOutputClass;
  readonly scheduledFor: IsoDateTime;
  readonly runtimeDigest: string;
  readonly claimedAt: IsoDateTime;
}

export interface ScheduledAcquisitionCompletion {
  readonly runId: string;
  readonly outcome: Extract<ScheduledAcquisitionOutcome, 'FETCHED' | 'NOT_MODIFIED'>;
  readonly completedAt: IsoDateTime;
  readonly freshAt: IsoDateTime;
  readonly provider: string;
  readonly validators: Readonly<Record<string, unknown>>;
  readonly rightsReceipt: readonly unknown[];
  readonly artifacts: readonly SourceArtifactInsert[];
}

export interface ScheduledAcquisitionFailure {
  readonly runId: string;
  readonly status: Extract<ScheduledAcquisitionStatus, 'REFUSED' | 'FAILED'>;
  readonly outcome: Extract<ScheduledAcquisitionOutcome, 'EMPTY'> | null;
  readonly failureCode: string;
  readonly completedAt: IsoDateTime;
  readonly rightsReceipt: readonly unknown[];
  readonly provider?: string | null;
}

export interface ScheduledAcquisitionStore {
  claim(input: ScheduledAcquisitionClaim): Promise<ScheduledAcquisitionRun | null>;
  complete(input: ScheduledAcquisitionCompletion): Promise<ScheduledAcquisitionRun>;
  fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun>;
  get(runId: string): Promise<ScheduledAcquisitionRun | null>;
  latestSuccessAt(sourceId: SourceId, targetId: string): Promise<IsoDateTime | null>;
}

const RUN_COLUMNS = `id, idempotency_key, vertical_slug, source_id, source_key, target_id,
  target_url, acquisition_route, account_or_product_plan, acquisition_jurisdiction,
  asset_class, output_class, scheduled_for, claimed_at, completed_at, fresh_at, status,
  outcome, failure_code, rights_receipt, provider, validators, expected_artifact_count,
  artifact_count, runtime_digest`;

function mapRun(row: SqlRow): ScheduledAcquisitionRun {
  const receipt = toJson(row['rights_receipt']);
  const validators = toJson(row['validators']);
  if (!Array.isArray(receipt) || validators === null || typeof validators !== 'object' || Array.isArray(validators)) {
    throw new Error('scheduled acquisition JSON columns have an invalid shape');
  }
  return {
    id: String(row['id']),
    idempotencyKey: String(row['idempotency_key']),
    verticalSlug: String(row['vertical_slug']),
    sourceId: row['source_id'] as SourceId,
    sourceKey: String(row['source_key']),
    targetId: String(row['target_id']),
    targetUrl: String(row['target_url']),
    acquisitionRoute: row['acquisition_route'] as AcquisitionMethod,
    accountOrProductPlan: row['account_or_product_plan'] === null ? null : String(row['account_or_product_plan']),
    jurisdiction: row['acquisition_jurisdiction'] === null ? null : String(row['acquisition_jurisdiction']),
    assetClass: row['asset_class'] as AcquisitionAssetClass,
    outputClass: row['output_class'] as AcquisitionOutputClass,
    scheduledFor: toIso(row['scheduled_for']),
    claimedAt: toIso(row['claimed_at']),
    completedAt: toIsoOrNull(row['completed_at']),
    freshAt: toIsoOrNull(row['fresh_at']),
    status: row['status'] as ScheduledAcquisitionStatus,
    outcome: (row['outcome'] ?? null) as ScheduledAcquisitionOutcome | null,
    failureCode: row['failure_code'] === null ? null : String(row['failure_code']),
    rightsReceipt: receipt,
    provider: row['provider'] === null ? null : String(row['provider']),
    validators: validators as Readonly<Record<string, unknown>>,
    expectedArtifactCount: toNumber(row['expected_artifact_count']),
    artifactCount: toNumber(row['artifact_count']),
    runtimeDigest: String(row['runtime_digest']),
  };
}

async function persistArtifact(tx: SqlExecutor, input: SourceArtifactInsert): Promise<SourceArtifact> {
  const rows = await tx.query(
    `INSERT INTO source_artifacts (source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
                                   http_status, extractor_version, policy_snapshot_id, byte_size,
                                   acquisition_provider, acquisition_route,
                                   account_or_product_plan, acquisition_jurisdiction)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (source_id, url, content_hash, acquisition_route,
                  account_or_product_plan, acquisition_jurisdiction)
     DO UPDATE SET source_id = source_artifacts.source_id
     RETURNING ${ARTIFACT_COLUMNS}`,
    [
      input.source_id, input.url, input.retrieved_at, input.content_hash, input.mime_type,
      input.r2_uri, input.http_status, input.extractor_version, input.policy_snapshot_id,
      input.byte_size, input.acquisition_provider, input.acquisition_route,
      input.account_or_product_plan, input.acquisition_jurisdiction,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('source artifact persistence returned no row');
  return mapSourceArtifact(row);
}

class PostgresScheduledAcquisitionStore implements ScheduledAcquisitionStore {
  constructor(readonly driver: SqlDriver) {}

  async claim(input: ScheduledAcquisitionClaim): Promise<ScheduledAcquisitionRun | null> {
    const rows = await this.driver.query(
      `INSERT INTO scheduled_acquisition_runs
         (idempotency_key, vertical_slug, source_id, source_key, target_id, target_url,
          acquisition_route, account_or_product_plan, acquisition_jurisdiction,
          asset_class, output_class, scheduled_for, claimed_at, runtime_digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT DO NOTHING
       RETURNING ${RUN_COLUMNS}`,
      [
        input.idempotencyKey, input.verticalSlug, input.sourceId, input.sourceKey,
        input.targetId, input.targetUrl, input.acquisitionRoute, input.accountOrProductPlan,
        input.jurisdiction, input.assetClass, input.outputClass, input.scheduledFor,
        input.claimedAt, input.runtimeDigest,
      ],
    );
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async complete(input: ScheduledAcquisitionCompletion): Promise<ScheduledAcquisitionRun> {
    if (input.outcome === 'NOT_MODIFIED' && input.artifacts.length !== 0) {
      throw new Error('NOT_MODIFIED cannot carry artifacts');
    }
    if (input.outcome === 'FETCHED' && input.artifacts.length === 0) {
      throw new Error('FETCHED requires at least one artifact');
    }

    return this.driver.transaction(async (tx) => {
      const locked = await tx.query(`SELECT ${RUN_COLUMNS} FROM scheduled_acquisition_runs WHERE id = $1 FOR UPDATE`, [input.runId]);
      const current = locked[0];
      if (current === undefined) throw new Error(`scheduled acquisition run ${input.runId} was not found`);
      const run = mapRun(current);
      if (run.status !== 'CLAIMED') throw new Error(`scheduled acquisition run ${input.runId} is already terminal`);

      for (const [ordinal, artifactInput] of input.artifacts.entries()) {
        if (artifactInput.source_id !== run.sourceId) {
          throw new Error('scheduled acquisition artifact source does not match the run source');
        }
        const persisted = await persistArtifact(tx, artifactInput);
        await tx.query(
          `INSERT INTO scheduled_acquisition_run_artifacts (run_id, artifact_id, ordinal)
           VALUES ($1, $2, $3)`,
          [run.id, persisted.id, ordinal],
        );
      }

      const rows = await tx.query(
        `UPDATE scheduled_acquisition_runs
            SET status = 'SUCCEEDED', outcome = $2, completed_at = $3, fresh_at = $4,
                provider = $5, validators = $6::jsonb, rights_receipt = $7::jsonb,
                expected_artifact_count = $8, artifact_count = $8
          WHERE id = $1
          RETURNING ${RUN_COLUMNS}`,
        [
          run.id, input.outcome, input.completedAt, input.freshAt, input.provider,
          JSON.stringify(input.validators), JSON.stringify(input.rightsReceipt), input.artifacts.length,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error(`scheduled acquisition run ${input.runId} did not complete`);
      return mapRun(row);
    });
  }

  async fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun> {
    const rows = await this.driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = $2, outcome = $3, failure_code = $4, completed_at = $5,
              rights_receipt = $6::jsonb, provider = $7
        WHERE id = $1 AND status = 'CLAIMED'
        RETURNING ${RUN_COLUMNS}`,
      [
        input.runId, input.status, input.outcome, input.failureCode, input.completedAt,
        JSON.stringify(input.rightsReceipt), input.provider ?? null,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`scheduled acquisition run ${input.runId} was not found or is terminal`);
    return mapRun(row);
  }

  async get(runId: string): Promise<ScheduledAcquisitionRun | null> {
    const rows = await this.driver.query(`SELECT ${RUN_COLUMNS} FROM scheduled_acquisition_runs WHERE id = $1`, [runId]);
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async latestSuccessAt(sourceId: SourceId, targetId: string): Promise<IsoDateTime | null> {
    const rows = await this.driver.query(
      `SELECT fresh_at FROM scheduled_acquisition_runs
        WHERE source_id = $1 AND target_id = $2 AND status = 'SUCCEEDED'
        ORDER BY fresh_at DESC LIMIT 1`,
      [sourceId, targetId],
    );
    return rows[0] === undefined ? null : toIso(rows[0]['fresh_at']);
  }
}

export function createScheduledAcquisitionStore(driver: SqlDriver): ScheduledAcquisitionStore {
  return new PostgresScheduledAcquisitionStore(driver);
}
