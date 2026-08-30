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
    expect(() => resolveEdgeConfig({ DEPLOYMENT_ENVIRONMENT: 'development', VERTICAL_SLUG: 'hvac' })).toThrow(EdgeConfigurationError);
  });

  it('says what to do about it, because the operator is the only one who can', () => {
    expect(() => resolveEdgeConfig({ DEPLOYMENT_ENVIRONMENT: 'development', VERTICAL_SLUG: 'hvac' })).toThrow(/HYPERDRIVE or set POSTGRES_URL/);
  });

  it('treats blank and whitespace as absent, not as a connection string', () => {
    for (const blank of ['', '   ', '\t']) {
      expect(() => resolveEdgeConfig({ DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: blank, VERTICAL_SLUG: 'hvac' })).toThrow(
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
        env: {
          DEPLOYMENT_ENVIRONMENT: 'development',
          POSTGRES_URL: 'postgres://u:p@127.0.0.1:1/df-default-path',
          VERTICAL_SLUG: 'hvac',
          API_KEY_ENVIRONMENT: 'test',
        },
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
    expect(() => resolveEdgeConfig({ DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://x/y' })).toThrow(/VERTICAL_SLUG/);
  });

  it('trims, so a stray newline in a dashboard variable is not a vertical name', () => {
    expect(() =>
      resolveEdgeConfig({ DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://x/y', VERTICAL_SLUG: '  \n ' }),
    ).toThrow(/VERTICAL_SLUG/);
  });
});

describe('one credential environment per deployment', () => {
  it('refuses an absent or unknown API_KEY_ENVIRONMENT', () => {
    const base = { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://x/y', VERTICAL_SLUG: 'hvac' };
    expect(() => resolveEdgeConfig(base)).toThrow(/API_KEY_ENVIRONMENT/);
    for (const value of ['', 'production', 'LIVE', ' live ', 'test\n']) {
      expect(() => resolveEdgeConfig({ ...base, API_KEY_ENVIRONMENT: value })).toThrow(/live.*test/i);
    }
  });

  it('accepts only an explicit live or test environment', () => {
    for (const apiKeyEnvironment of ['live', 'test'] as const) {
      expect(
        resolveEdgeConfig({
          DEPLOYMENT_ENVIRONMENT: 'development',
          POSTGRES_URL: 'postgres://x/y',
          VERTICAL_SLUG: 'hvac',
          API_KEY_ENVIRONMENT: apiKeyEnvironment,
        }).apiKeyEnvironment,
      ).toBe(apiKeyEnvironment);
    }
  });
});

describe('Hyperdrive outranks a direct connection string', () => {
  it('uses the binding when both are present', () => {
    const config = resolveEdgeConfig({
      DEPLOYMENT_ENVIRONMENT: 'development',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      POSTGRES_URL: 'postgres://origin/db',
      VERTICAL_SLUG: 'hvac',
      API_KEY_ENVIRONMENT: 'test',
    });
    // An operator who bound Hyperdrive did not mean "go around it to the origin".
    expect(config.connectionString).toBe('postgres://hyperdrive/db');
  });

  it('falls back to POSTGRES_URL when no binding exists, for `wrangler dev`', () => {
    const config = resolveEdgeConfig({
      DEPLOYMENT_ENVIRONMENT: 'development',
      POSTGRES_URL: 'postgres://local/db',
      VERTICAL_SLUG: 'hvac',
      API_KEY_ENVIRONMENT: 'test',
    });
    expect(config.connectionString).toBe('postgres://local/db');
    expect(config.verticalSlug).toBe('hvac');
  });
});

describe('production topology is explicit and fail closed', () => {
  const queue = { send: async (): Promise<void> => undefined };

  it.each([undefined, '', ' ', 'preview'])('refuses an absent, blank, or unknown deployment environment: %j', (value) => {
    expect(() =>
      resolveEdgeConfig({
        DEPLOYMENT_ENVIRONMENT: value,
        POSTGRES_URL: 'postgres://fixture/db',
        VERTICAL_SLUG: 'hvac',
        API_KEY_ENVIRONMENT: 'test',
      }),
    ).toThrow(/DEPLOYMENT_ENVIRONMENT/);
  });

  it('requires Hyperdrive instead of a direct origin connection', () => {
    expect(() =>
      resolveEdgeConfig({
        DEPLOYMENT_ENVIRONMENT: 'production',
        POSTGRES_URL: 'postgres://origin/db',
        VERTICAL_SLUG: 'hvac',
        API_KEY_ENVIRONMENT: 'live',
        USAGE_EVENTS_QUEUE: queue,
      }),
    ).toThrow(/HYPERDRIVE/);
  });

  it('requires the asynchronous usage queue binding and live key namespace', () => {
    const base = {
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      VERTICAL_SLUG: 'hvac',
    } as const;
    expect(() => resolveEdgeConfig({ ...base, API_KEY_ENVIRONMENT: 'live' })).toThrow(
      /USAGE_EVENTS_QUEUE/,
    );
    expect(() =>
      resolveEdgeConfig({ ...base, API_KEY_ENVIRONMENT: 'test', USAGE_EVENTS_QUEUE: queue }),
    ).toThrow(/live/);
  });

  it('accepts the complete production binding shape', () => {
    const config = resolveEdgeConfig({
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      VERTICAL_SLUG: 'hvac',
      API_KEY_ENVIRONMENT: 'live',
      USAGE_EVENTS_QUEUE: queue,
    });
    expect(config.deploymentEnvironment).toBe('production');
  });

  it.each([
    'localhost',
    'localhost.',
    'LOCALHOST.',
    'api.localhost.',
    '127.0.0.1',
    '[::1]',
    '[0:0:0:0:0:0:0:1]',
    '[::ffff:7f00:1]',
    '0.0.0.0',
    '[::]',
  ])('refuses canonical loopback or unspecified RapidAPI hostname %s in production', (hostname) => {
    expect(() =>
      resolveEdgeConfig({
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
        VERTICAL_SLUG: 'hvac',
        API_KEY_ENVIRONMENT: 'live',
        USAGE_EVENTS_QUEUE: queue,
        RAPIDAPI_HOSTNAME: hostname,
        RAPIDAPI_PROXY_SECRET: 'test-proxy-secret',
        RAPIDAPI_API_KEY: 'test-api-key',
      }),
    ).toThrow(/loopback/i);
  });
});
