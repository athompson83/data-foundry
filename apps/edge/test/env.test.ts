/**
 * The configuration guard, and the one failure mode it exists to prevent.
 *
 * `createDriverFromEnv` in the store falls back to PGlite when no connection
 * string is set. That is correct there and would be a silent disaster here: a
 * Worker deployed without a database bound would boot, answer every request
 * successfully, and serve an empty in-memory database as though it were the
 * product. No error, no alert, just zero results.
 *
 * So the property under test is not "it reads env vars". It is that this
 * package never reaches that fallback, and refuses instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeConfigurationError, resolveEdgeConfig } from '../src/env.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('a Worker with no database refuses to serve', () => {
  it('throws rather than returning a connectionless config', () => {
    expect(() => resolveEdgeConfig({ VERTICAL_SLUG: 'hvac' })).toThrow(EdgeConfigurationError);
  });

  it('says what to do about it, because the operator is the only one who can', () => {
    expect(() => resolveEdgeConfig({ VERTICAL_SLUG: 'hvac' })).toThrow(/HYPERDRIVE or set POSTGRES_URL/);
  });

  it('treats blank and whitespace as absent, not as a connection string', () => {
    for (const blank of ['', '   ', '\t']) {
      expect(() => resolveEdgeConfig({ POSTGRES_URL: blank, VERTICAL_SLUG: 'hvac' })).toThrow(
        EdgeConfigurationError,
      );
    }
  });

  /**
   * The control that makes the rest of this file more than a wish.
   *
   * Composed with no `openDriver` override — the real default path — and pointed
   * at a closed port. A Worker that reached Postgres fails to connect. A Worker
   * that had drifted to PGlite would **succeed**, because PGlite ignores the
   * connection string entirely, and would then serve an empty database.
   *
   * So the assertion is the failure. This replaces an earlier source scan that
   * only proved an identifier was absent; review pointed out it could not see an
   * aliased import, a wrapper module or a dynamic specifier, which is exactly
   * right. Behaviour can.
   *
   * Bounded explicitly: a hung connection is not a regression assertion. The
   * observed refusal is ~30ms, so 15s is failure, not slowness.
   */
  it(
    'reaches a real Postgres by default, and fails rather than inventing one',
    async () => {
      const attempt = getDeployment({
        // A port nothing listens on, on the loopback, so there is no DNS and no
        // network wait — the refusal is immediate and deterministic.
        env: { POSTGRES_URL: 'postgres://u:p@127.0.0.1:1/df-default-path', VERTICAL_SLUG: 'hvac' },
        runtime: RUNTIMES['hvac'] as never,
      });

      await expect(attempt).rejects.toThrow(/ECONNREFUSED|ENOTFOUND|connect/i);
      resetDeployments();
    },
    15_000,
  );

  /**
   * Kept as a cheap lint, and demoted on purpose.
   *
   * It cannot see an aliased import, a re-export or a dynamic specifier, so it
   * is not the guarantee — the behavioural test above is. What it still buys is
   * a fast, legible failure the day somebody adds a new file to `src/` that
   * imports a PGlite factory directly, which is the likeliest way this would
   * actually regress.
   *
   * Neither this nor the behavioural test above can say whether PGlite's
   * *bytes* actually ship in the built Worker — a source scan cannot see
   * past a dynamic `import()`, and "never called" is a runtime fact, not a
   * bundler one. `test/artifact.test.ts` is the one that builds the real
   * entry point and checks the artifact.
   */
  it('does not name a PGlite factory in src/ either', () => {
    // Enumerated recursively, not listed. The first version named four files,
    // and `test/bundle.test.ts` demonstrated the consequence: adding a fifth
    // file that imports the PGlite factory left this test GREEN while the WASM
    // database was in the deployed bundle. The second version enumerated the
    // directory — and `readdirSync` is not recursive, so it had the same defect
    // one level down. `src/` is flat today; a control that only holds while the
    // tree stays flat is the same mistake wearing a different hat.
    const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) =>
      file.endsWith('.ts'),
    );
    expect(sources.length).toBeGreaterThan(3);
    // Comments are stripped first. The doc comments here *name* the fallback in
    // order to explain why it is avoided, and a scan that could not tell prose
    // from code would force the explanation out of the file to stay green.
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const offenders = sources.filter((file) =>
      /createDriverFromEnv|createPgliteDriver/.test(withoutComments(readFileSync(join(SRC, file), 'utf8'))),
    );
    expect(
      offenders,
      'a Worker that can fall back to PGlite can serve an empty database as though it were real',
    ).toEqual([]);
  });
});

describe('one vertical per deployment', () => {
  it('refuses a deployment that does not name one', () => {
    expect(() => resolveEdgeConfig({ POSTGRES_URL: 'postgres://x/y' })).toThrow(/VERTICAL_SLUG/);
  });

  it('trims, so a stray newline in a dashboard variable is not a vertical name', () => {
    expect(() =>
      resolveEdgeConfig({ POSTGRES_URL: 'postgres://x/y', VERTICAL_SLUG: '  \n ' }),
    ).toThrow(/VERTICAL_SLUG/);
  });
});

describe('Hyperdrive outranks a direct connection string', () => {
  it('uses the binding when both are present', () => {
    const config = resolveEdgeConfig({
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      POSTGRES_URL: 'postgres://origin/db',
      VERTICAL_SLUG: 'hvac',
    });
    // An operator who bound Hyperdrive did not mean "go around it to the origin".
    expect(config.connectionString).toBe('postgres://hyperdrive/db');
  });

  it('falls back to POSTGRES_URL when no binding exists, for `wrangler dev`', () => {
    const config = resolveEdgeConfig({ POSTGRES_URL: 'postgres://local/db', VERTICAL_SLUG: 'hvac' });
    expect(config.connectionString).toBe('postgres://local/db');
    expect(config.verticalSlug).toBe('hvac');
  });
});
