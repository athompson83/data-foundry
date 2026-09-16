import { describe, expect, it } from 'vitest';
import {
  buildEvidence,
  overallOutcome,
  readStages,
  sanitizeCorrelationId,
} from '../scripts/verification-evidence.js';

const ALL_SUCCESS: Readonly<Record<string, string>> = {
  STEP_TLS: 'success',
  STEP_MIGRATE: 'success',
  STEP_REAPPLY: 'success',
  STEP_GRANTS: 'success',
  STEP_RUNTIME_TLS: 'success',
  STEP_INGESTION: 'success',
  STEP_NEGATIVE: 'success',
  STEP_RECONCILIATION: 'success',
  STEP_CREDENTIALS: 'success',
  STEP_ACQUISITION: 'success',
};

const VERIFIED_FIXTURE = { source: 's', file: 'f.json', pinnedDigestMatches: true } as const;

describe('verification evidence is sanitized by construction', () => {
  it('reduces a correlation id to a label and cannot carry a path or a URL', () => {
    expect(sanitizeCorrelationId('run-42_ok.1')).toBe('run-42_ok.1');
    expect(sanitizeCorrelationId('../../etc/passwd')).toBe('....etcpasswd');
    expect(sanitizeCorrelationId('postgres://u:p@host/db')).toBe('postgresuphostdb');
    expect(sanitizeCorrelationId('a'.repeat(200))).toHaveLength(64);
  });

  it('falls back to a placeholder rather than emitting an empty identifier', () => {
    expect(sanitizeCorrelationId(undefined)).toBe('sanitized');
    expect(sanitizeCorrelationId('!!!')).toBe('sanitized');
  });

  it('never emits a value it was not explicitly given', async () => {
    const evidence = await buildEvidence({
      ...ALL_SUCCESS,
      CORRELATION_ID: 'probe',
      DATA_FOUNDRY_CANDIDATE_SHA: 'a'.repeat(40),
      // Secrets that must not appear anywhere in the output.
      DATA_FOUNDRY_MIGRATION_DATABASE_URL: 'postgres://df_migration:hunter2@db.example/data_foundry',
      CLOUDFLARE_API_TOKEN: 'cf-token-value',
      PGPASSWORD: 'hunter2',
    });
    const rendered = JSON.stringify(evidence);
    expect(rendered).not.toContain('hunter2');
    expect(rendered).not.toContain('cf-token-value');
    expect(rendered).not.toContain('df_migration');
    expect(rendered).not.toContain('postgres://');
  });
});

describe('no stage infers success from another stage', () => {
  it('reports a missing stage as not-run rather than omitting it', () => {
    const stages = readStages({ STEP_TLS: 'success' });
    expect(stages).toHaveLength(10);
    expect(stages[0]).toEqual({ stage: 'disposable-tls-postgres', outcome: 'success' });
    expect(stages.filter((entry) => entry.outcome === 'not-run')).toHaveLength(9);
  });

  it('covers the checks that run after the negative controls', () => {
    const names = readStages({}).map((entry) => entry.stage);
    expect(names).toEqual(
      expect.arrayContaining([
        'source-record-reconciliation',
        'credential-provisioning',
        'scheduled-acquisition-controls',
      ]),
    );
  });

  it('fails overall when any single stage is not a success', () => {
    expect(overallOutcome(readStages(ALL_SUCCESS), [VERIFIED_FIXTURE])).toBe('pass');
    for (const key of Object.keys(ALL_SUCCESS)) {
      const degraded = { ...ALL_SUCCESS, [key]: 'failure' };
      expect(
        overallOutcome(readStages(degraded), [VERIFIED_FIXTURE]),
        `${key} must be able to fail the run`,
      ).toBe('fail');
    }
  });

  it('treats a skipped stage as unproven, not as a pass', () => {
    expect(
      overallOutcome(readStages({ ...ALL_SUCCESS, STEP_INGESTION: 'skipped' }), [VERIFIED_FIXTURE]),
    ).toBe('fail');
  });

  it('cannot report a pass while reporting its own fixture as invalid', () => {
    const stages = readStages(ALL_SUCCESS);
    expect(overallOutcome(stages, [{ source: 's', file: 'f', pinnedDigestMatches: false }])).toBe(
      'fail',
    );
    expect(overallOutcome(stages, [{ source: 's', file: 'f', error: 'unreadable' }])).toBe('fail');
    expect(
      overallOutcome(stages, [VERIFIED_FIXTURE, { source: 't', file: 'g', pinnedDigestMatches: false }]),
      'one drifted fixture among several must still fail',
    ).toBe('fail');
  });

  it('refuses to pass when no fixture was verified at all', () => {
    expect(overallOutcome(readStages(ALL_SUCCESS), [])).toBe('fail');
  });
});

describe('the evidence states what it does not prove', () => {
  it('carries the disclaimer as data so it travels with the document', async () => {
    const evidence = await buildEvidence(ALL_SUCCESS);
    expect(evidence['kind']).toBe('disposable-postgres-e2e-integration-proof');
    expect(evidence['notAProofOf']).toEqual(
      expect.arrayContaining([
        'hosted-production-database',
        'cloudflare-deployed-runtime',
        'real-queue-delivery',
        'real-r2-persistence',
      ]),
    );
  });

  it('pins every synthetic fixture to its repository digest', async () => {
    const evidence = await buildEvidence(ALL_SUCCESS);
    const fixtures = evidence['syntheticFixtures'] as readonly Record<string, unknown>[];
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture['pinnedDigestMatches'], `${String(fixture['file'])} digest drifted`).toBe(true);
      expect(String(fixture['sha256'])).toMatch(/^[0-9a-f]{64}$/u);
    }
  });
});
