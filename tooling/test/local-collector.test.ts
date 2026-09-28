/**
 * The local collector (apps/local-collector) is Python, standard library only. Its unit tests and the
 * freshness of its compiled source policy run here, so `pnpm test` (and therefore CI) covers them with
 * no workflow change and no Python dependencies.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROHIBITED_SOURCES } from '../../packages/source-registry/src/prohibited-sources.js';
import { EXTRACTION_BEHAVIOUR_SHA256, PUBLISHABLE_EXTRACTORS } from '../../apps/recalls-worker/src/intake.js';
import { extractionBehaviourSha256 } from '../scripts/extraction-behaviour.js';
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
    expect(policy.prohibited_domains).toEqual([...new Set(PROHIBITED_SOURCES.map((source) => source.domain))].sort());
  });

  it("publishes only the collector's own benchmarked extractor build", () => {
    const python = process.env['PYTHON'] ?? 'python3';
    const out = spawnSync(python, ['-c', 'import json; from df_collector import extract, config; c = config.Config(); print(extract.EXTRACTOR_VERSION); print(extract.prompt_sha256()); print(c.model); print(c.model_digest); print(json.dumps(extract.generation(c.num_ctx, c.think), separators=(",", ":")))'], { cwd: APP, encoding: 'utf8' });
    const [version, promptSha, model, pin, generation] = out.stdout.trim().split('\n');
    // The collector's current build must be the benchmarked, publishable one; changing the prompt or pin needs a new benchmark entry.
    const entry = PUBLISHABLE_EXTRACTORS.find((candidate) => candidate.version === version && candidate.promptSha256 === promptSha && candidate.model === model);
    expect(entry).toBeDefined();
    // The collector's default generation settings are the benchmarked ones.
    expect(entry?.generation).toBe(generation);
    // The collector's pin selects the benchmarked build, and the entry's full digest is the one the benchmark recorded.
    expect(entry?.modelDigest.startsWith(pin as string)).toBe(true);
    // The acceptance rules, extractor schema and options are pinned too: changing them needs a re-run benchmark and a
    // reviewed update of EXTRACTION_BEHAVIOUR_SHA256 and the entry (pnpm exec tsx tooling/scripts/extraction-behaviour.ts).
    expect(EXTRACTION_BEHAVIOUR_SHA256).toBe(extractionBehaviourSha256());
    // The collector computes the same fingerprint (df_collector/behaviour.py) and keys its local build by it.
    const collectorFingerprint = spawnSync(python, ['-c', 'from df_collector.behaviour import behaviour_sha256; print(behaviour_sha256())'], { cwd: APP, encoding: 'utf8' }).stdout.trim();
    expect(collectorFingerprint).toBe(EXTRACTION_BEHAVIOUR_SHA256);
    expect(entry?.behaviourSha256).toBe(EXTRACTION_BEHAVIOUR_SHA256);
    const benchmarked = JSON.parse(readFileSync(join(APP, 'benchmark/data/model.json'), 'utf8')) as { name: string; digest: string };
    expect({ model: benchmarked.name, digest: benchmarked.digest }).toEqual({ model: entry?.model, digest: entry?.modelDigest });
  });

  it('passes its Python unit tests (network guard, leases, outbox, policy, model output, dashboard, shared vectors)', () => {
    const python = process.env['PYTHON'] ?? 'python3';
    const version = spawnSync(python, ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' });
    expect(version.stdout.trim(), `${python} 3.11+ is required to test apps/local-collector`).toBe('True');
    const run = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: APP, encoding: 'utf8', env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, timeout: 120_000 });
    expect(run.status, run.stderr.slice(-4000)).toBe(0);
  }, 150_000);

  it('uninstall -Purge goes through the guarded purge, and deletes unchecked data only with -Force', () => {
    // PowerShell is not available in CI; this pins the script's structure.
    const script = readFileSync(join(APP, 'windows', 'uninstall.ps1'), 'utf8');
    expect(script).toMatch(/'purge', '--everything'/);
    expect(script).toMatch(/if \(\$purged -ne 0\) \{ throw/);
    // The only direct delete is on the path where the guard cannot run, and it requires -Force.
    const deletes = script.split('\n').filter((line) => /Remove-Item -Recurse/.test(line));
    expect(deletes).toHaveLength(1);
    expect(script.slice(0, script.indexOf(deletes[0] as string))).toMatch(/if \(-not \$Force\) \{ throw[^\n]*\n\s*$/);
  });
});
