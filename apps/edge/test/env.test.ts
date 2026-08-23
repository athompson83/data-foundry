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
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeConfigurationError, resolveEdgeConfig } from '../src/env.js';

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
   * Every assertion above passes just as happily against an implementation that
   * called `createDriverFromEnv` somewhere else and got PGlite. This one reads
   * the source: the fallback cannot be reached because it is never named.
   */
  it('never imports the helper that would silently produce an empty database', () => {
    const sources = ['env.ts', 'composition.ts', 'index.ts', 'adapter.ts'];
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
