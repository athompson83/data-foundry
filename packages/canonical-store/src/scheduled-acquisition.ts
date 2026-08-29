import type {
  AcquisitionMethod,
  IsoDateTime,
  RightsAssetClass,
  RightsOutputClass,
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
export type AcquisitionAssetClass = RightsAssetClass;
export type AcquisitionOutputClass = RightsOutputClass;

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

export type ScheduledRightsReceiptStage =
  | 'INITIAL'
  | 'PRE_PROVIDER'
  | 'PRE_TRANSPORT'
  | 'PRE_PERSISTENCE';
export type ScheduledRightsReceiptBasis = 'ADMITTED' | 'RIGHTS_REFUSED' | 'NOT_DUE';
export type ScheduledRightsOperation = 'ACQUIRE' | 'STORE' | 'CACHE';
export type ScheduledRightsReceiptContractVersion = 1 | 2;
export const CURRENT_SCHEDULED_RIGHTS_RECEIPT_CONTRACT_VERSION = 2 as const;

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
  readonly basis: ScheduledRightsReceiptBasis;
  /** SHA-256 of the immutable run identity, target scope, slot, and fixed rights request. */
  readonly scopeDigest: string;
  readonly evaluatedAt: IsoDateTime;
  readonly decisions: readonly ScheduledRightsDecisionReceipt[];
}

export type ScheduledAcquisitionResultRelation = 'TARGET' | 'CHILD_RESOURCE';

export interface ScheduledAcquisitionResultUrlPolicy {
  readonly allowedOrigins: readonly string[];
  readonly allowedPathPrefixes: readonly string[];
}

/**
 * One provider result explicitly associated with the claimed target.
 * `retrievalKey` identifies the per-fetch R2 retrieval record; the canonical
 * artifact row may retain metadata from an earlier deduplicated retrieval.
 */
export interface ScheduledAcquisitionArtifactCompletion {
  readonly artifact: SourceArtifactInsert;
  readonly retrievalKey: string;
  readonly resultRelation: ScheduledAcquisitionResultRelation;
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
  readonly resultUrlPolicy: ScheduledAcquisitionResultUrlPolicy;
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
  readonly resultUrlPolicy: ScheduledAcquisitionResultUrlPolicy;
  readonly scheduledFor: IsoDateTime;
  readonly claimedAt: IsoDateTime;
  readonly completedAt: IsoDateTime | null;
  readonly freshAt: IsoDateTime | null;
  readonly status: ScheduledAcquisitionStatus;
  readonly outcome: ScheduledAcquisitionOutcome | null;
  readonly failureCode: ScheduledAcquisitionFailureCode | null;
  readonly rightsReceipt: readonly ScheduledRightsReceipt[];
  readonly rightsReceiptContractVersion: ScheduledRightsReceiptContractVersion;
  readonly provider: ScheduledAcquisitionProvider | null;
  readonly validators: ScheduledAcquisitionValidators;
  readonly expectedArtifactCount: number;
  readonly artifactCount: number;
  readonly runtimeDigest: string;
  readonly rightsScopeDigest: string;
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
  readonly resultUrlPolicy: ScheduledAcquisitionResultUrlPolicy;
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
  readonly artifacts: readonly ScheduledAcquisitionArtifactCompletion[];
}

interface ScheduledAcquisitionFailureBase {
  readonly runId: string;
  readonly completedAt: IsoDateTime;
  readonly rightsReceipt: readonly ScheduledRightsReceipt[];
}

export type ScheduledAcquisitionFailure =
  | (ScheduledAcquisitionFailureBase & {
      readonly status: 'SKIPPED';
      readonly outcome: null;
      readonly failureCode: 'NOT_DUE';
      readonly provider?: null;
    })
  | (ScheduledAcquisitionFailureBase & {
      readonly status: 'REFUSED';
      readonly outcome: null;
      readonly failureCode: 'RIGHTS_REFUSED';
      readonly provider?: null;
    })
  | (ScheduledAcquisitionFailureBase & {
      readonly status: 'FAILED';
      readonly outcome: 'EMPTY';
      readonly failureCode: 'EMPTY_RESPONSE';
      readonly provider: ScheduledAcquisitionProvider;
    })
  | (ScheduledAcquisitionFailureBase & {
      readonly status: 'FAILED';
      readonly outcome: null;
      readonly failureCode: Exclude<
        ScheduledAcquisitionFailureCode,
        'NOT_DUE' | 'RIGHTS_REFUSED' | 'EMPTY_RESPONSE'
      >;
      readonly provider?: ScheduledAcquisitionProvider | null;
    });

export interface ScheduledAcquisitionStore {
  claim(input: ScheduledAcquisitionClaim): Promise<ScheduledAcquisitionRun | null>;
  complete(input: ScheduledAcquisitionCompletion): Promise<ScheduledAcquisitionRun>;
  fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun>;
  get(runId: string): Promise<ScheduledAcquisitionRun | null>;
  latestSuccess(scope: ScheduledAcquisitionFreshnessScope): Promise<ScheduledAcquisitionRun | null>;
  latestSuccessAt(scope: ScheduledAcquisitionFreshnessScope): Promise<IsoDateTime | null>;
}

const RUN_COLUMNS = `id, idempotency_key, vertical_slug, source_id, source_key, target_id,
  target_url, acquisition_route, account_or_product_plan, acquisition_jurisdiction,
  asset_class, output_class, result_url_policy, scheduled_for, claimed_at, completed_at, fresh_at, status,
  outcome, failure_code, rights_receipt, rights_receipt_contract_version, provider, validators, expected_artifact_count,
  artifact_count, runtime_digest, rights_scope_digest`;

const PROVIDERS = new Set<string>(SCHEDULED_ACQUISITION_PROVIDERS);
const FAILURE_CODES = new Set<string>(SCHEDULED_ACQUISITION_FAILURE_CODES);
const RIGHTS_STATE_SET = new Set<string>(RIGHTS_STATES);
const RIGHTS_REASON_SET = new Set<string>(RIGHTS_REASON_CODES);
const RECEIPT_STAGES = new Set<string>([
  'INITIAL',
  'PRE_PROVIDER',
  'PRE_TRANSPORT',
  'PRE_PERSISTENCE',
]);
const RECEIPT_BASES = new Set<string>(['ADMITTED', 'RIGHTS_REFUSED', 'NOT_DUE']);
const RECEIPT_OPERATIONS = new Set<string>(['ACQUIRE', 'STORE', 'CACHE']);
const RECEIPT_STAGE_ORDER = [
  'INITIAL',
  'PRE_PROVIDER',
  'PRE_TRANSPORT',
  'PRE_PERSISTENCE',
] as const;
const RECEIPT_OPERATION_ORDER = ['ACQUIRE', 'STORE', 'CACHE'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const ISO_UTC = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const RETRIEVAL_KEY = /^[a-z0-9][a-z0-9._/-]{0,2047}$/;
const ENCODED_PATH_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i;
const CANONICAL_HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::([1-9][0-9]{0,4}))?$/;

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

function parseRetrievalKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !RETRIEVAL_KEY.test(value) ||
    value.split('/').includes('..')
  ) {
    throw new Error('scheduled acquisition retrieval key is invalid');
  }
  return value;
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

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return (
    pathname === prefix ||
    (prefix.endsWith('/') && pathname.startsWith(prefix)) ||
    (!prefix.endsWith('/') && pathname.startsWith(`${prefix}/`))
  );
}

function isCanonicalHttpsOrigin(value: string): boolean {
  const match = CANONICAL_HTTPS_ORIGIN.exec(value);
  if (match === null) return false;
  const explicitPort = match[1];
  if (explicitPort !== undefined) {
    const port = Number(explicitPort);
    if (port > 65_535 || port === 443) return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.pathname === '/' && parsed.search === '' &&
      parsed.hash === '' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

function parseResultUrlPolicy(
  value: unknown,
  targetUrl: string,
): ScheduledAcquisitionResultUrlPolicy {
  if (!isRecord(value)) throw new Error('scheduled acquisition result URL policy must be an object');
  exactKeys(
    value,
    ['allowedOrigins', 'allowedPathPrefixes'],
    'scheduled acquisition result URL policy',
  );
  const origins = value['allowedOrigins'];
  const prefixes = value['allowedPathPrefixes'];
  if (!Array.isArray(origins) || origins.length !== 1) {
    throw new Error('scheduled acquisition result URL policy requires exactly one origin');
  }
  if (!Array.isArray(prefixes) || prefixes.length < 1 || prefixes.length > 32) {
    throw new Error('scheduled acquisition result URL policy requires 1-32 path prefixes');
  }
  const allowedOrigins = origins.map((origin) => {
    if (typeof origin !== 'string' || !isCanonicalHttpsOrigin(origin)) {
      throw new Error('scheduled acquisition allowed origin must be a lowercase HTTPS origin');
    }
    return origin;
  });
  const allowedPathPrefixes = prefixes.map((prefix) => {
    if (
      typeof prefix !== 'string' ||
      !prefix.startsWith('/') ||
      prefix.includes('?') ||
      prefix.includes('#') ||
      prefix.includes('\\') ||
      ENCODED_PATH_SEPARATOR_OR_DOT.test(prefix) ||
      prefix.split('/').includes('..')
    ) {
      throw new Error('scheduled acquisition allowed path prefix is invalid');
    }
    return prefix;
  });
  if (
    new Set(allowedOrigins).size !== allowedOrigins.length ||
    new Set(allowedPathPrefixes).size !== allowedPathPrefixes.length
  ) {
    throw new Error('scheduled acquisition result URL policy entries must be unique');
  }
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new Error('scheduled acquisition result URL policy target is invalid');
  }
  if (
    target.protocol !== 'https:' ||
    target.username !== '' ||
    target.password !== '' ||
    target.hash !== '' ||
    targetUrl.includes('\\') ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(targetUrl) ||
    !allowedOrigins.includes(target.origin) ||
    !allowedPathPrefixes.some((prefix) => pathMatchesPrefix(target.pathname, prefix))
  ) {
    throw new Error('scheduled acquisition result URL policy does not cover its target');
  }
  return { allowedOrigins, allowedPathPrefixes };
}

function resultUrlAllowed(
  policy: ScheduledAcquisitionResultUrlPolicy,
  targetUrl: string,
  acquisitionRoute: AcquisitionMethod,
  resultUrl: string,
  relation: ScheduledAcquisitionResultRelation,
): boolean {
  let result: URL;
  try {
    result = new URL(resultUrl);
  } catch {
    return false;
  }
  if (
    result.protocol !== 'https:' ||
    result.username !== '' ||
    result.password !== '' ||
    result.hash !== '' ||
    resultUrl.includes('\\') ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(resultUrl)
  ) return false;
  if (relation === 'TARGET' && resultUrl !== targetUrl) return false;
  if (
    relation === 'CHILD_RESOURCE' &&
    (resultUrl === targetUrl ||
      (acquisitionRoute !== 'BROWSER_RUN' && acquisitionRoute !== 'CRAWL4AI'))
  ) {
    return false;
  }
  return (
    policy.allowedOrigins.includes(result.origin) &&
    policy.allowedPathPrefixes.some((prefix) => pathMatchesPrefix(result.pathname, prefix))
  );
}

function parseNullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} must be a UUID or null`);
  return value;
}

function parseCanonicalIso(value: unknown, label: string): IsoDateTime {
  if (
    typeof value !== 'string' ||
    !ISO_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical UTC ISO timestamp`);
  }
  return value as IsoDateTime;
}

function stateReasonValid(state: RightsState, reason: RightsReasonCode): boolean {
  switch (state) {
    case 'DENY':
      return ['SOURCE_PROHIBITED', 'KILL_SWITCH_ENGAGED', 'SOURCE_STATUS_BLOCKED',
        'RIGHTS_CLASSIFICATION_BLOCKED', 'STICKY_DENY'].includes(reason);
    case 'UNKNOWN':
      return ['NO_GRANT', 'EXPLICIT_UNKNOWN', 'MISSING_PROVENANCE', 'MALFORMED_SNAPSHOT',
        'PUBLISHER_UNMAPPED', 'AMBIGUOUS_SCOPE'].includes(reason);
    case 'NOT_APPLICABLE':
      return reason === 'NOT_APPLICABLE';
    case 'ALLOW':
      return ['ALLOW', 'TERMS_MISSING', 'TERMS_NOT_CURRENT', 'TERMS_REVOKED',
        'TERMS_NOT_EFFECTIVE', 'TERMS_VERSION_INVALID', 'TERMS_SCOPE_MISMATCH',
        'DECISION_NOT_EFFECTIVE', 'REVIEW_DUE', 'AUTOMATED_PERMISSION',
        'PERMISSION_REVIEW_INVALID', 'ACTIVATION_INVALID', 'CONDITION_MISSING',
        'UNKNOWN_CONDITION_EVALUATOR', 'CONDITION_UNMET', 'CONDITION_AUDIT_MISSING',
        'CONDITION_RECEIPT_INVALID', 'CONDITION_RECEIPT_STALE'].includes(reason);
    case 'CONDITIONAL':
      return ['CONDITIONAL_ALLOW', 'TERMS_MISSING', 'TERMS_NOT_CURRENT', 'TERMS_REVOKED',
        'TERMS_NOT_EFFECTIVE', 'TERMS_VERSION_INVALID', 'TERMS_SCOPE_MISMATCH',
        'DECISION_NOT_EFFECTIVE', 'REVIEW_DUE', 'AUTOMATED_PERMISSION',
        'PERMISSION_REVIEW_INVALID', 'ACTIVATION_INVALID', 'CONDITION_MISSING',
        'UNKNOWN_CONDITION_EVALUATOR', 'CONDITION_UNMET', 'CONDITION_AUDIT_MISSING',
        'CONDITION_RECEIPT_INVALID', 'CONDITION_RECEIPT_STALE'].includes(reason);
  }
}

function parseRightsReceiptShape(value: unknown): readonly ScheduledRightsReceipt[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new Error('scheduled acquisition rights receipt must contain 0-4 trusted checkpoints');
  }
  return value.map((checkpoint) => {
    if (!isRecord(checkpoint)) throw new Error('scheduled acquisition rights receipt checkpoint must be an object');
    exactKeys(
      checkpoint,
      ['stage', 'basis', 'scopeDigest', 'evaluatedAt', 'decisions'],
      'scheduled acquisition rights receipt',
    );
    const stage = checkpoint['stage'];
    const basis = checkpoint['basis'];
    const scopeDigest = checkpoint['scopeDigest'];
    const evaluatedAt = checkpoint['evaluatedAt'];
    const decisions = checkpoint['decisions'];
    if (typeof stage !== 'string' || !RECEIPT_STAGES.has(stage)) {
      throw new Error('scheduled acquisition rights receipt stage is invalid');
    }
    if (typeof basis !== 'string' || !RECEIPT_BASES.has(basis)) {
      throw new Error('scheduled acquisition rights receipt basis is invalid');
    }
    if (typeof scopeDigest !== 'string' || !CONTENT_HASH.test(scopeDigest)) {
      throw new Error('scheduled acquisition rights receipt scopeDigest must be a SHA-256 digest');
    }
    if (!Array.isArray(decisions) || decisions.length !== 3) {
      throw new Error('scheduled acquisition rights receipt requires ACQUIRE, STORE, and CACHE decisions');
    }
    const parsedDecisions = decisions.map((decision, decisionIndex) => {
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
      if (
        typeof operation !== 'string' ||
        !RECEIPT_OPERATIONS.has(operation) ||
        operation !== RECEIPT_OPERATION_ORDER[decisionIndex]
      ) {
        throw new Error('scheduled acquisition rights receipt operations must be ordered ACQUIRE/STORE/CACHE');
      }
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
      if (!stateReasonValid(state as RightsState, reasonCode as RightsReasonCode)) {
        throw new Error('scheduled acquisition rights receipt state and reason are inconsistent');
      }
      const cellId = parseNullableUuid(decision['cellId'], 'rights receipt cellId');
      const decisionId = parseNullableUuid(decision['decisionId'], 'rights receipt decisionId');
      const termsVersionId = parseNullableUuid(
        decision['termsVersionId'],
        'rights receipt termsVersionId',
      );
      if (permitted && (cellId === null || decisionId === null || termsVersionId === null)) {
        throw new Error('permitted rights receipt decisions require cell, decision, and terms provenance');
      }
      return {
        operation: operation as ScheduledRightsOperation,
        permitted,
        state: state as RightsState,
        reasonCode: reasonCode as RightsReasonCode,
        cellId,
        decisionId,
        termsVersionId,
      };
    });
    return {
      stage: stage as ScheduledRightsReceiptStage,
      basis: basis as ScheduledRightsReceiptBasis,
      scopeDigest,
      evaluatedAt: parseCanonicalIso(
        evaluatedAt,
        'scheduled acquisition rights receipt evaluatedAt',
      ),
      decisions: parsedDecisions,
    };
  });
}

interface RightsReceiptContext {
  readonly status: ScheduledAcquisitionStatus;
  readonly rightsScopeDigest: string;
  readonly claimedAt: IsoDateTime;
  readonly completedAt: IsoDateTime | null;
  readonly contractVersion: ScheduledRightsReceiptContractVersion;
}

function parseRightsReceipt(
  value: unknown,
  context: RightsReceiptContext,
): readonly ScheduledRightsReceipt[] {
  const receipt = parseRightsReceiptShape(value);
  const expectedCheckpointCount = context.contractVersion === 1 ? 3 : 4;
  if (receipt.length > expectedCheckpointCount) {
    throw new Error(
      `scheduled acquisition receipt contract v${context.contractVersion} allows at most ` +
        `${expectedCheckpointCount} checkpoints`,
    );
  }
  if (context.status === 'CLAIMED') {
    if (receipt.length !== 0) {
      throw new Error('a claimed scheduled acquisition must have an empty rights receipt');
    }
    return receipt;
  }
  if (context.completedAt === null) {
    throw new Error('a terminal scheduled acquisition requires a completion timestamp');
  }

  const claimedAt = Date.parse(context.claimedAt);
  const completedAt = Date.parse(context.completedAt);
  let previousEvaluatedAt = claimedAt;
  for (const [index, checkpoint] of receipt.entries()) {
    if (checkpoint.stage !== RECEIPT_STAGE_ORDER[index]) {
      throw new Error('scheduled acquisition rights receipt checkpoints must be an ordered stage prefix');
    }
    if (checkpoint.scopeDigest !== context.rightsScopeDigest) {
      throw new Error('scheduled acquisition rights receipt scope does not match the immutable claim');
    }
    const evaluatedAt = Date.parse(checkpoint.evaluatedAt);
    if (
      evaluatedAt < claimedAt ||
      evaluatedAt > completedAt ||
      evaluatedAt < previousEvaluatedAt
    ) {
      throw new Error('scheduled acquisition rights receipt checkpoint times are out of order');
    }
    previousEvaluatedAt = evaluatedAt;
  }

  const allPermitted = (checkpoint: ScheduledRightsReceipt): boolean =>
    checkpoint.decisions.every((decision) => decision.permitted);
  const admitted = (checkpoint: ScheduledRightsReceipt): boolean =>
    checkpoint.basis === 'ADMITTED' && allPermitted(checkpoint);

  switch (context.status) {
    case 'SUCCEEDED':
      if (receipt.length !== expectedCheckpointCount || !receipt.every(admitted)) {
        throw new Error(
          `successful scheduled acquisition receipt contract v${context.contractVersion} requires ` +
            `${expectedCheckpointCount} admitted, fully permitted checkpoints`,
        );
      }
      break;
    case 'SKIPPED':
      if (
        receipt.length !== 1 ||
        receipt[0]?.basis !== 'NOT_DUE' ||
        !allPermitted(receipt[0])
      ) {
        throw new Error('skipped scheduled acquisition requires an admitted INITIAL not-due basis');
      }
      break;
    case 'REFUSED': {
      const final = receipt.at(-1);
      if (
        receipt.length < 1 ||
        final === undefined ||
        !receipt.slice(0, -1).every(admitted) ||
        final.basis !== 'RIGHTS_REFUSED' ||
        allPermitted(final)
      ) {
        throw new Error(
          'refused scheduled acquisition requires an ordered admitted prefix and final refusal',
        );
      }
      break;
    }
    case 'FAILED':
      if (!receipt.every(admitted)) {
        throw new Error('failed scheduled acquisition receipts must be an admitted stage prefix');
      }
      break;
  }
  return receipt;
}

function mapRun(row: SqlRow): ScheduledAcquisitionRun {
  const receipt = toJson(row['rights_receipt']);
  const validators = toJson(row['validators']);
  const status = row['status'] as ScheduledAcquisitionStatus;
  const claimedAt = toIso(row['claimed_at']);
  const completedAt = toIsoOrNull(row['completed_at']);
  const rightsScopeDigest = String(row['rights_scope_digest']);
  const targetUrl = String(row['target_url']);
  const rightsReceiptContractVersion = toNumber(row['rights_receipt_contract_version']);
  if (rightsReceiptContractVersion !== 1 && rightsReceiptContractVersion !== 2) {
    throw new Error('scheduled acquisition rights receipt contract version is invalid');
  }
  return {
    id: String(row['id']),
    idempotencyKey: String(row['idempotency_key']),
    verticalSlug: String(row['vertical_slug']),
    sourceId: row['source_id'] as SourceId,
    sourceKey: String(row['source_key']),
    targetId: String(row['target_id']),
    targetUrl,
    acquisitionRoute: row['acquisition_route'] as AcquisitionMethod,
    accountOrProductPlan: row['account_or_product_plan'] === null ? null : String(row['account_or_product_plan']),
    jurisdiction: row['acquisition_jurisdiction'] === null ? null : String(row['acquisition_jurisdiction']),
    assetClass: row['asset_class'] as AcquisitionAssetClass,
    outputClass: row['output_class'] as AcquisitionOutputClass,
    resultUrlPolicy: parseResultUrlPolicy(toJson(row['result_url_policy']), targetUrl),
    scheduledFor: toIso(row['scheduled_for']),
    claimedAt,
    completedAt,
    freshAt: toIsoOrNull(row['fresh_at']),
    status,
    outcome: (row['outcome'] ?? null) as ScheduledAcquisitionOutcome | null,
    failureCode: parseFailureCode(row['failure_code']),
    rightsReceipt: parseRightsReceipt(receipt, {
      status,
      rightsScopeDigest,
      claimedAt,
      completedAt,
      contractVersion: rightsReceiptContractVersion,
    }),
    rightsReceiptContractVersion,
    provider: parseProvider(row['provider']),
    validators: parseValidators(validators),
    expectedArtifactCount: toNumber(row['expected_artifact_count']),
    artifactCount: toNumber(row['artifact_count']),
    runtimeDigest: String(row['runtime_digest']),
    rightsScopeDigest,
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
    const resultUrlPolicy = parseResultUrlPolicy(input.resultUrlPolicy, input.targetUrl);
    const scheduledFor = parseCanonicalIso(input.scheduledFor, 'scheduled acquisition scheduledFor');
    const claimedAt = parseCanonicalIso(input.claimedAt, 'scheduled acquisition claimedAt');
    const rows = await this.driver.query(
      `INSERT INTO scheduled_acquisition_runs
         (idempotency_key, vertical_slug, source_id, source_key, target_id, target_url,
          acquisition_route, account_or_product_plan, acquisition_jurisdiction,
          asset_class, output_class, result_url_policy, scheduled_for, claimed_at, runtime_digest,
          rights_receipt_contract_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)
       ON CONFLICT DO NOTHING
       RETURNING ${RUN_COLUMNS}`,
      [
        input.idempotencyKey, input.verticalSlug, input.sourceId, input.sourceKey,
        input.targetId, input.targetUrl, input.acquisitionRoute, input.accountOrProductPlan,
        input.jurisdiction, input.assetClass, input.outputClass, JSON.stringify(resultUrlPolicy),
        scheduledFor, claimedAt, input.runtimeDigest,
        CURRENT_SCHEDULED_RIGHTS_RECEIPT_CONTRACT_VERSION,
      ],
    );
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async complete(input: ScheduledAcquisitionCompletion): Promise<ScheduledAcquisitionRun> {
    const provider = parseProvider(input.provider);
    if (provider === null) throw new Error('scheduled acquisition completion requires a provider');
    const validators = parseValidators(input.validators);
    const completedAt = parseCanonicalIso(input.completedAt, 'scheduled acquisition completedAt');
    const freshAt = parseCanonicalIso(input.freshAt, 'scheduled acquisition freshAt');
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
      if (
        Date.parse(completedAt) < Date.parse(run.claimedAt) ||
        Date.parse(freshAt) < Date.parse(run.claimedAt) ||
        Date.parse(freshAt) > Date.parse(completedAt)
      ) {
        throw new Error('scheduled acquisition completion and freshness timestamps are out of order');
      }
      const rightsReceipt = parseRightsReceipt(input.rightsReceipt, {
        status: 'SUCCEEDED',
        rightsScopeDigest: run.rightsScopeDigest,
        claimedAt: run.claimedAt,
        completedAt,
        contractVersion: run.rightsReceiptContractVersion,
      });

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
              AND prior.result_url_policy = $11::jsonb
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
            run.runtimeDigest, JSON.stringify(run.resultUrlPolicy),
          ],
        );
        if (prior.length === 0) {
          throw new Error(
            'NOT_MODIFIED requires a prior artifact-backed FETCHED success for the exact scope and runtime',
          );
        }
      }

      for (const [ordinal, result] of input.artifacts.entries()) {
        const artifactInput = result.artifact;
        const retrievalKey = parseRetrievalKey(result.retrievalKey);
        if (artifactInput.source_id !== run.sourceId) {
          throw new Error('scheduled acquisition artifact source does not match the run source');
        }
        if (artifactInput.acquisition_provider !== provider) {
          throw new Error(
            'scheduled acquisition artifact provider does not match the completion provider',
          );
        }
        if (
          artifactInput.acquisition_route !== run.acquisitionRoute ||
          artifactInput.account_or_product_plan !== run.accountOrProductPlan ||
          artifactInput.acquisition_jurisdiction !== run.jurisdiction
        ) {
          throw new Error(
            'scheduled acquisition artifact target or acquisition scope does not match the run',
          );
        }
        if (
          (result.resultRelation !== 'TARGET' && result.resultRelation !== 'CHILD_RESOURCE') ||
          !resultUrlAllowed(
            run.resultUrlPolicy,
            run.targetUrl,
            run.acquisitionRoute,
            artifactInput.url,
            result.resultRelation,
          )
        ) {
          throw new Error(
            'scheduled acquisition result is not explicitly associated with the claimed target',
          );
        }
        const persisted = await persistArtifact(tx, artifactInput);
        await tx.query(
          `INSERT INTO scheduled_acquisition_run_artifacts
             (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
              retrieval_key, acquisition_provider)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            run.id, persisted.id, ordinal, run.targetUrl, artifactInput.url,
            result.resultRelation, retrievalKey, provider,
          ],
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
          run.id, input.outcome, completedAt, freshAt, provider,
          JSON.stringify(validators), JSON.stringify(rightsReceipt), input.artifacts.length,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error(`scheduled acquisition run ${input.runId} did not complete`);
      return mapRun(row);
    });
  }

  async fail(input: ScheduledAcquisitionFailure): Promise<ScheduledAcquisitionRun> {
    const failureCode = parseFailureCode(input.failureCode);
    if (failureCode === null) {
      throw new Error('scheduled acquisition failure code is not enumerated');
    }
    if (
      (input.status === 'SKIPPED' &&
        (input.outcome !== null || failureCode !== 'NOT_DUE' || input.provider != null)) ||
      (input.status === 'REFUSED' &&
        (input.outcome !== null || failureCode !== 'RIGHTS_REFUSED' || input.provider != null)) ||
      (input.status === 'FAILED' && input.outcome === 'EMPTY' &&
        (failureCode !== 'EMPTY_RESPONSE' || input.provider == null)) ||
      (input.status === 'FAILED' && input.outcome === null &&
        (failureCode === 'NOT_DUE' || failureCode === 'RIGHTS_REFUSED' ||
          failureCode === 'EMPTY_RESPONSE')) ||
      (input.status !== 'SKIPPED' && input.status !== 'REFUSED' && input.status !== 'FAILED')
    ) {
      throw new Error('scheduled acquisition failure status, outcome, and code are inconsistent');
    }
    const completedAt = parseCanonicalIso(input.completedAt, 'scheduled acquisition completedAt');
    const provider = parseProvider(input.provider ?? null);
    return this.driver.transaction(async (tx) => {
      const locked = await tx.query(
        `SELECT ${RUN_COLUMNS} FROM scheduled_acquisition_runs WHERE id = $1 FOR UPDATE`,
        [input.runId],
      );
      const current = locked[0];
      if (current === undefined) {
        throw new Error(`scheduled acquisition run ${input.runId} was not found`);
      }
      const run = mapRun(current);
      if (run.status !== 'CLAIMED') {
        throw new Error(`scheduled acquisition run ${input.runId} is already terminal`);
      }
      if (Date.parse(completedAt) < Date.parse(run.claimedAt)) {
        throw new Error('scheduled acquisition completion timestamp precedes its claim');
      }
      const rightsReceipt = parseRightsReceipt(input.rightsReceipt, {
        status: input.status,
        rightsScopeDigest: run.rightsScopeDigest,
        claimedAt: run.claimedAt,
        completedAt,
        contractVersion: run.rightsReceiptContractVersion,
      });
      const rows = await tx.query(
        `UPDATE scheduled_acquisition_runs
            SET status = $2, outcome = $3, failure_code = $4, completed_at = $5,
                rights_receipt = $6::jsonb, provider = $7
          WHERE id = $1 AND status = 'CLAIMED'
          RETURNING ${RUN_COLUMNS}`,
        [
          input.runId, input.status, input.outcome, failureCode, completedAt,
          JSON.stringify(rightsReceipt), provider,
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`scheduled acquisition run ${input.runId} was not found or is terminal`);
      }
      return mapRun(row);
    });
  }

  async get(runId: string): Promise<ScheduledAcquisitionRun | null> {
    const rows = await this.driver.query(`SELECT ${RUN_COLUMNS} FROM scheduled_acquisition_runs WHERE id = $1`, [runId]);
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async latestSuccess(scope: ScheduledAcquisitionFreshnessScope): Promise<ScheduledAcquisitionRun | null> {
    const rows = await this.driver.query(
      `SELECT ${RUN_COLUMNS} FROM scheduled_acquisition_runs
        WHERE source_id = $1 AND target_id = $2 AND target_url = $3
          AND acquisition_route = $4
          AND account_or_product_plan IS NOT DISTINCT FROM $5
          AND acquisition_jurisdiction IS NOT DISTINCT FROM $6
          AND asset_class = $7 AND output_class = $8
          AND runtime_digest = $9
          AND result_url_policy = $10::jsonb
          AND status = 'SUCCEEDED'
        ORDER BY fresh_at DESC LIMIT 1`,
      [
        scope.sourceId, scope.targetId, scope.targetUrl, scope.acquisitionRoute,
        scope.accountOrProductPlan, scope.jurisdiction, scope.assetClass,
        scope.outputClass, scope.runtimeDigest,
        JSON.stringify(parseResultUrlPolicy(scope.resultUrlPolicy, scope.targetUrl)),
      ],
    );
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async latestSuccessAt(scope: ScheduledAcquisitionFreshnessScope): Promise<IsoDateTime | null> {
    return (await this.latestSuccess(scope))?.freshAt ?? null;
  }
}

export function createScheduledAcquisitionStore(driver: SqlDriver): ScheduledAcquisitionStore {
  return new PostgresScheduledAcquisitionStore(driver);
}
