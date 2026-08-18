/**
 * The ingestion job model (doc 02, "Queue/job model").
 *
 * The state machine is not decoration. It is what makes an ingestion run
 * resumable and what stops a crashed pass from publishing half a source. These
 * tests exercise it through the real pipeline against a real database, and in
 * particular they check the two properties that are easy to claim and easy to
 * get wrong:
 *
 *   * a failure is a **side state with retry metadata**, not a deleted row —
 *     and the evidence acquired before the failure survives it (rule 10);
 *   * a resumed job re-enters at the stage it failed on and finishes, without
 *     the state machine ever being asked to move backwards.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createFactory, RUN_1_AT, type Factory } from '../support/harness.js';

let factory: Factory | null = null;

afterEach(async () => {
  await factory?.close();
  factory = null;
});

describe('ingestion job state machine', () => {
  it('records every legal transition from DISCOVERED to PUBLISHED', async () => {
    factory = await createFactory();
    const run = await factory.run({ sources: ['acme-hvac-catalog'], runId: 'cycle-1' });
    const [result] = run.sources;
    expect(result?.finalState).toBe('PUBLISHED');

    const rows = await factory.driver.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state FROM ingestion_job_transitions
        WHERE job_id = $1 ORDER BY id`,
      [String(result?.jobId)],
    );
    expect(rows.map((row) => row.to_state)).toEqual([
      'DISCOVERED',
      'FETCH_QUEUED',
      'FETCHED',
      'EXTRACTED',
      'NORMALIZED',
      'RESOLUTION_PENDING',
      'RESOLVED',
      'VALIDATED',
      'PUBLISHED',
    ]);
    // The log is a chain, not a set of unrelated events.
    expect(rows[0]?.from_state).toBeNull();
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]?.from_state).toBe(rows[index - 1]?.to_state);
    }

    const job = await factory.driver.query(
      `SELECT state, failed_from, retry, artifact_id, source_record_id, idempotency_key
         FROM ingestion_jobs WHERE id = $1`,
      [String(result?.jobId)],
    );
    expect(job[0]?.['state']).toBe('PUBLISHED');
    // The failure columns are only ever populated in FAILED; the schema's own
    // CHECK constraint enforces it, and this asserts the pipeline agrees.
    expect(job[0]?.['failed_from']).toBeNull();
    expect(job[0]?.['retry']).toBeNull();
    expect(job[0]?.['artifact_id']).not.toBeNull();
    expect(job[0]?.['source_record_id']).not.toBeNull();
  }, 120_000);

  it('is idempotent per unit of work: re-running a cycle rejoins the same job row', async () => {
    factory = await createFactory();
    const first = await factory.run({ sources: ['acme-hvac-catalog'], runId: 'cycle-1' });
    const second = await factory.run({ sources: ['acme-hvac-catalog'], runId: 'cycle-1' });

    expect(second.sources[0]?.jobId).toBe(first.sources[0]?.jobId);
    expect(second.sources[0]?.outcome).toBe('ALREADY_PUBLISHED');

    const rows = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingestion_jobs`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  }, 120_000);

  it('parks a stage failure in FAILED with retry metadata, keeping the evidence it already had', async () => {
    factory = await createFactory();
    // A PDF source whose bytes are not a PDF: acquisition succeeds and stores
    // the artifact, extraction then fails. The failure therefore lands with a
    // real artifact already in the evidence store.
    const run = await factory.run({
      sources: ['acme-spec-sheets'],
      runId: 'cycle-1',
      fixtureOverrides: { 'acme-spec-sheets': 'this is not a pdf' },
    });
    const [result] = run.sources;
    expect(result?.error).not.toBeNull();
    expect(result?.finalState).toBe('FAILED');

    const rows = await factory.driver.query(
      `SELECT state, failed_from, retry FROM ingestion_jobs WHERE id = $1`,
      [String(result?.jobId)],
    );
    expect(rows[0]?.['state']).toBe('FAILED');
    // The stage attribution is the whole value of the side state.
    expect(rows[0]?.['failed_from']).toBe('FETCHED');

    const retry = rows[0]?.['retry'] as Record<string, unknown>;
    expect(retry['attempt']).toBe(1);
    expect(retry['max_attempts']).toBeGreaterThan(1);
    expect(retry['retryable']).toBe(true);
    expect(retry['next_retry_at']).not.toBeNull();
    expect(String(retry['last_error_message'])).toContain('PDF');

    // Rule 10: the artifact acquired before the failure is retained, so the
    // retry does not have to re-fetch and the failure can be explained.
    const artifacts = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM source_artifacts`,
    );
    expect(Number(artifacts[0]?.n)).toBe(1);

    // Nothing downstream was published from a stage that never ran.
    const facts = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM facts`,
    );
    expect(Number(facts[0]?.n)).toBe(0);
  }, 120_000);

  it('resumes a failed job at the stage it failed on and finishes it', async () => {
    factory = await createFactory();
    const broken = await factory.run({
      sources: ['acme-spec-sheets'],
      runId: 'cycle-1',
      fixtureOverrides: { 'acme-spec-sheets': 'this is not a pdf' },
    });
    expect(broken.sources[0]?.finalState).toBe('FAILED');

    // Same cycle, same idempotency key, upstream now healthy.
    const resumed = await factory.run({ sources: ['acme-spec-sheets'], runId: 'cycle-1' });
    expect(resumed.sources[0]?.jobId).toBe(broken.sources[0]?.jobId);
    expect(resumed.sources[0]?.error).toBeNull();
    expect(resumed.sources[0]?.finalState).toBe('PUBLISHED');

    const transitions = await factory.driver.query<{ to_state: string }>(
      `SELECT to_state FROM ingestion_job_transitions WHERE job_id = $1 ORDER BY id`,
      [String(resumed.sources[0]?.jobId)],
    );
    const states = transitions.map((row) => row.to_state);
    expect(states).toContain('FAILED');
    // It re-entered at FETCHED — the stage that failed — rather than restarting.
    expect(states.slice(states.indexOf('FAILED'))).toEqual([
      'FAILED',
      'FETCHED',
      'EXTRACTED',
      'NORMALIZED',
      'RESOLUTION_PENDING',
      'RESOLVED',
      'VALIDATED',
      'PUBLISHED',
    ]);

    const facts = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM facts`,
    );
    expect(Number(facts[0]?.n)).toBeGreaterThan(0);
  }, 120_000);

  it('refuses to acquire a source with no rights record at all (rule 1)', async () => {
    factory = await createFactory();
    await expect(factory.run({ sources: ['not-a-declared-source'] })).rejects.toThrow(
      /rights record/i,
    );
    const jobs = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ingestion_jobs`,
    );
    // Refused before a job exists: an undeclared source never becomes work.
    expect(Number(jobs[0]?.n)).toBe(0);
  }, 120_000);

  it('carries the run instant, not the wall clock, into every timestamp it writes', async () => {
    factory = await createFactory();
    await factory.run({ sources: ['acme-hvac-catalog'], at: RUN_1_AT });
    const rows = await factory.driver.query<{ retrieved_at: string }>(
      `SELECT retrieved_at FROM source_artifacts`,
    );
    expect(new Date(String(rows[0]?.retrieved_at)).toISOString()).toBe(RUN_1_AT);
  }, 120_000);
});
