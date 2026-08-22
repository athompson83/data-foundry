/**
 * AGENTS.md rule 5, asserted structurally rather than by review.
 *
 * > One source of truth. Web/API/MCP must read from the same canonical query
 * > layer.
 *
 * and the architecture boundary that follows it:
 *
 * > Web/API/MCP are interfaces, not business-logic owners.
 *
 * A rule that lives only in a review checklist is a rule that survives until
 * the first hurried afternoon. These tests read the app's own source and fail
 * when it reaches past the query layer: no canonical store, no SQL driver, no
 * SQL text, no re-implemented selection. They are modelled on
 * `packages/query-model/test/driver-boundary.test.ts`, which asserts the same
 * property one layer down.
 *
 * Scope is `src/` only. Test files legitimately talk to the store — they have
 * to create the state a gate is asserted about.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** The one module allowed to name anything outside this app. */
const SEAM = 'query-layer.ts';

function sources(): readonly { file: string; text: string }[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    });
  return walk(SRC).map((path) => ({
    file: relative(SRC, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));
}

/** Every module specifier this file imports from, including re-exports. */
function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

describe('the app reads through the query layer and nothing beneath it', () => {
  it('finds source files at all, so the scan cannot pass vacuously', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((source) => source.file)).toContain(SEAM);
  });

  it('imports the canonical query layer from exactly one module', () => {
    const importers = sources()
      .filter((source) => importSpecifiers(source.text).some((s) => s.includes('query-model')))
      .map((source) => source.file);
    expect(importers).toEqual([SEAM]);
  });

  it('never imports anything below the query layer', () => {
    // Each of these would be a business-logic dependency the query layer exists
    // to own: the store bypasses fact selection and the rights gate; the
    // provenance package is trusted infrastructure that takes a raw driver;
    // `pg`/`pglite` is a database connection sitting inside an interface.
    const forbiddenPackages = [
      '@data-foundry/canonical-store',
      '@data-foundry/canonical-schema',
      '@data-foundry/provenance',
      'pg',
      '@electric-sql/pglite',
      'node:fs',
      'node:child_process',
    ];
    // A relative path is the same dependency written differently.
    const forbiddenPaths = [
      'packages/canonical-store',
      'packages/canonical-schema',
      'packages/provenance',
    ];

    for (const source of sources()) {
      for (const specifier of importSpecifiers(source.text)) {
        const explain =
          `${source.file} imports "${specifier}", which is beneath the canonical query layer. ` +
          'If the query layer does not expose what this app needs, add it there (AGENTS.md ' +
          'rule 5) rather than reaching past it.';
        if (specifier.startsWith('.')) {
          for (const path of forbiddenPaths) {
            expect(specifier.includes(path), explain).toBe(false);
          }
        } else {
          expect(forbiddenPackages, explain).not.toContain(specifier);
        }
      }
    }
  });

  it('reaches outside this app only for the query layer and generated schemas', () => {
    // The complete list of things `apps/mcp/src` may name from elsewhere in the
    // repository. `schemas/canonical/*.json` is a generated build output whose
    // declared consumers include "MCP tool definitions"; it carries no
    // behaviour, and `pnpm schemas:check` keeps it honest.
    const allowed = /^(\.|zod$)/;
    for (const source of sources()) {
      for (const specifier of importSpecifiers(source.text)) {
        expect(allowed.test(specifier), `${source.file} imports "${specifier}"`).toBe(true);
      }
      for (const specifier of importSpecifiers(source.text).filter((s) => s.startsWith('.'))) {
        if (!specifier.includes('/../')) continue;
        expect(
          specifier.includes('packages/query-model') || specifier.includes('schemas/canonical'),
          `${source.file} escapes the app to "${specifier}"`,
        ).toBe(true);
      }
    }
  });

  it('contains no SQL', () => {
    // Business logic in SQL inside an interface is the same violation as
    // importing the store, just harder to grep for later.
    const sql = /\b(SELECT\s+[\s\S]{0,80}?\bFROM\b|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
    for (const source of sources()) {
      expect(sql.test(source.text), `${source.file} appears to contain SQL`).toBe(false);
    }
  });

  it('does not re-implement selection, ranking or redirect following', () => {
    // Named for what they would look like if someone rebuilt them here. The
    // query layer already owns every one of these.
    const smells = [
      /authoritativeSourceTypes\s*[:=]/,
      /\bts_rank\b/,
      /\bsimilarity\s*\(/,
      /resolveRedirect\s*\(/,
      /canPublish\s*\(/,
    ];
    for (const source of sources()) {
      for (const smell of smells) {
        expect(smell.test(source.text), `${source.file} matches ${String(smell)}`).toBe(false);
      }
    }
  });
});

/** Structural: does this value behave like a raw SQL driver, whatever its name? */
function looksLikeSqlDriver(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['query'] === 'function' || typeof candidate['transaction'] === 'function';
}

describe('the server object hands nobody a database', () => {
  it('exposes no driver, no store and nothing that quacks like one', () => {
    // A fake query model is enough: the assertion is about what the server
    // object exposes, not about what it reads.
    const server = createMcpServer({
      queryModel: {} as never,
      vertical: { id: '00000000-0000-4000-8000-000000000000' as never, slug: 'hvac' },
    });

    const reachable = server as unknown as Record<string, unknown>;
    expect('driver' in reachable).toBe(false);
    expect('store' in reachable).toBe(false);
    expect('queryModel' in reachable).toBe(false);
    for (const [name, value] of Object.entries(reachable)) {
      expect(looksLikeSqlDriver(value), `server.${name} quacks like a SQL driver`).toBe(false);
    }
  });

  it('cannot be configured with a driver, only with a query model', () => {
    // The option object is the composition root's entire surface. If a
    // connection string or a store could be passed here, the boundary above
    // would be one config change from irrelevant.
    const declared = createMcpServer.toString();
    expect(declared).not.toContain('createCanonicalStore');
    expect(declared).not.toContain('POSTGRES_URL');
  });
});
