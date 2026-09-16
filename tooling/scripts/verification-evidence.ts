/**
 * Sanitized external-verification evidence for the disposable-PostgreSQL
 * end-to-end integration job.
 *
 * This emits only: step outcomes passed in as `STEP_*` environment variables,
 * the candidate Git SHA, the run URL, and the identity and digest of the
 * repository-pinned synthetic fixtures. It never reads a connection string, a
 * password, a token, a provider account identifier, or arbitrary environment
 * contents, and it never echoes an environment value it was not explicitly
 * given.
 *
 * It is deliberately NOT a hosted-production or Cloudflare deployed-runtime
 * proof, and the emitted document says so in a field rather than a comment so
 * the disclaimer travels with the evidence.
 */
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { SYNTHETIC_INGESTION_FIXTURES } from '../../apps/ingestion-worker/src/synthetic-ingestion.js';
import { isMain } from '../lib/cli-entry.js';

/** Correlation ids are labels, not credentials. Anything else is discarded. */
export function sanitizeCorrelationId(raw: string | undefined): string {
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9._-]/gu, '').slice(0, 64);
  return cleaned === '' ? 'sanitized' : cleaned;
}

export interface EvidenceStage {
  readonly stage: string;
  readonly outcome: string;
}

/** A stage with no recorded outcome is `not-run`, never silently a pass. */
export function readStages(env: Readonly<Record<string, string | undefined>>): EvidenceStage[] {
  const map: readonly (readonly [string, string])[] = [
    ['disposable-tls-postgres', 'STEP_TLS'],
    ['apply-migrations', 'STEP_MIGRATE'],
    ['reapply-is-noop', 'STEP_REAPPLY'],
    ['stage-roles-and-grants', 'STEP_GRANTS'],
    ['runtime-role-direct-tls', 'STEP_RUNTIME_TLS'],
    ['ingestion-publish-e2e', 'STEP_INGESTION'],
    ['privilege-negative-controls', 'STEP_NEGATIVE'],
  ];
  return map.map(([stage, key]) => ({ stage, outcome: env[key] ?? 'not-run' }));
}

/**
 * Every stage must independently read `success`. `skipped` is not a pass: a
 * stage that did not run has not proven anything, and treating it as a pass is
 * exactly the inference this evidence exists to prevent.
 */
export function overallOutcome(stages: readonly EvidenceStage[]): 'pass' | 'fail' {
  return stages.every((entry) => entry.outcome === 'success') ? 'pass' : 'fail';
}

export interface FixtureEvidence {
  readonly source: string;
  readonly file: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly pinnedDigestMatches?: boolean;
  readonly error?: string;
}

export async function fixtureEvidence(
  read: (path: string) => Promise<Uint8Array> = (path) => readFile(path),
): Promise<FixtureEvidence[]> {
  const entries = Object.entries(SYNTHETIC_INGESTION_FIXTURES);
  return Promise.all(
    entries.map(async ([source, fixture]): Promise<FixtureEvidence> => {
      try {
        const bytes = await read(`verticals/hvac/fixtures/${fixture.file}`);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        return {
          source,
          file: fixture.file,
          bytes: bytes.byteLength,
          sha256,
          pinnedDigestMatches: sha256 === fixture.hash,
        };
      } catch {
        return { source, file: fixture.file, error: 'unreadable' };
      }
    }),
  );
}

export async function buildEvidence(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, unknown>> {
  const stages = readStages(env);
  return {
    kind: 'disposable-postgres-e2e-integration-proof',
    notAProofOf: [
      'hosted-production-database',
      'cloudflare-deployed-runtime',
      'real-queue-delivery',
      'real-r2-persistence',
      'rest-or-mcp-surface-readback',
    ],
    correlationId: sanitizeCorrelationId(env['CORRELATION_ID']),
    gitSha: env['DATA_FOUNDRY_CANDIDATE_SHA'] ?? 'unknown',
    runUrl:
      env['GITHUB_SERVER_URL'] !== undefined && env['GITHUB_REPOSITORY'] !== undefined
        ? `${env['GITHUB_SERVER_URL']}/${env['GITHUB_REPOSITORY']}/actions/runs/${env['GITHUB_RUN_ID'] ?? ''}`
        : 'local',
    syntheticFixtures: await fixtureEvidence(),
    stages,
    overall: overallOutcome(stages),
  };
}

export async function run(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const evidence = await buildEvidence(env);
  const rendered = JSON.stringify(evidence, null, 2);
  process.stdout.write(`${rendered}\n`);
  const summaryPath = env['GITHUB_STEP_SUMMARY'];
  if (summaryPath !== undefined && summaryPath !== '') {
    await appendFile(
      summaryPath,
      [
        '## Data Foundry verification evidence',
        '',
        '**Disposable-PostgreSQL end-to-end integration proof.**',
        'This is **not** hosted-production and **not** a Cloudflare deployed-runtime proof.',
        '',
        '```json',
        rendered,
        '```',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  return evidence['overall'] === 'pass' ? 0 : 1;
}

if (isMain(import.meta.url)) {
  run().then((code) => {
    process.exitCode = code;
  });
}
