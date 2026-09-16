/**
 * Behavioural coverage for the disposable-Postgres readiness loop.
 *
 * The loop exists because of a real CI failure: the official Postgres image
 * runs a temporary server for `initdb` with `listen_addresses=''` and then
 * shuts it down to restart for real. A Unix-socket probe succeeds against that
 * temporary server, so readiness was declared during the init phase and the
 * next step failed with "the database system is shutting down".
 *
 * The repair is a TCP probe plus a two-consecutive-successes requirement.
 * Asserting the YAML text would only restate the fix, so this extracts the loop
 * from the workflow and drives it against a stubbed probe that replays the
 * exact race. No container, no database, no network.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = parse(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
};

const STARTUP_STEP =
  WORKFLOW.jobs['migrations-postgres']?.steps?.find((step) =>
    (step.run ?? '').includes('pg_isready'),
  )?.run ?? '';

/** Just the readiness loop, up to the failure branch that consumes its result. */
const READINESS_LOOP = STARTUP_STEP.slice(
  STARTUP_STEP.indexOf("ready='false'"),
  STARTUP_STEP.indexOf('if [ "$ready" != \'true\' ]'),
);

/**
 * Replays a fixed sequence of probe outcomes. `y` is a probe that succeeds.
 * `sleep` is stubbed so the test does not spend a real minute per case.
 */
function driveReadiness(outcomes: string): { ready: string; probes: number } {
  const dir = mkdtempSync(join(tmpdir(), 'ci-readiness-'));
  try {
    writeFileSync(join(dir, 'outcomes'), outcomes);
    writeFileSync(join(dir, 'n'), '0');
    writeFileSync(
      join(dir, 'docker'),
      [
        '#!/bin/bash',
        `n=$(cat ${dir}/n); n=$((n+1)); printf '%s' "$n" > ${dir}/n`,
        `c=$(cut -c"$n" ${dir}/outcomes)`,
        '[ "$c" = "y" ] && exit 0',
        'exit 1',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'sleep'), '#!/bin/bash\nexit 0\n');
    chmodSync(join(dir, 'docker'), 0o755);
    chmodSync(join(dir, 'sleep'), 0o755);

    const script = [
      'set -uo pipefail',
      'container_name=stub',
      READINESS_LOOP,
      'printf "%s %s" "$ready" "$(cat ' + dir + '/n)"',
    ].join('\n');
    const stdout = execFileSync('bash', ['-c', script], {
      env: { PATH: `${dir}:${process.env['PATH'] ?? '/usr/bin:/bin'}` },
      encoding: 'utf8',
    });
    const [ready = '', probes = '0'] = stdout.trim().split(' ');
    return { ready, probes: Number(probes) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the disposable-Postgres readiness loop', () => {
  it('probes over TCP so the initdb server cannot answer it', () => {
    expect(READINESS_LOOP).toContain('pg_isready -h 127.0.0.1 -p 5432');
    expect(READINESS_LOOP).not.toMatch(/pg_isready(?![^\n]*-h )/u);
  });

  it('does not accept the init server that answers once and then shuts down', () => {
    // The observed failure: one success, then the temporary server goes away.
    const { ready, probes } = driveReadiness(`ynny${'y'.repeat(60)}`);
    expect(ready).toBe('true');
    // A single-success loop would have declared readiness at probe 1 and the
    // next step would have hit "the database system is shutting down".
    expect(probes, 'readiness must not be declared on the first success').toBe(5);
  });

  it('accepts a server that is healthy from the start, on the second probe', () => {
    expect(driveReadiness('y'.repeat(60))).toEqual({ ready: 'true', probes: 2 });
  });

  it('refuses a server that never reaches two consecutive successes', () => {
    expect(driveReadiness('yn'.repeat(30))).toEqual({ ready: 'false', probes: 60 });
  });

  it('fails closed rather than continuing when readiness is never reached', () => {
    expect(driveReadiness('n'.repeat(60)).ready).toBe('false');
    expect(STARTUP_STEP).toMatch(/if \[ "\$ready" != 'true' \]; then\n\s+classify_startup_failure/u);
    expect(STARTUP_STEP).toMatch(/classify_startup_failure "\$startup_output"\n\s+exit 1/u);
  });
});
