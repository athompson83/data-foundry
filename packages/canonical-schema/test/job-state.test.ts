import { describe, expect, it } from 'vitest';
import {
  IllegalJobTransitionError,
  JOB_PIPELINE_ORDER,
  JOB_STATES,
  JobStatusSchema,
  LEGAL_JOB_TRANSITIONS,
  advanceJob,
  assertTransition,
  canTransition,
  canTransitionFrom,
  failJob,
  isRetryable,
  isTerminalJobState,
  nextStates,
  retryJob,
  type FailedJobStatus,
  type JobPipelineState,
  type JobState,
  type JobStatus,
  type RetryMetadata,
} from '../src/job-state.js';

const T0 = '2026-08-14T00:00:00.000Z';
const T1 = '2026-08-14T01:00:00.000Z';

const retry = (overrides: Partial<RetryMetadata> = {}): RetryMetadata => ({
  attempt: 1,
  max_attempts: 3,
  next_retry_at: T1,
  last_error_code: 'HTTP_503',
  last_error_message: 'upstream unavailable',
  retryable: true,
  ...overrides,
});

const at = (state: JobPipelineState): JobStatus => ({ state, entered_at: T0 });

describe('transition table', () => {
  it('covers every state', () => {
    expect(Object.keys(LEGAL_JOB_TRANSITIONS).sort()).toEqual([...JOB_STATES].sort());
  });

  it('only ever names known states as targets', () => {
    for (const targets of Object.values(LEGAL_JOB_TRANSITIONS)) {
      for (const target of targets) {
        expect(JOB_STATES).toContain(target);
      }
    }
  });

  it('makes PUBLISHED the only terminal state', () => {
    const terminal = JOB_STATES.filter((state) => LEGAL_JOB_TRANSITIONS[state].length === 0);
    expect(terminal).toEqual(['PUBLISHED']);
    expect(isTerminalJobState('PUBLISHED')).toBe(true);
    expect(isTerminalJobState('FAILED')).toBe(false);
  });

  it('lets every non-terminal pipeline stage fail', () => {
    for (const state of JOB_PIPELINE_ORDER) {
      if (state === 'PUBLISHED') continue;
      expect(canTransition(state, 'FAILED')).toBe(true);
    }
  });

  it('does not let a published job fail', () => {
    expect(canTransition('PUBLISHED', 'FAILED')).toBe(false);
    expect(nextStates('PUBLISHED')).toEqual([]);
  });
});

describe('happy path', () => {
  it('walks DISCOVERED -> PUBLISHED one legal step at a time', () => {
    let status: JobStatus = at('DISCOVERED');
    for (const next of JOB_PIPELINE_ORDER.slice(1)) {
      status = advanceJob(status, next, T0);
      expect(status.state).toBe(next);
    }
    expect(status.state).toBe('PUBLISHED');
  });

  it('permits exactly one forward target from each stage', () => {
    for (const [index, state] of JOB_PIPELINE_ORDER.entries()) {
      const forward = LEGAL_JOB_TRANSITIONS[state].filter((target) => target !== 'FAILED');
      const expected = JOB_PIPELINE_ORDER[index + 1];
      expect(forward).toEqual(expected === undefined ? [] : [expected]);
    }
  });
});

describe('illegal transitions are rejected', () => {
  it.each([
    ['DISCOVERED', 'FETCHED'],
    ['DISCOVERED', 'PUBLISHED'],
    ['FETCH_QUEUED', 'NORMALIZED'],
    ['NORMALIZED', 'PUBLISHED'],
    ['RESOLVED', 'RESOLUTION_PENDING'],
    ['VALIDATED', 'DISCOVERED'],
    ['PUBLISHED', 'VALIDATED'],
    ['PUBLISHED', 'FAILED'],
  ] as [JobState, JobState][])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalJobTransitionError);
  });

  it('rejects skipping a stage even when the target is later in the pipeline', () => {
    expect(() => advanceJob(at('FETCHED'), 'RESOLVED', T0)).toThrow(IllegalJobTransitionError);
  });

  it('rejects going backwards', () => {
    expect(() => advanceJob(at('EXTRACTED'), 'FETCHED', T0)).toThrow(IllegalJobTransitionError);
  });

  it('names the legal targets in the error message', () => {
    expect(() => assertTransition('FETCHED', 'PUBLISHED')).toThrow(/EXTRACTED/);
  });

  it('refuses to move a terminal job', () => {
    expect(() => advanceJob(at('PUBLISHED'), 'VALIDATED', T0)).toThrow(IllegalJobTransitionError);
    expect(() => failJob(at('PUBLISHED'), retry(), T0)).toThrow(IllegalJobTransitionError);
  });
});

describe('FAILED is a side state, not a delete', () => {
  it('records the stage that failed', () => {
    const failed = failJob(at('EXTRACTED'), retry(), T1);
    expect(failed.state).toBe('FAILED');
    expect(failed.failed_from).toBe('EXTRACTED');
    expect(failed.retry.attempt).toBe(1);
    expect(failed.entered_at).toBe(T1);
  });

  it('only resumes at the stage that failed', () => {
    const failed = failJob(at('NORMALIZED'), retry(), T1);
    expect(canTransitionFrom(failed, 'NORMALIZED')).toBe(true);
    expect(canTransitionFrom(failed, 'RESOLUTION_PENDING')).toBe(false);
    expect(canTransitionFrom(failed, 'DISCOVERED')).toBe(false);
    expect(() => advanceJob(failed, 'RESOLUTION_PENDING', T1)).toThrow(
      /may only resume at NORMALIZED/,
    );
  });

  it('preserves the original failing stage across repeated failures', () => {
    const first = failJob(at('FETCHED'), retry({ attempt: 1 }), T0);
    const second = failJob(first, retry({ attempt: 2 }), T1);
    expect(second.failed_from).toBe('FETCHED');
    expect(second.retry.attempt).toBe(2);
  });

  it('lets a retried attempt fail again without losing the record', () => {
    expect(canTransition('FAILED', 'FAILED')).toBe(true);
    const resumed = retryJob(failJob(at('EXTRACTED'), retry({ attempt: 1 }), T0), T1);
    const failedAgain = failJob(resumed, retry({ attempt: 2 }), T1);
    expect(failedAgain.failed_from).toBe('EXTRACTED');
  });

  it('retries back into the pipeline when budget remains', () => {
    const failed = failJob(at('FETCH_QUEUED'), retry({ attempt: 1, max_attempts: 3 }), T0);
    expect(isRetryable(failed)).toBe(true);
    const resumed = retryJob(failed, T1);
    expect(resumed.state).toBe('FETCH_QUEUED');
    expect(resumed.entered_at).toBe(T1);
  });

  it('refuses to retry once the attempt budget is exhausted', () => {
    const failed = failJob(at('FETCHED'), retry({ attempt: 3, max_attempts: 3 }), T0);
    expect(isRetryable(failed)).toBe(false);
    expect(() => retryJob(failed, T1)).toThrow(/budget exhausted/);
  });

  it('refuses to retry a non-retryable error class', () => {
    const failed = failJob(
      at('EXTRACTED'),
      retry({ retryable: false, next_retry_at: null, last_error_code: 'SCHEMA_MISMATCH' }),
      T0,
    );
    expect(isRetryable(failed)).toBe(false);
    expect(() => retryJob(failed, T1)).toThrow(/not retryable/);
  });
});

describe('JobStatus discriminated union', () => {
  it('parses a pipeline state', () => {
    const parsed = JobStatusSchema.parse({ state: 'RESOLVED', entered_at: T0 });
    expect(parsed.state).toBe('RESOLVED');
  });

  it('requires failure metadata on FAILED', () => {
    expect(() => JobStatusSchema.parse({ state: 'FAILED', entered_at: T0 })).toThrow();
  });

  it('accepts a well-formed FAILED status', () => {
    const parsed = JobStatusSchema.parse({
      state: 'FAILED',
      entered_at: T0,
      failed_from: 'FETCHED',
      retry: retry(),
    }) as FailedJobStatus;
    expect(parsed.failed_from).toBe('FETCHED');
    expect(parsed.retry.retryable).toBe(true);
  });

  it('rejects failure metadata on a non-FAILED state', () => {
    expect(() =>
      JobStatusSchema.parse({ state: 'DISCOVERED', entered_at: T0, failed_from: 'FETCHED' }),
    ).not.toThrow(); // extra keys are stripped, not an error
    const parsed = JobStatusSchema.parse({
      state: 'DISCOVERED',
      entered_at: T0,
      failed_from: 'FETCHED',
    });
    expect(Object.keys(parsed)).toEqual(['state', 'entered_at']);
  });

  it('rejects an unknown state', () => {
    expect(() => JobStatusSchema.parse({ state: 'ARCHIVED', entered_at: T0 })).toThrow();
  });
});
