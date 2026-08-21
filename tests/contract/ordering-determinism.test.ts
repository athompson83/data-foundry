/**
 * #14 — the layers that decide what gets published may not consult a collator.
 *
 * `@data-foundry/normalization` already enforces this for itself: no
 * `localeCompare`, no `toLocaleUpperCase`, no `Intl`, because "they make output
 * depend on the machine that ran the pipeline, which would make golden records
 * a fiction". The same is true one layer up, and was not enforced there — fact
 * selection, entity resolution and the query layer each broke a tie with the
 * host's collator, so `abc-9001` was published on an `en_US` machine and
 * `ABC-9001` on a `da_DK` one from identical inputs.
 *
 * `compareCodeUnits` from `@data-foundry/canonical-schema` is the replacement.
 * This guard exists so the next person who reaches for `localeCompare` in a
 * sort finds out at test time rather than after two environments disagree about
 * a customer-visible name.
 *
 * The database side of the same rule is not scannable from here and is handled
 * where it arises: an `ORDER BY` whose result is a *decision* rather than a
 * display carries `COLLATE "C"` (see `listAliases`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../support/harness.js';

/** Every layer that computes, selects or serves a canonical answer. */
const GUARDED_ROOTS = [
  join('packages', 'canonical-schema', 'src'),
  join('packages', 'canonical-store', 'src'),
  join('packages', 'query-model', 'src'),
  join('packages', 'provenance', 'src'),
  join('services', 'ingest-worker', 'src'),
];

function sourceFiles(root: string): string[] {
  const absolute = join(REPO_ROOT, root);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) found.push(path);
    }
  };
  walk(absolute);
  return found;
}

/** Comments name the banned APIs to explain them; only code is scanned. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('canonical decisions are locale-independent', () => {
  it('scans a non-trivial number of files, so a path typo cannot pass vacuously', () => {
    const total = GUARDED_ROOTS.reduce((count, root) => count + sourceFiles(root).length, 0);
    expect(total).toBeGreaterThan(40);
  });

  it('consults no collator anywhere on the path to a published value', () => {
    for (const root of GUARDED_ROOTS) {
      for (const file of sourceFiles(root)) {
        const code = stripComments(readFileSync(file, 'utf8'));
        expect(
          code,
          `${file.slice(REPO_ROOT.length + 1)} must order by code unit ` +
            '(compareCodeUnits), never by the host collator',
        ).not.toMatch(/\.localeCompare\(|toLocale[A-Z]|\bIntl\./);
      }
    }
  });
});
