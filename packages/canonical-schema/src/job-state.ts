import { z } from 'zod';
import { IngestionJobIdSchema } from './ids.js';
import { IsoDateTimeSchema } from './primitives.js';

/**
 * Ingestion job state machine (doc 02, "Queue/job model").
 *
 * The happy path is strictly linear:
 *
 * ```text
 * DISCOVERED → FETCH_QUEUED → FETCHED → EXTRACTED → NORMALIZED
 *            → RESOLUTION_PENDING → RESOLVED → VALIDATED → PUBLISHED
 * ```
 *
 * `FAILED` is a *side* state, not a terminal delete: it records which pipeline
 * stage failed and the retry metadata needed to resume, so no work is ever lost
 * by a crash or a bad source response.
 */
export const JOB_PIPELINE_ORDER = [
  'DISCOVERED',
  'FETCH_QUEUED',
  'FETCHED',
  'EXTRACTED',
  'NORMALIZED',
  'RESOLUTION_PENDING',
  'RESOLVED',
  'VALIDATED',
  'PUBLISHED',
] as const;
export const JobPipelineStateSchema = z.enum(JOB_PIPELINE_ORDER);
export type JobPipelineState = z.infer<typeof JobPipelineStateSchema>;

export const JOB_STATES = [...JOB_PIPELINE_ORDER, 'FAILED'] as const;
export const JobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof JobStateSchema>;

/** The only state from which no further transition is legal. */
export const TERMINAL_JOB_STATE = 'PUBLISHED' as const;

/**
 * Static legal-transition table.
 *
 * `FAILED` lists every pipeline state because the legal retry target depends on
 * the *instance* (`failed_from`), not on the state name. Use
 * {@link canTransitionFrom} when you hold a {@link JobStatus} — it enforces the
 * stricter, instance-aware rule.
 *
 * `FAILED -> FAILED` is legal on purpose: a worker that retries in-process and
 * fails again must be able to record the new attempt. Forbidding it would force
 * the runner to either fabricate an intermediate state it never reached, or
 * drop the failure — and dropping failures is exactly what "FAILED is a side
 * state, not a silent deletion" exists to prevent.
 */
export const LEGAL_JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  DISCOVERED: ['FETCH_QUEUED', 'FAILED'],
  FETCH_QUEUED: ['FETCHED', 'FAILED'],
  FETCHED: ['EXTRACTED', 'FAILED'],
  EXTRACTED: ['NORMALIZED', 'FAILED'],
  NORMALIZED: ['RESOLUTION_PENDING', 'FAILED'],
  RESOLUTION_PENDING: ['RESOLVED', 'FAILED'],
  RESOLVED: ['VALIDATED', 'FAILED'],
  VALIDATED: ['PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  FAILED: [...JOB_PIPELINE_ORDER, 'FAILED'],
});

export const RetryMetadataSchema = z.object({
  /** 1-based count of attempts already made at `failed_from`. */
  attempt: z.number().int().min(1),
  max_attempts: z.number().int().min(1),
  /** `null` when the failure is not retryable or the budget is exhausted. */
  next_retry_at: IsoDateTimeSchema.nullable(),
  last_error_code: z.string().min(1).max(120),
  last_error_message: z.string().max(4000),
  /** Whether the underlying error class is worth retrying at all. */
  retryable: z.boolean(),
});
export type RetryMetadata = z.infer<typeof RetryMetadataSchema>;

const pipelineVariant = <S extends JobPipelineState>(state: S) =>
  z.object({ state: z.literal(state), entered_at: IsoDateTimeSchema });

export const JobStatusSchema = z.discriminatedUnion('state', [
  pipelineVariant('DISCOVERED'),
  pipelineVariant('FETCH_QUEUED'),
  pipelineVariant('FETCHED'),
  pipelineVariant('EXTRACTED'),
  pipelineVariant('NORMALIZED'),
  pipelineVariant('RESOLUTION_PENDING'),
  pipelineVariant('RESOLVED'),
  pipelineVariant('VALIDATED'),
  pipelineVariant('PUBLISHED'),
  z.object({
    state: z.literal('FAILED'),
    entered_at: IsoDateTimeSchema,
    /** The pipeline stage that failed; the only legal retry target. */
    failed_from: JobPipelineStateSchema,
    retry: RetryMetadataSchema,
  }),
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type FailedJobStatus = Extract<JobStatus, { state: 'FAILED' }>;

export class IllegalJobTransitionError extends Error {
  override readonly name = 'IllegalJobTransitionError';
  readonly from: JobState;
  readonly to: JobState;

  constructor(from: JobState, to: JobState, detail?: string) {
    super(
      `Illegal job transition ${from} -> ${to}${detail === undefined ? '' : `: ${detail}`}. ` +
        `Legal targets from ${from}: [${LEGAL_JOB_TRANSITIONS[from].join(', ')}].`,
    );
    this.from = from;
    this.to = to;
  }
}

export function nextStates(from: JobState): readonly JobState[] {
  return LEGAL_JOB_TRANSITIONS[from];
}

export function isTerminalJobState(state: JobState): boolean {
  return state === TERMINAL_JOB_STATE;
}

/** Table-level check. Does not know about `failed_from`. */
export function canTransition(from: JobState, to: JobState): boolean {
  return LEGAL_JOB_TRANSITIONS[from].includes(to);
}

/** Instance-level check: a FAILED job may only resume at the stage it failed on. */
export function canTransitionFrom(current: JobStatus, to: JobState): boolean {
  if (!canTransition(current.state, to)) return false;
  if (current.state === 'FAILED' && to !== 'FAILED') {
    return to === current.failed_from;
  }
  return true;
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new IllegalJobTransitionError(from, to);
  }
}

/**
 * Move a job forward one legal step. Throws rather than clamping, because a
 * pipeline that silently skips `RESOLVED` publishes unresolved entities.
 */
export function advanceJob(
  current: JobStatus,
  to: JobPipelineState,
  at: string,
): JobStatus {
  if (!canTransitionFrom(current, to)) {
    const detail =
      current.state === 'FAILED'
        ? `a FAILED job may only resume at ${current.failed_from}`
        : undefined;
    throw new IllegalJobTransitionError(current.state, to, detail);
  }
  return { state: to, entered_at: IsoDateTimeSchema.parse(at) };
}

/**
 * Park a job in the FAILED side state. Retrying a FAILED job that fails again
 * preserves the original `failed_from` so the stage attribution survives.
 */
export function failJob(current: JobStatus, retry: RetryMetadata, at: string): FailedJobStatus {
  if (!canTransition(current.state, 'FAILED')) {
    throw new IllegalJobTransitionError(current.state, 'FAILED', 'terminal jobs cannot fail');
  }
  const failedFrom: JobPipelineState =
    current.state === 'FAILED' ? current.failed_from : current.state;
  return {
    state: 'FAILED',
    entered_at: IsoDateTimeSchema.parse(at),
    failed_from: failedFrom,
    retry: RetryMetadataSchema.parse(retry),
  };
}

export function isRetryable(status: FailedJobStatus): boolean {
  return status.retry.retryable && status.retry.attempt < status.retry.max_attempts;
}

/**
 * Resume a failed job at the stage that failed. Refuses when the error class is
 * not retryable or the attempt budget is spent — those jobs belong in a human
 * exception queue, not in an infinite retry loop.
 */
export function retryJob(status: FailedJobStatus, at: string): JobStatus {
  if (!isRetryable(status)) {
    throw new IllegalJobTransitionError(
      'FAILED',
      status.failed_from,
      status.retry.retryable
        ? `retry budget exhausted (${status.retry.attempt}/${status.retry.max_attempts})`
        : 'error is not retryable',
    );
  }
  return advanceJob(status, status.failed_from, at);
}

/** Append-only audit row for every state change; mirrors `ingestion_job_transitions`. */
export const JobTransitionSchema = z.object({
  job_id: IngestionJobIdSchema,
  from_state: JobStateSchema.nullable(),
  to_state: JobStateSchema,
  occurred_at: IsoDateTimeSchema,
  reason: z.string().max(2000).nullable(),
  actor: z.string().max(200).nullable(),
});
export type JobTransition = z.infer<typeof JobTransitionSchema>;
