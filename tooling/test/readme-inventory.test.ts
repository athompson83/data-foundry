/**
 * The README's package list has to match the repository it describes.
 *
 * It has now gone stale twice. It described "Wave 1: the contracts layer" long
 * after eight more packages existed, and once that was corrected it still said
 * the consumer surfaces "do not exist" while `apps/api`, `apps/mcp` and
 * `services/export-builder` sat in the workspace. Both times the prose was
 * corrected by hand, which fixes the sentence and not the reason it was wrong:
 * nothing anywhere connected the list to the thing it lists.
 *
 * So the list is checked against `pnpm-workspace.yaml` instead of against a
 * reviewer's memory. Every workspace package must be listed, and every listed
 * path must exist — the second direction matters just as much, because a
 * README that advertises a package somebody deleted misleads a reader exactly
 * as badly as one that omits a package somebody added.
 *
 * Deliberately NOT asserted: the wording of each description. That is
 * editorial, it changes for good reasons, and a test that pinned it would be
 * an obstacle rather than a guarantee. What is asserted is inventory — the part
 * that has a right answer the repository itself knows.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The workspace globs, read from `pnpm-workspace.yaml` rather than hard-coded,
 * so adding a fourth root (say `tools/*`) is covered the day it is added
 * instead of the day somebody remembers this file exists.
 */
function workspaceRoots(): string[] {
  const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [...yaml.matchAll(/^\s*-\s*'([^']+)'/gm)].map((match) => match[1] ?? '');
  expect(globs.length, 'pnpm-workspace.yaml must declare at least one package glob').toBeGreaterThan(
    0,
  );
  // Every glob in this repo is `<dir>/*`. A different shape would need real
  // glob expansion, so it fails loudly here rather than being silently skipped.
  for (const glob of globs) expect(glob, 'unexpected workspace glob shape').toMatch(/^[\w-]+\/\*$/);
  return globs.map((glob) => glob.slice(0, -2));
}

/** Every workspace package directory, as the README would spell it. */
function workspacePackages(): string[] {
  return workspaceRoots()
    .flatMap((root) =>
      readdirSync(join(ROOT, root), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => existsSync(join(ROOT, root, entry.name, 'package.json')))
        .map((entry) => `${root}/${entry.name}/`),
    )
    .sort();
}

/** The paths listed in the README's inventory block. */
function readmeInventory(): string[] {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const block = /```text\n([\s\S]*?)```/.exec(readme);
  expect(block, 'the README must carry a fenced text block listing what is here').not.toBeNull();
  return (block?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim().split(/\s{2,}/)[0] ?? '')
    .filter((path) => path !== '')
    .sort();
}

describe('the README inventory and the workspace', () => {
  it('lists every workspace package', () => {
    const listed = new Set(readmeInventory());
    const missing = workspacePackages().filter((pkg) => !listed.has(pkg));
    expect(missing, 'these packages exist but the README does not mention them').toEqual([]);
  });

  it('lists nothing that does not exist', () => {
    const absent = readmeInventory().filter((path) => !existsSync(join(ROOT, path)));
    expect(absent, 'the README advertises these paths but they are not in the repository').toEqual(
      [],
    );
  });

  it('is reading a real inventory, not an empty one', () => {
    // Both assertions above pass trivially against an empty list, so the
    // parsing is proved separately from what it proves.
    expect(readmeInventory().length).toBeGreaterThan(10);
    expect(workspacePackages().length).toBeGreaterThan(5);
    expect(workspacePackages()).toContain('packages/query-model/');
  });
});
