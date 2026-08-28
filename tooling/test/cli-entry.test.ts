import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

describe('cross-platform CLI entry detection', () => {
  it('compares canonical file URLs instead of concatenating file:// with a Windows path', async () => {
    const module = await import('../lib/cli-entry.js').catch(() => null);
    expect(module, 'tooling needs one shared cross-platform isMain helper').not.toBeNull();
    if (module === null) return;
    const isMain = (module as Record<string, unknown>)['isMain'];
    expect(typeof isMain).toBe('function');
    if (typeof isMain !== 'function') return;

    const entryPath = resolve('tooling', 'scripts', 'probe with spaces.ts');
    const entryUrl = pathToFileURL(entryPath).href;
    expect((isMain as (url: string, entry: string) => boolean)(entryUrl, entryPath)).toBe(true);
    expect((isMain as (url: string, entry: string) => boolean)(entryUrl, resolve('other.ts'))).toBe(false);
  });

  it.each([
    {
      script: 'tooling/scripts/compile-vertical-runtime.ts',
      args: ['--check'],
      expected: 'OK: 1 vertical runtime artifact(s) are up to date.',
    },
    {
      script: 'tooling/scripts/source-readiness.ts',
      args: [],
      expected: 'commercial publication gate:',
    },
  ])('executes $script when tsx receives a Windows filesystem entry path', async ({
    script,
    args,
    expected,
  }) => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TSX_CLI, resolve(REPO_ROOT, script), ...args],
      { cwd: REPO_ROOT },
    );
    expect(stderr).toBe('');
    expect(stdout).toContain(expected);
  });
});
