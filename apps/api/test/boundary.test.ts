/**
 * ADR-0004's deferred enforcement, now that a surface exists.
 *
 * > "When the first customer-facing surface lands, add a boundary test
 * > asserting that no module outside `@data-foundry/query-model` constructs a
 * > fact wire object literal — the same shape of dependency-boundary test used
 * > elsewhere in the repository, rather than reviewer discipline."
 *
 * This is that test, plus the rule-5 half: what this package is allowed to
 * import at all. Both are structural — they read the source rather than trust
 * a convention — because the failure they prevent is invisible at runtime. A
 * second fact serializer does not crash; it just quietly omits
 * `editoriallyCorrected` until someone notices in production.
 *
 * No database here on purpose: these are properties of the source tree.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contractDocument, matchRoute, ROUTES } from '../src/routes.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const sourceFiles = (): { name: string; text: string }[] =>
  readdirSync(SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(`${SRC}${name}`, 'utf8') }));

/** Every module specifier a file imports from. */
function importsOf(text: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s+'([^']+)'/g;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[1] !== undefined) specifiers.push(match[1]);
    match = pattern.exec(text);
  }
  return specifiers;
}

/**
 * The complete allow-list, and why each entry is on it.
 *
 *   * `query-model/src/index.js` — the canonical query layer, and the reason
 *     this package exists. `index.js` is the package's own declared `exports["."]`
 *     target, so this is the public entry point resolved by path, not a deep
 *     import into its internals.
 *   * `canonical-schema/src/index.js` — the shared object model. It owns no
 *     storage, no SQL and no selection logic, and the query layer's own public
 *     signatures are expressed in it: `getEntity(id: EntityId)` cannot be called
 *     without it. Validating a path segment with `EntityIdSchema` rather than a
 *     hand-rolled regex is rule 5 applied to validation.
 *
 * Nothing else. In particular not `canonical-store` — not even for a type —
 * because one import is all it takes for the next handler to reach a driver.
 */
const ALLOWED_WORKSPACE_IMPORTS = new Set([
  '../../../packages/query-model/src/index.js',
  '../../../packages/canonical-schema/src/index.js',
]);

describe('what apps/api is allowed to import (AGENTS.md rule 5)', () => {
  it('imports nothing beneath the canonical query layer', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      for (const specifier of importsOf(file.text)) {
        const local = specifier.startsWith('./') || specifier.startsWith('node:');
        if (local || ALLOWED_WORKSPACE_IMPORTS.has(specifier)) continue;
        violations.push(`${file.name} → ${specifier}`);
      }
    }
    expect(
      violations,
      'add the capability to @data-foundry/query-model instead of reaching past it',
    ).toEqual([]);
  });

  it('names no package that owns storage, ingestion or provenance', () => {
    const forbidden = [
      'canonical-store',
      'provenance',
      'ingest-worker',
      'acquisition',
      'extraction',
      'normalization',
      'source-registry',
      'pglite',
      'pg',
    ];
    for (const file of sourceFiles()) {
      for (const specifier of importsOf(file.text)) {
        for (const name of forbidden) {
          expect(specifier, `${file.name} imports ${specifier}`).not.toContain(name);
        }
      }
    }
  });

  it('deep-imports nothing from the query layer but its public entry', () => {
    for (const file of sourceFiles()) {
      for (const specifier of importsOf(file.text)) {
        if (!specifier.includes('query-model')) continue;
        expect(specifier, file.name).toBe('../../../packages/query-model/src/index.js');
      }
    }
  });

  it('writes no SQL and touches no driver or store handle', () => {
    for (const file of sourceFiles()) {
      for (const fragment of ['SELECT ', 'INSERT INTO', 'DELETE FROM', 'UPDATE ']) {
        expect(file.text, `${file.name} contains ${fragment}`).not.toContain(fragment);
      }
      // `QueryModel` exposes neither, so a mention could only be an attempt to
      // reach around it (query-model/test/driver-boundary.test.ts).
      expect(file.text, file.name).not.toMatch(/\.driver\b/);
      expect(file.text, file.name).not.toMatch(/\.store\b/);
    }
  });
});

describe('ADR-0004 — one fact serializer, shared', () => {
  it('routes every fact through the query layer’s mapper, from one file', () => {
    const users = sourceFiles().filter((file) => file.text.includes('toRestFact'));
    expect(users.map((file) => file.name)).toEqual(['wire.ts']);
  });

  it('constructs no fact wire object anywhere else', () => {
    // The camelCase field names only exist on the shared wire shape. A literal
    // carrying them outside `wire.ts` is a second serializer by definition.
    const factWireFields = [
      'editoriallyCorrected',
      'editorialCorrectionReason',
      'selectionWarnings',
      'unresolvedConflict',
      'valueType',
    ];
    for (const file of sourceFiles()) {
      if (file.name === 'wire.ts') continue;
      for (const field of factWireFields) {
        expect(file.text, `${file.name} builds a fact wire field: ${field}`).not.toContain(
          `${field}:`,
        );
      }
    }
  });

  it('adds nothing to the mapper’s output', () => {
    // `factWire` is the mapper plus the privacy guard, and nothing else. If it
    // ever starts composing fields, ADR-0004's single-serializer property is
    // gone whether or not the field names above happen to appear.
    const wire = sourceFiles().find((file) => file.name === 'wire.ts');
    const body = wire?.text.slice(wire.text.indexOf('export function factWire')) ?? '';
    const implementation = body.slice(0, body.indexOf('\n}'));
    expect(implementation).toContain('toRestFact(view)');
    expect(implementation).toContain('assertNoReviewerIdentity');
    expect(implementation).not.toContain('...');
  });
});

describe('the published contract matches the routes that exist', () => {
  const document = contractDocument('v1') as {
    routes: { path: string; summary: string; caveat?: string }[];
    supportedVersions: string[];
    readOnly: boolean;
    methods: string[];
  };

  const segmentsOf = (path: string): string[] =>
    (path.split('?')[0] ?? '')
      .split('/')
      .filter((segment) => segment !== '')
      .slice(1)
      .map((segment) => (segment.startsWith('{') ? 'placeholder' : segment));

  it('advertises only routes that actually route', () => {
    for (const route of document.routes) {
      expect(matchRoute(segmentsOf(route.path)), route.path).not.toBeNull();
    }
  });

  it('documents every route that exists, so the table cannot drift', () => {
    const documented = new Set(document.routes.map((route) => route.path));
    for (const route of ROUTES) {
      // The `by-slug` arm with no slug is an error-shaping guard, not a resource.
      if (route.pattern.at(-1) === 'by-slug') continue;
      expect(documented, route.path).toContain(route.path);
    }
  });

  it('gives every route a summary, and states the caveats that exist', () => {
    for (const route of document.routes) {
      expect(route.summary.length, route.path).toBeGreaterThan(20);
    }
    const caveats = document.routes.filter((route) => route.caveat !== undefined);
    // The two honest limitations: unrights-gated traversal, and comparison
    // cells that carry no correction state.
    expect(caveats.map((route) => route.path).length).toBeGreaterThanOrEqual(2);
  });

  it('says in the document itself that the surface is read-only', () => {
    expect(document.readOnly).toBe(true);
    expect(document.methods).toEqual(['GET', 'HEAD']);
    expect(document.supportedVersions).toEqual(['v1']);
  });
});
