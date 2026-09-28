/**
 * The local collector (apps/local-collector) is Python, standard library only. Its unit tests and the
 * freshness of its compiled source policy run here, so `pnpm test` (and therefore CI) covers them with
 * no workflow change and no Python dependencies.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compilePolicy } from '../scripts/local-collector-policy.js';

const ROOT = join(import.meta.dirname, '..', '..');
const APP = join(ROOT, 'apps', 'local-collector');

describe('local collector', () => {
  it('ships a source policy compiled from the current registry', () => {
    expect(readFileSync(join(APP, 'policy', 'sources.json'), 'utf8'), 'run: pnpm collector:policy').toBe(compilePolicy());
  });

  it('enables only registered GREEN/AMBER tasks with a rights record', () => {
    const policy = JSON.parse(compilePolicy()) as { tasks: Array<{ task: string; enabled: boolean; rights: string; refused_because: string[] }>; prohibited_domains: string[] };
    for (const task of policy.tasks) {
      if (task.enabled) {
        expect(['GREEN', 'AMBER']).toContain(task.rights);
        expect(task.refused_because).toEqual([]);
      }
    }
    expect(policy.prohibited_domains).toContain('ahridirectory.org');
  });

  it('passes its Python unit tests (network guard, leases, outbox, policy, model output, dashboard, shared vectors)', () => {
    const python = process.env['PYTHON'] ?? 'python3';
    const version = spawnSync(python, ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' });
    expect(version.stdout.trim(), `${python} 3.11+ is required to test apps/local-collector`).toBe('True');
    const run = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: APP, encoding: 'utf8', env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, timeout: 120_000 });
    expect(run.status, run.stderr.slice(-4000)).toBe(0);
  }, 150_000);
});
