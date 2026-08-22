/**
 * `pnpm typecheck` must actually check every TypeScript file in the repository.
 *
 * It did not. `tsconfig.json` listed `packages/*`, `tooling/**` and `tests/**`,
 * so the whole of `services`, each vertical's own `tests` directory and the
 * per-package `vitest.config.ts` files were outside the compiler's root set. Most of them were still checked,
 * but only *incidentally* — as transitive imports of a file that was in the set.
 *
 * That distinction is the bug. A file nothing imports is checked by nothing:
 * `services/ingest-worker/src/cli.ts` accepted
 *
 *     const probe: number = 'definitely not a number';
 *
 * and `pnpm typecheck` exited 0. Every entry point has that shape by
 * definition — a CLI, a server, a worker — and so does every test file, which
 * Vitest transpiles without checking.
 *
 * The assertion is deliberately exception-free: every tracked `.ts` file, no
 * allowlist. An allowlist here would recreate the hole it closes, because the
 * next unchecked directory would be added to the list rather than to the
 * config.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The files `tsc -p tsconfig.json` treats as roots, repository-relative. */
function compilerRootSet(): ReadonlySet<string> {
  const configPath = join(ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(read.error, 'tsconfig.json must parse').toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toEqual([]);
  return new Set(parsed.fileNames.map((file) => relative(ROOT, file).replaceAll('\\', '/')));
}

/** Tracked TypeScript sources. Declaration files have nothing to check. */
function trackedTypeScript(): readonly string[] {
  return execFileSync('git', ['ls-files', '*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.endsWith('.d.ts'));
}

describe('the typecheck gate covers the whole repository', () => {
  it('leaves no tracked TypeScript file outside the compiler’s root set', () => {
    const roots = compilerRootSet();
    const unchecked = trackedTypeScript()
      .filter((file) => !roots.has(file))
      .sort();
    expect(
      unchecked,
      'these files are only checked if something else imports them, so an entry ' +
        'point or test file among them is checked by nothing. Add the directory ' +
        'to `include` in tsconfig.json rather than listing exceptions here.',
    ).toEqual([]);
  });

  it('finds files at all, so an empty scan cannot pass vacuously', () => {
    expect(trackedTypeScript().length).toBeGreaterThan(100);
    expect(compilerRootSet().size).toBeGreaterThan(100);
  });

  it('covers the directories that later waves add surfaces to', () => {
    // `apps/*` is a pnpm workspace root with no members yet. The include globs
    // must already cover it, or the first API/MCP server lands unchecked and
    // nothing says so.
    const read = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
    const include = (read.config as { include?: readonly string[] }).include ?? [];
    for (const required of ['apps/*/src/**/*.ts', 'services/*/src/**/*.ts']) {
      expect(include, `tsconfig.json must include ${required}`).toContain(required);
    }
  });
});
