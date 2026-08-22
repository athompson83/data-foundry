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
import ts from 'typescript';
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

/**
 * Every module specifier a file names, in every form TypeScript has for naming
 * one — imports, re-exports, side-effect imports, `import()` in both value and
 * type position, and `import x = require()`.
 *
 * This was a regular expression over the file text, and what it missed was not
 * exotic. `import 'pg'` has no `from` clause for the pattern to anchor on;
 * `await import('@data-foundry/canonical-store')` has neither `import ... from`
 * nor a line to start on; a double-quoted specifier did not match a
 * single-quoted pattern; a second `import` on one line fell outside the
 * line anchor; and a `// from './x.js'` written inside a multi-line import list
 * ended the lazy match early, so the scan reported the decoy and never saw the
 * real specifier underneath it. Every one of those is a way to reach the store
 * from inside this app while nine boundary assertions pass, which makes the
 * rule a review convention again — the exact thing this file exists to replace.
 *
 * So the scan asks the compiler's own parser rather than pattern-matching text.
 * It cannot disagree with what the module system actually does, and a form
 * added to the language arrives as a node kind rather than as a regex nobody
 * updated. `tooling/test/typecheck-coverage.test.ts` reads the compiler the
 * same way for the same reason.
 */
function importSpecifiers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: string[] = [];

  const record = (node: ts.Node | undefined): void => {
    // A computed specifier is not a string literal and cannot be resolved
    // statically by anything, this scan included; there are none in `src`.
    if (node !== undefined && ts.isStringLiteralLike(node)) found.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      // `import ... from 'x'`, `import 'x'`, `export ... from 'x'`. An export
      // with nothing to re-export from has no specifier, hence the undefined.
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      record(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      // `type Store = import('@data-foundry/canonical-store').CanonicalStore`
      // is a dependency on the store's shape, written where a regex over
      // import statements would never look.
      record(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/** Every specifier named anywhere in `src`, with the file that names it. */
function importsInSource(): readonly { file: string; specifier: string }[] {
  return sources().flatMap((source) =>
    importSpecifiers(source.file, source.text).map((specifier) => ({
      file: source.file,
      specifier,
    })),
  );
}

describe('the app reads through the query layer and nothing beneath it', () => {
  it('finds source files at all, so the scan cannot pass vacuously', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((source) => source.file)).toContain(SEAM);
  });

  it('sees a specifier however it is written', () => {
    // The scan is the enforcement, so its blind spots are the boundary's. Every
    // one of these is a real way to name a module. The pattern this replaced
    // read some of them and walked past the rest — the side-effect import, the
    // dynamic and type-position `import()`, `import x = require()`, the
    // double-quoted specifier, the second import on a line, and the one hidden
    // behind a `from` in a comment.
    const forms = [
      "import * as store from '@data-foundry/canonical-store';",
      'import { createCanonicalStore as make } from "@data-foundry/canonical-store";',
      "import type { CanonicalStore } from '@data-foundry/canonical-store';",
      "import { type CanonicalStore } from '@data-foundry/canonical-store';",
      "export * from '@data-foundry/canonical-store';",
      "export * as store from '@data-foundry/canonical-store';",
      "export { createCanonicalStore } from '@data-foundry/canonical-store';",
      "import '@data-foundry/canonical-store';",
      "const store = await import('@data-foundry/canonical-store');",
      "type Store = import('@data-foundry/canonical-store').CanonicalStore;",
      "import store = require('@data-foundry/canonical-store');",
      "import a from './guard.js'; import b from '@data-foundry/canonical-store';",
      "import {\n  a, // from './decoy.js'\n} from '@data-foundry/canonical-store';",
    ];
    for (const form of forms) {
      expect(importSpecifiers('probe.ts', form), form).toContain('@data-foundry/canonical-store');
    }
  });

  it('imports the canonical query layer from exactly one module', () => {
    const importers = [
      ...new Set(
        importsInSource()
          .filter((entry) => entry.specifier.includes('query-model'))
          .map((entry) => entry.file),
      ),
    ];
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

    for (const { file, specifier } of importsInSource()) {
      const explain =
        `${file} imports "${specifier}", which is beneath the canonical query layer. ` +
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
  });

  it('reaches outside this app only for the query layer and generated schemas', () => {
    // The complete list of things `apps/mcp/src` may name from elsewhere in the
    // repository. `schemas/canonical/*.json` is a generated build output whose
    // declared consumers include "MCP tool definitions"; it carries no
    // behaviour, and `pnpm schemas:check` keeps it honest.
    //
    // `@data-foundry/query-model` is anchored, so it permits that one package
    // entry point and no other bare specifier — not a deep import into its
    // `src/`, and not a sibling `@data-foundry/*` package. It replaced a
    // relative climb out of the app, which the `^\.` arm below still allows for
    // the generated schemas; the arm immediately after is what keeps that from
    // becoming a way back down to the store.
    const allowed = /^(\.|zod$|@data-foundry\/query-model$)/;
    for (const { file, specifier } of importsInSource()) {
      expect(allowed.test(specifier), `${file} imports "${specifier}"`).toBe(true);
      if (!specifier.startsWith('.') || !specifier.includes('/../')) continue;
      expect(
        specifier.includes('schemas/canonical'),
        `${file} escapes the app to "${specifier}"`,
      ).toBe(true);
    }
  });

  it('declares the query layer as a dependency, so the contract is in package.json', () => {
    // The defect this replaces: `apps/mcp` reached the query layer by climbing
    // out of its own directory and declared no dependencies at all, so nothing
    // outside this exact repository layout could resolve it and `pnpm pack`
    // would have shipped a package that cannot build.
    const manifest = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const declared = manifest.dependencies ?? {};

    const imported = new Set<string>(
      importsInSource()
        .map((entry) => entry.specifier)
        .filter((specifier) => !specifier.startsWith('.')),
    );
    expect(imported, 'no bare import found — this check would pass vacuously').toContain(
      '@data-foundry/query-model',
    );
    for (const specifier of imported) {
      expect(declared[specifier], `${specifier} is imported but not declared`).toBeDefined();
    }
    expect(declared['@data-foundry/query-model']).toBe('workspace:*');
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
