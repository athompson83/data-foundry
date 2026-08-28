/**
 * AGENTS.md rule 5 for `apps/web`, adapted from `apps/api/test/boundary.test.ts`.
 *
 * `apps/web` is not a pure `apps/api`-shaped surface: like `apps/edge`, it
 * owns its own composition root (`composition.ts` says so directly — "the one
 * place in this app allowed to reach below the query layer"), because there is
 * no separate Worker to hand it an already-built `QueryModel`. So the
 * allow-list below applies to every file EXCEPT the composition root itself;
 * everything that renders a page, evaluates a gate, or matches a route must
 * still go through `@data-foundry/query-model` and nothing beneath it.
 *
 * The exclusion is `composition.ts` alone, not a wider "supporting cast" —
 * `env.ts` declares no workspace imports at all, and `index.ts` imports only
 * `composition.ts`'s own public interface, never `@data-foundry/canonical-store`
 * directly. Excluding either would let a future storage or driver import land
 * there unnoticed by this scan; review caught the exclusion list being wider
 * than what actually needs it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The one file allowed to reach below the query layer. */
const COMPOSITION_ROOT_FILES = new Set(['composition.ts']);

const sourceFiles = (): { name: string; text: string }[] => {
  const found: { name: string; text: string }[] = [];
  const walk = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(`${directory}${entry.name}/`, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      found.push({ name: `${prefix}${entry.name}`, text: readFileSync(`${directory}${entry.name}`, 'utf8') });
    }
  };
  walk(SRC, '');
  return found;
};

function importsOf(text: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[1] !== undefined) specifiers.push(match[1]);
    match = pattern.exec(text);
  }
  return specifiers;
}

const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '@data-foundry/query-model',
  '@data-foundry/canonical-schema',
]);

/** Generated data-only module; its JSON-only build graph is verified by tooling tests. */
const ALLOWED_GENERATED_IMPORTS = new Set(['../generated/runtime-registry.js']);

describe('what apps/web is allowed to import outside its composition root (AGENTS.md rule 5)', () => {
  it('contains no NUL control bytes in source files', () => {
    for (const file of sourceFiles()) {
      expect(file.text, `${file.name} contains a NUL byte`).not.toContain('\0');
    }
  });

  it('finds at least one page-rendering file and at least one composition-root file — the scope this test claims to cover', () => {
    const files = sourceFiles();
    expect(files.some((f) => COMPOSITION_ROOT_FILES.has(f.name))).toBe(true);
    expect(files.some((f) => !COMPOSITION_ROOT_FILES.has(f.name))).toBe(true);
  });

  it('imports nothing beneath the canonical query layer, outside the composition root', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      if (COMPOSITION_ROOT_FILES.has(file.name)) continue;
      for (const specifier of importsOf(file.text)) {
        // A relative climb (`../`) is exactly what this scan exists to catch
        // when it reaches into another package's `src/` — see apps/api's own
        // boundary test for why. A `.json` data import is different in kind:
        // it has no imports of its own, so it cannot itself reach below the
        // query layer, however many directories it climbs to get there —
        // `index.ts`'s `../generated/*.web-runtime.json` is exactly this case.
        const local =
          specifier.startsWith('./') ||
          specifier.startsWith('node:') ||
          specifier.endsWith('.json') ||
          ALLOWED_GENERATED_IMPORTS.has(specifier);
        if (local || ALLOWED_WORKSPACE_IMPORTS.has(specifier)) continue;
        violations.push(`${file.name} → ${specifier}`);
      }
    }
    expect(
      violations,
      'add the capability to @data-foundry/query-model instead of reaching past it',
    ).toEqual([]);
  });

  it('names no package that owns storage, ingestion or provenance, outside the composition root', () => {
    const forbidden = ['canonical-store', 'ingest-worker', 'acquisition', 'extraction', 'normalization', 'source-registry', 'pglite', 'pg'];
    for (const file of sourceFiles()) {
      if (COMPOSITION_ROOT_FILES.has(file.name)) continue;
      for (const specifier of importsOf(file.text)) {
        for (const name of forbidden) {
          expect(specifier, `${file.name} imports ${specifier}`).not.toContain(name);
        }
      }
    }
  });

  it('writes no SQL and touches no driver or store handle, outside the composition root', () => {
    for (const file of sourceFiles()) {
      if (COMPOSITION_ROOT_FILES.has(file.name)) continue;
      for (const fragment of ['SELECT ', 'INSERT INTO', 'DELETE FROM', 'UPDATE ']) {
        expect(file.text, `${file.name} contains ${fragment}`).not.toContain(fragment);
      }
    }
  });

  it('declares every workspace package it imports, so the contract is in package.json', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const declared = manifest.dependencies ?? {};

    const imported = new Set<string>();
    for (const file of sourceFiles()) {
      for (const specifier of importsOf(file.text)) {
        if (specifier.startsWith('@data-foundry/')) imported.add(specifier);
      }
    }
    expect(imported.size, 'no workspace import found — this check would pass vacuously').toBeGreaterThan(0);
    for (const specifier of imported) {
      expect(declared[specifier], `${specifier} is imported but not declared`).toBe('workspace:*');
    }
  });
});
