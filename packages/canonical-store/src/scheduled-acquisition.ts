import type {
  AcquisitionMethod,
  IsoDateTime,
  SourceArtifact,
  SourceArtifactInsert,
  SourceId,
} from '@data-foundry/canonical-schema';
import { RIGHTS_STATES, type RightsState } from '@data-foundry/canonical-schema';
import {
  RIGHTS_REASON_CODES,
  type RightsReasonCode,
} from '@data-foundry/rights-engine';
import { ARTIFACT_COLUMNS, mapSourceArtifact, toIso, toIsoOrNull, toJson, toNumber } from './rows.js';
import type { SqlDriver, SqlExecutor, SqlRow } from './sql-driver.js';

export type ScheduledAcquisitionStatus = 'CLAIMED' | 'SUCCEEDED' | 'SKIPPED' | 'REFUSED' | 'FAILED';
export type ScheduledAcquisitionOutcome = 'FETCHED' | 'NOT_MODIFIED' | 'EMPTY';
export type AcquisitionAssetClass = 'DOCUMENT' | 'DATA' | 'IMAGE' | 'MODEL_OUTPUT';
export type AcquisitionOutputClass = 'RAW_RECORD' | 'NORMALIZED_FACT' | 'DERIVED_METRIC';

export const SCHEDULED_ACQUISITION_PROVIDERS = [
  'http',
  'browser-run',
  'crawl4ai',
  'fixture',
] as const;
export type ScheduledAcquisitionProvider = (typeof SCHEDULED_ACQUISITION_PROVIDERS)[number];

export const SCHEDULED_ACQUISITION_FAILURE_CODES = [
  'NOT_DUE',
  'RIGHTS_REFUSED',
  'EMPTY_RESPONSE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_CONFIGURATION',
  'TRANSPORT_FAILED',
  'PERSISTENCE_FAILED',
  'RUNTIME_CONFIGURATION',
  'INTERNAL_ERROR',
] as const;
export type ScheduledAcquisitionFailureCode =
  (typeof SCHEDULED_ACQUISITION_FAILURE_CODES)[number];

export interface ScheduledAcquisitionValidators {
  readonly etag?: string;
  readonly lastModified?: string;
  readonly contentHash?: string;
}

export type ScheduledRightsReceiptStage = 'INITIAL' | 'PRE_PROVIDER' | 'PRE_TRANSPORT';
export type ScheduledRightsOperation = 'ACQUIRE' | 'STORE' | 'CACHE';

export interface ScheduledRightsDecisionReceipt {
  readonly operation: ScheduledRightsOperation;
  readonly permitted: boolean;
  readonly state: RightsState;
  readonly reasonCode: RightsReasonCode;
  readonly cellId: string | null;
  readonly decisionId: string | null;
  readonly termsVersionId: string | null;
}

export interface ScheduledRightsReceipt {
  readonly stage: ScheduledRightsReceiptStage;
  readonly evaluatedAt: IsoDateTime;
  readonly decisions: readonly ScheduledRightsDecisionReceipt[];
}

export interface ScheduledAcquisitionFreshnessScope {
  readonly sourceId: SourceId;
  readonly targetId: string;
  readonly targetUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly assetClass: AcquisitionAssetClass;
  readonly outputClass: AcquisitionOutputClass;
  /** Runtime changes intentionally force a conservative re-acquisition. */
  readonly runtimeDigest: string;
}

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
  readonly failureCode: ScheduledAcquisitionFailureCode | null;
  readonly rightsReceipt: readonly ScheduledRightsReceipt[];
  readonly provider: ScheduledAcquisitionProvider | null;
  readonly validators: ScheduledAcquisitionValidators;
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
  readonly provider: ScheduledAcquisitionProvider;
  readonly validators: ScheduledAcquisitionValidators;
  readonly rightsReceipt: readonly ScheduledRightsReceipt[];
  readonly artifacts: readonly SourceArtifactInsert[];
}

export interface ScheduledAcquisitionFailure {
  readonly runId: string;
  readonly status: Extract<ScheduledAcquisitionStatus, 'SKIPPED' | 'REFUSED' | 'FAILED'>;
  readonly outcome: Extract<ScheduledAcquisitionOutcome, 'EMPTY'> | null;
  readonly failureCode: ScheduledAcquisitionFailureCode;
  readonly completedAt: IsoDateTime;
  readonly rightsReceipt: readonly ScheduledRightsReceipt[];
  readonly provider?: ScheduledAcquisitionProvider | null;
}

export interface ScheduledAcquisitionStore {
  claim(input: ScheduledAcquisitionClaim): Promise<ScheduledAcquisitionRun | null>;
  complete(input: ScheduledAcquisitionCompletion): Promise<ScheduledAcquisitionRun>;
  fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun>;
  get(runId: string): Promise<ScheduledAcquisitionRun | null>;
  latestSuccessAt(scope: ScheduledAcquisitionFreshnessScope): Promise<IsoDateTime | null>;
}

const RUN_COLUMNS = `id, idempotency_key, vertical_slug, source_id, source_key, target_id,
  target_url, acquisition_route, account_or_product_plan, acquisition_jurisdiction,
  asset_class, output_class, scheduled_for, claimed_at, completed_at, fresh_at, status,
  outcome, failure_code, rights_receipt, provider, validators, expected_artifact_count,
  artifact_count, runtime_digest`;

const PROVIDERS = new Set<string>(SCHEDULED_ACQUISITION_PROVIDERS);
const FAILURE_CODES = new Set<string>(SCHEDULED_ACQUISITION_FAILURE_CODES);
const RIGHTS_STATE_SET = new Set<string>(RIGHTS_STATES);
const RIGHTS_REASON_SET = new Set<string>(RIGHTS_REASON_CODES);
const RECEIPT_STAGES = new Set<string>(['INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT']);
const RECEIPT_OPERATIONS = new Set<string>(['ACQUIRE', 'STORE', 'CACHE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_HASH = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`);
}

function parseProvider(value: unknown): ScheduledAcquisitionProvider | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !PROVIDERS.has(value)) {
    throw new Error('scheduled acquisition provider is not an enumerated provider id');
  }
  return value as ScheduledAcquisitionProvider;
}

function parseFailureCode(value: unknown): ScheduledAcquisitionFailureCode | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !FAILURE_CODES.has(value)) {
    throw new Error('scheduled acquisition failure code is not enumerated');
  }
  return value as ScheduledAcquisitionFailureCode;
}

function parseValidators(value: unknown): ScheduledAcquisitionValidators {
  if (!isRecord(value)) throw new Error('scheduled acquisition validators must be an object');
  exactKeys(value, ['etag', 'lastModified', 'contentHash'], 'scheduled acquisition validators');
  const parsed: { etag?: string; lastModified?: string; contentHash?: string } = {};
  if (value['etag'] !== undefined) {
    if (typeof value['etag'] !== 'string' || value['etag'].length < 1 || value['etag'].length > 1024) {
      throw new Error('scheduled acquisition validator etag must be 1-1024 characters');
    }
    parsed.etag = value['etag'];
  }
  if (value['lastModified'] !== undefined) {
    if (
      typeof value['lastModified'] !== 'string' ||
      value['lastModified'].length < 1 ||
      value['lastModified'].length > 128
    ) {
      throw new Error('scheduled acquisition validator lastModified must be 1-128 characters');
    }
    parsed.lastModified = value['lastModified'];
  }
  if (value['contentHash'] !== undefined) {
    if (typeof value['contentHash'] !== 'string' || !CONTENT_HASH.test(value['contentHash'])) {
      throw new Error('scheduled acquisition validator contentHash must be a SHA-256 hex digest');
    }
    parsed.contentHash = value['contentHash'];
  }
  return parsed;
}

function parseNullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} must be a UUID or null`);
  return value;
}

function parseRightsReceipt(value: unknown, requireNonEmpty: boolean): readonly ScheduledRightsReceipt[] {
  if (!Array.isArray(value) || value.length > 3 || (requireNonEmpty && value.length === 0)) {
    throw new Error('scheduled acquisition rights receipt must contain 1-3 trusted checkpoints');
  }
  return value.map((checkpoint, checkpointIndex) => {
    if (!isRecord(checkpoint)) throw new Error('scheduled acquisition rights receipt checkpoint must be an object');
    exactKeys(checkpoint, ['stage', 'evaluatedAt', 'decisions'], 'scheduled acquisition rights receipt');
    const stage = checkpoint['stage'];
    const evaluatedAt = checkpoint['evaluatedAt'];
    const decisions = checkpoint['decisions'];
    if (typeof stage !== 'string' || !RECEIPT_STAGES.has(stage)) {
      throw new Error('scheduled acquisition rights receipt stage is invalid');
    }
    if (typeof evaluatedAt !== 'string' || Number.isNaN(Date.parse(evaluatedAt))) {
      throw new Error('scheduled acquisition rights receipt evaluatedAt is invalid');
    }
    if (!Array.isArray(decisions) || decisions.length !== 3) {
      throw new Error('scheduled acquisition rights receipt requires ACQUIRE, STORE, and CACHE decisions');
    }
    const seen = new Set<string>();
    const parsedDecisions = decisions.map((decision) => {
      if (!isRecord(decision)) throw new Error('scheduled acquisition rights receipt decision must be an object');
      exactKeys(
        decision,
        ['operation', 'permitted', 'state', 'reasonCode', 'cellId', 'decisionId', 'termsVersionId'],
        'scheduled acquisition rights receipt decision',
      );
      const operation = decision['operation'];
      const permitted = decision['permitted'];
      const state = decision['state'];
      const reasonCode = decision['reasonCode'];
      if (typeof operation !== 'string' || !RECEIPT_OPERATIONS.has(operation) || seen.has(operation)) {
        throw new Error('scheduled acquisition rights receipt operations must be unique ACQUIRE/STORE/CACHE');
      }
      seen.add(operation);
      if (typeof permitted !== 'boolean') throw new Error('scheduled acquisition rights receipt permitted must be boolean');
      if (typeof state !== 'string' || !RIGHTS_STATE_SET.has(state)) {
        throw new Error('scheduled acquisition rights receipt state is invalid');
      }
      if (typeof reasonCode !== 'string' || !RIGHTS_REASON_SET.has(reasonCode)) {
        throw new Error('scheduled acquisition rights receipt reasonCode is invalid');
      }
      if (
        permitted !==
        ((state === 'ALLOW' && reasonCode === 'ALLOW') ||
          (state === 'CONDITIONAL' && reasonCode === 'CONDITIONAL_ALLOW'))
      ) {
        throw new Error('scheduled acquisition rights receipt permission is inconsistent');
      }
      return {
        operation: operation as ScheduledRightsOperation,
        permitted,
        state: state as RightsState,
        reasonCode: reasonCode as RightsReasonCode,
        cellId: parseNullableUuid(decision['cellId'], 'rights receipt cellId'),
        decisionId: parseNullableUuid(decision['decisionId'], 'rights receipt decisionId'),
        termsVersionId: parseNullableUuid(decision['termsVersionId'], 'rights receipt termsVersionId'),
      };
    });
    return {
      stage: stage as ScheduledRightsReceiptStage,
      evaluatedAt: toIso(evaluatedAt),
      decisions: parsedDecisions,
      checkpointIndex,
    };
  }).map(({ checkpointIndex: _checkpointIndex, ...checkpoint }) => checkpoint);
}

function mapRun(row: SqlRow): ScheduledAcquisitionRun {
  const receipt = toJson(row['rights_receipt']);
  const validators = toJson(row['validators']);
  const status = row['status'] as ScheduledAcquisitionStatus;
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
    status,
    outcome: (row['outcome'] ?? null) as ScheduledAcquisitionOutcome | null,
    failureCode: parseFailureCode(row['failure_code']),
    rightsReceipt: parseRightsReceipt(
      receipt,
      status === 'SUCCEEDED' || status === 'SKIPPED' || status === 'REFUSED',
    ),
    provider: parseProvider(row['provider']),
    validators: parseValidators(validators),
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
    const provider = parseProvider(input.provider);
    if (provider === null) throw new Error('scheduled acquisition completion requires a provider');
    const validators = parseValidators(input.validators);
    const rightsReceipt = parseRightsReceipt(input.rightsReceipt, true);
    if (input.outcome === 'NOT_MODIFIED' && input.artifacts.length !== 0) {
      throw new Error('NOT_MODIFIED cannot carry artifacts');
    }
    if (input.outcome === 'NOT_MODIFIED' && Object.keys(validators).length === 0) {
      throw new Error('NOT_MODIFIED requires at least one typed nonempty validator');
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

      if (input.outcome === 'NOT_MODIFIED') {
        const prior = await tx.query(
          `SELECT 1
             FROM scheduled_acquisition_runs prior
            WHERE prior.id <> $1
              AND prior.source_id = $2
              AND prior.target_id = $3
              AND prior.target_url = $4
              AND prior.acquisition_route = $5
              AND prior.account_or_product_plan IS NOT DISTINCT FROM $6
              AND prior.acquisition_jurisdiction IS NOT DISTINCT FROM $7
              AND prior.asset_class = $8
              AND prior.output_class = $9
              AND prior.runtime_digest = $10
              AND prior.status = 'SUCCEEDED'
              AND prior.outcome = 'FETCHED'
              AND prior.artifact_count > 0
              AND EXISTS (
                SELECT 1 FROM scheduled_acquisition_run_artifacts link WHERE link.run_id = prior.id
              )
            LIMIT 1`,
          [
            run.id, run.sourceId, run.targetId, run.targetUrl, run.acquisitionRoute,
            run.accountOrProductPlan, run.jurisdiction, run.assetClass, run.outputClass,
            run.runtimeDigest,
          ],
        );
        if (prior.length === 0) {
          throw new Error(
            'NOT_MODIFIED requires a prior artifact-backed FETCHED success for the exact scope and runtime',
          );
        }
      }

      for (const [ordinal, artifactInput] of input.artifacts.entries()) {
        if (artifactInput.source_id !== run.sourceId) {
          throw new Error('scheduled acquisition artifact source does not match the run source');
        }
        if (artifactInput.acquisition_provider !== provider) {
          throw new Error(
            'scheduled acquisition artifact provider does not match the completion provider',
          );
        }
        if (
          artifactInput.url !== run.targetUrl ||
          artifactInput.acquisition_route !== run.acquisitionRoute ||
          artifactInput.account_or_product_plan !== run.accountOrProductPlan ||
          artifactInput.acquisition_jurisdiction !== run.jurisdiction
        ) {
          throw new Error(
            'scheduled acquisition artifact target or acquisition scope does not match the run',
          );
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
          run.id, input.outcome, input.completedAt, input.freshAt, provider,
          JSON.stringify(validators), JSON.stringify(rightsReceipt), input.artifacts.length,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error(`scheduled acquisition run ${input.runId} did not complete`);
      return mapRun(row);
    });
  }

  async fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun> {
    if (!FAILURE_CODES.has(input.failureCode)) {
      throw new Error('scheduled acquisition failure code is not enumerated');
    }
    const rightsReceipt = parseRightsReceipt(
      input.rightsReceipt,
      input.status === 'REFUSED' || input.status === 'SKIPPED',
    );
    const provider = parseProvider(input.provider ?? null);
    const rows = await this.driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = $2, outcome = $3, failure_code = $4, completed_at = $5,
              rights_receipt = $6::jsonb, provider = $7
        WHERE id = $1 AND status = 'CLAIMED'
        RETURNING ${RUN_COLUMNS}`,
      [
        input.runId, input.status, input.outcome, input.failureCode, input.completedAt,
        JSON.stringify(rightsReceipt), provider,
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

  async latestSuccessAt(scope: ScheduledAcquisitionFreshnessScope): Promise<IsoDateTime | null> {
    const rows = await this.driver.query(
      `SELECT fresh_at FROM scheduled_acquisition_runs
        WHERE source_id = $1 AND target_id = $2 AND target_url = $3
          AND acquisition_route = $4
          AND account_or_product_plan IS NOT DISTINCT FROM $5
          AND acquisition_jurisdiction IS NOT DISTINCT FROM $6
          AND asset_class = $7 AND output_class = $8
          AND runtime_digest = $9
          AND status = 'SUCCEEDED'
        ORDER BY fresh_at DESC LIMIT 1`,
      [
        scope.sourceId, scope.targetId, scope.targetUrl, scope.acquisitionRoute,
        scope.accountOrProductPlan, scope.jurisdiction, scope.assetClass,
        scope.outputClass, scope.runtimeDigest,
      ],
    );
    return rows[0] === undefined ? null : toIso(rows[0]['fresh_at']);
  }
}

export function createScheduledAcquisitionStore(driver: SqlDriver): ScheduledAcquisitionStore {
  return new PostgresScheduledAcquisitionStore(driver);
}
