import { toIso } from './rows.js';
import type { SqlDriver, SqlExecutor, SqlTransactionExecutor } from './sql-driver.js';

export interface IngestionEnvelope { readonly version: 1; readonly deliveryId: string }
export interface IngestionQueue { send(body: IngestionEnvelope): Promise<void> }
export const INGESTION_LEASE_MS = 10 * 60_000;
export const INGESTION_MAX_ATTEMPTS = 5;
export class IngestionOwnershipError extends Error {
  constructor() { super('INGESTION_OWNERSHIP_LOST'); this.name = 'IngestionOwnershipError'; }
}
export class IngestionSupersededError extends Error {
  readonly code = 'RUNTIME_MISMATCH' as const;
  constructor() { super('INGESTION_RUNTIME_SUPERSEDED'); this.name = 'IngestionSupersededError'; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseIngestionEnvelope(value: unknown): IngestionEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(',') === 'deliveryId,version' && row['version'] === 1 &&
    typeof row['deliveryId'] === 'string' && uuid.test(row['deliveryId'])
    ? { version: 1, deliveryId: row['deliveryId'] } : null;
}

/** Used by acquisition completion within its existing transaction; also permits explicit replay. */
export async function enqueueIngestionDelivery(tx: SqlExecutor, input: {
  readonly acquisitionRunId: string; readonly artifactRunId: string;
  readonly runtimeDigest: string; readonly workKind: 'PROCESS_ARTIFACTS' | 'VERIFY_UNCHANGED';
}): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(input.runtimeDigest)) throw new Error('INGESTION_RUNTIME_DIGEST_INVALID');
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO ingestion_deliveries (acquisition_run_id, artifact_run_id, runtime_digest, work_kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (acquisition_run_id, runtime_digest, work_kind) DO NOTHING RETURNING id`,
    [input.acquisitionRunId, input.artifactRunId, input.runtimeDigest, input.workKind]);
  if (rows[0]) return rows[0].id;
  const existing = await tx.query<{ id: string }>(`SELECT id FROM ingestion_deliveries
    WHERE acquisition_run_id = $1 AND runtime_digest = $2 AND work_kind = $3 AND artifact_run_id = $4`,
    [input.acquisitionRunId, input.runtimeDigest, input.workKind, input.artifactRunId]);
  if (!existing[0]) throw new Error('INGESTION_IDENTITY_CONFLICT');
  return existing[0].id;
}

export interface IngestionClaim {
  readonly id: string; readonly token: string; readonly attempt: number;
  readonly acquisitionRunId: string; readonly artifactRunId: string;
  readonly runtimeDigest: string; readonly workKind: 'PROCESS_ARTIFACTS' | 'VERIFY_UNCHANGED';
  readonly leaseExpiresAt: string;
}
export type IngestionClaimResult =
  | { readonly disposition: 'ACQUIRED'; readonly claim: IngestionClaim }
  | { readonly disposition: 'ACTIVE' | 'TERMINAL' | 'MISSING' | 'INCOMPATIBLE' };
export type IngestionFailureCode = 'INPUT_REFUSED' | 'RIGHTS_REFUSED' | 'RUNTIME_MISMATCH' | 'RETRY_EXHAUSTED' | 'PROCESSING_ERROR';

/** A later explicit processing request must have published this exact manifest
 * and covered the older acquisition's verification time before it can retire it. */
async function hasPublishedReplacement(tx: SqlExecutor, id: string): Promise<boolean> {
  const rows = await tx.query(`SELECT 1 FROM ingestion_deliveries original
    JOIN scheduled_acquisition_runs acquisition ON acquisition.id=original.acquisition_run_id
    JOIN ingestion_deliveries replacement ON replacement.artifact_run_id=original.artifact_run_id
    WHERE original.id=$1 AND replacement.runtime_digest<>original.runtime_digest
      AND replacement.created_at>original.created_at AND replacement.status='PUBLISHED'
      AND replacement.verified_at>=acquisition.fresh_at LIMIT 1`, [id]);
  return rows.length > 0;
}

export class IngestionDeliveryStore {
  constructor(readonly driver: SqlDriver) {}

  async dispatch(queue: IngestionQueue, limit = 50): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INGESTION_DISPATCH_LIMIT');
    const rows = await this.driver.query<{ id: string }>(
      `SELECT id FROM ingestion_deliveries
       WHERE (status = 'QUEUED' OR (status = 'PROCESSING' AND lease_expires_at <= statement_timestamp()))
         AND (dispatched_at IS NULL OR dispatched_at <= statement_timestamp() - interval '5 minutes')
       ORDER BY created_at, id LIMIT $1`, [limit]);
    for (const row of rows) {
      // Acceptance first, checkpoint second. A crash between them only duplicates an opaque id.
      await queue.send({ version: 1, deliveryId: row.id });
      await this.driver.query(`UPDATE ingestion_deliveries SET dispatched_at = statement_timestamp(),
        dispatch_attempt = dispatch_attempt + 1 WHERE id = $1`, [row.id]);
    }
    return rows.length;
  }

  async claim(id: string, expectedRuntimeDigest?: string): Promise<IngestionClaimResult> {
    if (!uuid.test(id)) return { disposition: 'MISSING' };
    return this.driver.transaction(async tx => {
      const rows = await tx.query(`SELECT *,clock_timestamp() AS checked_at FROM ingestion_deliveries WHERE id = $1 FOR UPDATE`, [id]);
      const row = rows[0];
      if (!row) return { disposition: 'MISSING' };
      if (['PUBLISHED', 'REFUSED', 'FAILED'].includes(String(row['status']))) return { disposition: 'TERMINAL' };
      // A replacement must never steal an active processing lease. Its owner
      // performs the same publication check under its own fence below.
      if (row['status'] === 'PROCESSING' && toIso(row['lease_expires_at']) > toIso(row['checked_at'])) {
        return { disposition: expectedRuntimeDigest !== undefined && row['runtime_digest'] !== expectedRuntimeDigest ? 'INCOMPATIBLE' : 'ACTIVE' };
      }
      if (await hasPublishedReplacement(tx, id)) {
        await tx.query(`UPDATE ingestion_deliveries SET status='REFUSED',failure_code='RUNTIME_MISMATCH',
          completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE id=$1
          AND (status='QUEUED' OR (status='PROCESSING' AND lease_expires_at<=clock_timestamp()))`, [id]);
        return { disposition: 'TERMINAL' };
      }
      // During a rolling deployment an old consumer must not exhaust or refuse new-runtime work.
      if (expectedRuntimeDigest !== undefined && row['runtime_digest'] !== expectedRuntimeDigest) {
        if (row['work_kind'] === 'VERIFY_UNCHANGED') {
          // Re-use the immutable 304 observation only after this consumer's
          // replacement processing baseline has succeeded. It still needs the
          // normal rights/freshness checks before the older event is retired.
          const baseline = await tx.query(`SELECT 1 FROM ingestion_deliveries replacement
            WHERE replacement.artifact_run_id=$1 AND replacement.runtime_digest=$2
              AND replacement.work_kind='PROCESS_ARTIFACTS' AND replacement.status='PUBLISHED'
              AND replacement.created_at>COALESCE((SELECT min(original.created_at) FROM ingestion_deliveries original
                WHERE original.artifact_run_id=$1 AND original.runtime_digest=$3 AND original.work_kind='PROCESS_ARTIFACTS'),$4::timestamptz)
            LIMIT 1`, [String(row['artifact_run_id']), expectedRuntimeDigest, String(row['runtime_digest']), toIso(row['created_at'])]);
          if (baseline.length) await enqueueIngestionDelivery(tx, { acquisitionRunId: String(row['acquisition_run_id']),
            artifactRunId: String(row['artifact_run_id']), runtimeDigest: expectedRuntimeDigest, workKind: 'VERIFY_UNCHANGED' });
        }
        return { disposition: 'INCOMPATIBLE' };
      }
      const updated = await tx.query(`UPDATE ingestion_deliveries
        SET status = 'PROCESSING', lease_token = gen_random_uuid(),
            lease_expires_at = statement_timestamp() + ($2 * interval '1 millisecond'), attempt = attempt + 1
        WHERE id = $1 AND attempt < $3 AND
          (status = 'QUEUED' OR lease_expires_at <= statement_timestamp()) RETURNING *`,
        [id, INGESTION_LEASE_MS, INGESTION_MAX_ATTEMPTS]);
      const owned = updated[0];
      if (!owned) {
        if (Number(row['attempt']) >= INGESTION_MAX_ATTEMPTS) {
          const expired = await tx.query(`UPDATE ingestion_deliveries SET status = 'FAILED',
            failure_code = 'RETRY_EXHAUSTED', completed_at = statement_timestamp(),
            lease_token = NULL, lease_expires_at = NULL WHERE id = $1
            AND (status = 'QUEUED' OR lease_expires_at <= statement_timestamp()) RETURNING id`, [id]);
          if (expired.length) return { disposition: 'TERMINAL' };
        }
        return { disposition: 'ACTIVE' };
      }
      return { disposition: 'ACQUIRED', claim: {
        id, token: String(owned['lease_token']), attempt: Number(owned['attempt']),
        acquisitionRunId: String(owned['acquisition_run_id']), artifactRunId: String(owned['artifact_run_id']),
        runtimeDigest: String(owned['runtime_digest']), workKind: owned['work_kind'] as IngestionClaim['workKind'],
        leaseExpiresAt: toIso(owned['lease_expires_at']),
      }};
    });
  }

  /** Lock and recheck the lease around ALL writes, including publication; stale callbacks roll back. */
  async processOwned<T>(claim: IngestionClaim, callback: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
    return this.driver.transaction(async tx => {
      await this.assertOwned(tx, claim, true);
      const result = await callback(tx);
      await this.assertOwned(tx, claim, false);
      return result;
    });
  }
  private async assertOwned(tx: SqlExecutor, claim: IngestionClaim, lock: boolean): Promise<void> {
    const rows = await tx.query(`SELECT id FROM ingestion_deliveries WHERE id = $1
      AND status = 'PROCESSING' AND lease_token = $2 AND lease_expires_at > clock_timestamp()
      ${lock ? 'FOR UPDATE' : ''}`, [claim.id, claim.token]);
    if (!rows.length) throw new IngestionOwnershipError();
  }
  async checkpoint(claim: IngestionClaim, part: {
    ordinal: number; artifactId: string; contentHash: string; byteSize: number;
  }): Promise<void> {
    await this.processOwned(claim, async tx => {
      await tx.query(`INSERT INTO ingestion_delivery_parts
        (delivery_id, ordinal, artifact_id, content_hash, byte_size)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (delivery_id, ordinal) DO NOTHING`,
        [claim.id, part.ordinal, part.artifactId, part.contentHash, part.byteSize]);
      const same = await tx.query(`SELECT 1 FROM ingestion_delivery_parts WHERE delivery_id = $1
        AND ordinal = $2 AND artifact_id = $3 AND content_hash = $4 AND byte_size = $5`,
        [claim.id, part.ordinal, part.artifactId, part.contentHash, part.byteSize]);
      if (!same.length) throw new Error('INGESTION_CHECKPOINT_CONFLICT');
    });
  }
  async publishOwned<T>(claim: IngestionClaim, callback: (tx: SqlTransactionExecutor) => Promise<T>, verificationOf?: string): Promise<T> {
    return this.driver.transaction(async tx => {
      await this.assertOwned(tx, claim, true);
      if (await hasPublishedReplacement(tx, claim.id)) throw new IngestionSupersededError();
      const result = await callback(tx);
      if (await hasPublishedReplacement(tx, claim.id)) throw new IngestionSupersededError();
      const rows = await tx.query(`UPDATE ingestion_deliveries delivery SET status = 'PUBLISHED',
        completed_at = clock_timestamp(),
        processed_at = CASE WHEN $3::uuid IS NULL THEN clock_timestamp() ELSE
          (SELECT accepted.processed_at FROM ingestion_deliveries accepted WHERE accepted.id = $3) END,
        published_at = CASE WHEN $3::uuid IS NULL THEN clock_timestamp() ELSE
          (SELECT accepted.published_at FROM ingestion_deliveries accepted WHERE accepted.id = $3) END,
        verified_at = (SELECT run.fresh_at FROM scheduled_acquisition_runs run WHERE run.id=delivery.acquisition_run_id),
        lease_token = NULL, lease_expires_at = NULL, failure_code = NULL
        WHERE delivery.id = $1 AND delivery.lease_token = $2 AND delivery.lease_expires_at > clock_timestamp()
          AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM ingestion_deliveries accepted
            WHERE accepted.id=$3 AND accepted.status='PUBLISHED' AND accepted.work_kind='PROCESS_ARTIFACTS'
              AND accepted.artifact_run_id=delivery.artifact_run_id AND accepted.runtime_digest=delivery.runtime_digest)) RETURNING delivery.id`,
        [claim.id, claim.token, verificationOf ?? null]);
      if (!rows.length) throw new IngestionOwnershipError();
      return result;
    });
  }
  async releaseOwned(claim: IngestionClaim, failureCode: IngestionFailureCode, terminal = false): Promise<void> {
    await this.driver.query(`UPDATE ingestion_deliveries SET status = $3, failure_code = $4,
      completed_at = CASE WHEN $3 = 'QUEUED' THEN NULL ELSE statement_timestamp() END,
      lease_token = NULL, lease_expires_at = NULL, dispatched_at = NULL
      WHERE id = $1 AND status = 'PROCESSING' AND lease_token = $2
        AND lease_expires_at > clock_timestamp()`,
      [claim.id, claim.token, terminal ? 'REFUSED' : 'QUEUED', failureCode]);
  }
}
export const createIngestionDeliveryStore = (driver: SqlDriver) => new IngestionDeliveryStore(driver);
