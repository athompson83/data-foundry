import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

describe('local collector policy CLI', () => {
  it('runs the check for the actual platform entry path instead of silently skipping it', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'tooling', 'scripts', 'local-collector-policy.ts'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('apps/local-collector/policy/sources.json is current');
  });
});
