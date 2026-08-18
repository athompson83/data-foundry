/**
 * `ingestion_jobs` — the durable, resumable unit of pipeline work (doc 02,
 * "Queue/job model").
 *
 * Two properties this module exists to guarantee:
 *
 *   * **Every transition is legal and recorded.** The state machine itself lives
 *     in `@data-foundry/canonical-schema`; this class persists what that machine
 *     decides, and appends a row to `ingestion_job_transitions` for each move.
 *     An illegal transition throws from the schema package before any SQL runs,
 *     so a pipeline that skipped `RESOLVED` and published unresolved entities
 *     cannot exist.
 *   * **Failure is a side state, never a deleted row.** `fail()` writes
 *     `failed_from` and the retry budget; nothing removes the job. A crashed
 *     run leaves a job row that says exactly which stage failed, why, and
 *     whether it is worth another attempt.
 */
import {
  advanceJob,
  failJob,
  isRetryable,
  retryJob,
  type IngestionJobId,
  type IsoDateTime,
  type JobPipelineState,
  type JobState,
  type JobStatus,
  type JobType,
  type RetryMetadata,
  type SourceId,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import type { CanonicalStore, SqlParam } from '@data-foundry/canonical-store';
import { classifyError } from './errors.js';

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface JobHandle {
  readonly id: IngestionJobId;
  readonly status: JobStatus;
}

export interface OpenJobInput {
  readonly verticalId: VerticalId;
  readonly sourceId: SourceId;
  readonly jobType: JobType;
  readonly idempotencyKey: string;
  readonly payload?: Record<string, unknown>;
  readonly at: IsoDateTime;
}

export class IngestionJobStore {
  readonly #store: CanonicalStore;

  constructor(store: CanonicalStore) {
    this.#store = store;
  }

  /**
   * Open — or rejoin — the job for this unit of work.
   *
   * `(source_id, job_type, idempotency_key)` is the identity, so a retry after
   * a crash rejoins the existing row instead of duplicating artifacts. A job
   * parked in `FAILED` is resumed at the stage it failed on when its budget
   * allows, rather than restarted from the beginning.
   */
  async open(input: OpenJobInput): Promise<JobHandle> {
    const existing = await this.#find(input.sourceId, input.jobType, input.idempotencyKey);
    if (existing !== null) {
      if (existing.status.state === 'FAILED' && isRetryable(existing.status)) {
        const resumed = retryJob(existing.status, input.at);
        await this.#persist(existing.id, existing.status.state, resumed, 'resuming failed job');
        return { id: existing.id, status: resumed };
      }
      return existing;
    }

    const rows = await this.#store.driver.query<{ id: string }>(
      `INSERT INTO ingestion_jobs
         (vertical_id, source_id, job_type, idempotency_key, state, state_entered_at, payload)
       VALUES ($1, $2, $3, $4, 'DISCOVERED', $5, $6::jsonb)
       RETURNING id`,
      [
        input.verticalId,
        input.sourceId,
        input.jobType,
        input.idempotencyKey,
        input.at,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    const id = String(rows[0]?.['id']) as IngestionJobId;
    const status: JobStatus = { state: 'DISCOVERED', entered_at: input.at };
    await this.#appendTransition(id, null, 'DISCOVERED', input.at, 'job discovered', null);
    return { id, status };
  }

  /** Move one legal step forward. Throws on an illegal transition. */
  async advance(
    handle: JobHandle,
    to: JobPipelineState,
    at: IsoDateTime,
    reason?: string,
  ): Promise<JobHandle> {
    const next = advanceJob(handle.status, to, at);
    await this.#persist(handle.id, handle.status.state, next, reason ?? null);
    return { id: handle.id, status: next };
  }

  /** Park the job in the FAILED side state with its retry budget. */
  async fail(handle: JobHandle, error: unknown, at: IsoDateTime, maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<JobHandle> {
    const classified = classifyError(error);
    const attempt =
      handle.status.state === 'FAILED' ? handle.status.retry.attempt + 1 : 1;
    const retry: RetryMetadata = {
      attempt,
      max_attempts: maxAttempts,
      next_retry_at:
        classified.retryable && attempt < maxAttempts
          ? (new Date(Date.parse(at) + 60_000 * 2 ** (attempt - 1)).toISOString() as IsoDateTime)
          : null,
      last_error_code: classified.code.slice(0, 120),
      last_error_message: classified.message.slice(0, 4000),
      retryable: classified.retryable,
    };
    const failed = failJob(handle.status, retry, at);
    await this.#persist(handle.id, handle.status.state, failed, classified.message.slice(0, 2000));
    return { id: handle.id, status: failed };
  }

  async setArtifact(id: IngestionJobId, artifactId: string | null): Promise<void> {
    await this.#store.driver.query(
      `UPDATE ingestion_jobs SET artifact_id = $2, updated_at = now() WHERE id = $1`,
      [id, artifactId],
    );
  }

  async setSourceRecord(id: IngestionJobId, sourceRecordId: string | null): Promise<void> {
    await this.#store.driver.query(
      `UPDATE ingestion_jobs SET source_record_id = $2, updated_at = now() WHERE id = $1`,
      [id, sourceRecordId],
    );
  }

  async get(id: IngestionJobId): Promise<JobHandle | null> {
    const rows = await this.#store.driver.query(
      `SELECT id, state, state_entered_at, failed_from, retry FROM ingestion_jobs WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : { id, status: rowToStatus(row) };
  }

  async transitions(id: IngestionJobId): Promise<readonly { from: JobState | null; to: JobState }[]> {
    const rows = await this.#store.driver.query(
      `SELECT from_state, to_state FROM ingestion_job_transitions
        WHERE job_id = $1 ORDER BY id`,
      [id],
    );
    return rows.map((row) => ({
      from: row['from_state'] === null ? null : (String(row['from_state']) as JobState),
      to: String(row['to_state']) as JobState,
    }));
  }

  async #find(
    sourceId: SourceId,
    jobType: JobType,
    idempotencyKey: string,
  ): Promise<JobHandle | null> {
    const rows = await this.#store.driver.query(
      `SELECT id, state, state_entered_at, failed_from, retry FROM ingestion_jobs
        WHERE source_id = $1 AND job_type = $2 AND idempotency_key = $3`,
      [sourceId, jobType, idempotencyKey],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { id: String(row['id']) as IngestionJobId, status: rowToStatus(row) };
  }

  async #persist(
    id: IngestionJobId,
    from: JobState,
    status: JobStatus,
    reason: string | null,
  ): Promise<void> {
    const failedFrom: SqlParam = status.state === 'FAILED' ? status.failed_from : null;
    const retry: SqlParam = status.state === 'FAILED' ? JSON.stringify(status.retry) : null;
    await this.#store.driver.query(
      `UPDATE ingestion_jobs
          SET state = $2, state_entered_at = $3, failed_from = $4, retry = $5::jsonb, updated_at = now()
        WHERE id = $1`,
      [id, status.state, status.entered_at, failedFrom, retry],
    );
    await this.#appendTransition(id, from, status.state, status.entered_at, reason, null);
  }

  async #appendTransition(
    id: IngestionJobId,
    from: JobState | null,
    to: JobState,
    at: IsoDateTime,
    reason: string | null,
    actor: string | null,
  ): Promise<void> {
    await this.#store.driver.query(
      `INSERT INTO ingestion_job_transitions (job_id, from_state, to_state, occurred_at, reason, actor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, from, to, at, reason, actor ?? 'ingest-worker'],
    );
  }
}

function rowToStatus(row: Record<string, unknown>): JobStatus {
  const state = String(row['state']) as JobState;
  const enteredAt = new Date(String(row['state_entered_at'])).toISOString() as IsoDateTime;
  if (state === 'FAILED') {
    const retry = row['retry'];
    return {
      state: 'FAILED',
      entered_at: enteredAt,
      failed_from: String(row['failed_from']) as JobPipelineState,
      retry: (typeof retry === 'string' ? JSON.parse(retry) : retry) as RetryMetadata,
    };
  }
  return { state: state as JobPipelineState, entered_at: enteredAt };
}
