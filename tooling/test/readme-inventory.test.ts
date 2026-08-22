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

/** Every `.ts` file under a directory, recursively. */
function typescriptUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts')) found.push(path);
    }
  };
  walk(dir);
  return found;
}

/** Import specifiers, whatever quote or form they use. */
const importsOf = (code: string): string[] =>
  [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

describe('the README claims that name specific code', () => {
  /**
   * The inventory check below catches a package appearing or disappearing. It
   * cannot catch a sentence that is wrong about what the code DOES, and two of
   * those shipped: the README said all three surfaces "read through
   * `packages/query-model` and nothing beneath it" while
   * `services/export-builder` imports and calls `canonical-store`, and it
   * credited `surface-parity.test.ts` with holding all three when that file
   * imports two.
   *
   * Both are now derived from the code rather than asserted about it.
   */
  const readme = (): string => readFileSync(join(ROOT, 'README.md'), 'utf8');

  const BENEATH_QUERY_LAYER =
    /@data-foundry\/(canonical-store|provenance)|packages\/(canonical-store|provenance)/;

  it('names as query-layer-only exactly the surfaces that import nothing beneath it', () => {
    const clean: string[] = [];
    const reaches: string[] = [];
    for (const surface of ['apps/api', 'apps/mcp', 'services/export-builder']) {
      const offends = typescriptUnder(join(ROOT, surface, 'src')).some((file) =>
        importsOf(readFileSync(file, 'utf8')).some((specifier) =>
          BENEATH_QUERY_LAYER.test(specifier),
        ),
      );
      (offends ? reaches : clean).push(surface);
    }
    expect(clean.length + reaches.length, 'all three surfaces must be scanned').toBe(3);

    const text = readme();
    for (const surface of clean) {
      expect(text, `${surface} imports nothing beneath the query layer`).toContain(surface);
    }
    // The README must not claim the reaching surfaces are clean. It says so by
    // naming what they reach for, so the claim and the code move together.
    for (const surface of reaches) {
      expect(
        text.includes('`packages/canonical-store`') || text.includes('canonical-store'),
        `${surface} reaches beneath the query layer; the README must say so`,
      ).toBe(true);
    }
    expect(
      text,
      'the corrected sentence must not have reverted to the blanket claim',
    ).not.toMatch(/All three\s+read through `packages\/query-model` and nothing beneath it/);
  });

  it('credits the parity test only with the surfaces it actually imports', () => {
    const named = /`(tests\/contract\/[\w.-]+\.test\.ts)`/.exec(readme())?.[1];
    expect(named, 'the README must name the cross-surface parity test').toBeDefined();
    const parity = readFileSync(join(ROOT, named as string), 'utf8');
    const covered = ['apps/api', 'apps/mcp', 'services/export-builder'].filter((surface) =>
      parity.includes(surface),
    );
    expect(covered, 'the parity test must cover something, or this proves nothing').not.toEqual([]);

    // Whatever it covers, the README must not say it holds a surface it never
    // imports. Asserted as a sentence the corrected text does not contain.
    for (const surface of ['apps/api', 'apps/mcp', 'services/export-builder']) {
      if (covered.includes(surface)) continue;
      expect(
        readme(),
        `${named ?? ''} does not import ${surface}; the README must not credit it with holding it`,
      ).toContain('The export builder is not in that test');
    }
  });
});

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

  it('is reading a real inventory, and one that reaches every workspace root', () => {
    // Both assertions above pass trivially against an empty list, so the
    // parsing is proved separately from what it proves.
    //
    // "Not empty" was not enough. This check used to be `> 10`, `> 5` and
    // `toContain('packages/query-model/')` — all three satisfied by the eight
    // `packages/*` entries alone, so an enumeration that silently dropped
    // `apps/*` and `services/*` passed, and with it a README that had stopped
    // mentioning `apps/api` at all. A root that contributes nothing is
    // therefore a failure rather than a quiet zero.
    const listed = readmeInventory();
    const packages = workspacePackages();
    expect(listed.length).toBeGreaterThan(10);
    expect(packages.length).toBeGreaterThan(5);

    const roots = workspaceRoots();
    expect(roots.length, 'pnpm-workspace.yaml declares more than one root').toBeGreaterThan(1);
    for (const root of roots) {
      expect(
        packages.filter((name) => name.startsWith(`${root}/`)),
        `nothing enumerated under the declared workspace root ${root}/*`,
      ).not.toEqual([]);
    }

    // Named anchors from more than one root, so dropping a whole root cannot
    // pass as "there just are not any there".
    expect(packages).toEqual(
      expect.arrayContaining([
        'packages/query-model/',
        'apps/api/',
        'services/export-builder/',
      ]),
    );
  });
});
