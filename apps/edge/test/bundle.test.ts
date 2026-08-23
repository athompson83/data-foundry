/**
 * What actually ships, rather than what the source appears to import.
 *
 * `env.test.ts` already carries two controls against a PGlite fallback, and
 * both are honest about their limits. The behavioural one proves the deployment
 * refuses a dead Postgres rather than quietly serving an empty in-memory
 * database. The source scan reads four files in `src/` for the names of the
 * PGlite factories and says of itself that it "cannot see an aliased import, a
 * re-export or a dynamic specifier".
 *
 * That caveat is not hypothetical here. `packages/canonical-store/src/index.ts`
 * re-exports `createPgliteDriver` from the same barrel that
 * `composition.ts` imports `createCanonicalStore` and `createPostgresDriver`
 * from. Nothing in `apps/edge/src` names the PGlite factory, so the source scan
 * is green — and whether the WASM database is in the deployed Worker is decided
 * entirely by whether the bundler eliminates it. Neither existing test can see
 * that, because neither one bundles anything.
 *
 * So this builds the Worker the way Wrangler will and asserts against the bytes.
 * It is slower than a grep, and it is the only control here that answers the
 * question actually being asked.
 *
 * ## This was mutation-tested, and it found a real hole
 *
 * Adding a fifth file to `src/` that imports `createPgliteDriver`, and reaching
 * it from `composition.ts`, left the source scan **green** — it read a hardcoded
 * list of four filenames — while three assertions here went red, including the
 * one for `WebAssembly.instantiate`. The WASM build of Postgres was genuinely in
 * the bundle and the existing control could not see it.
 *
 * The scan now enumerates `src/` rather than listing it, so both controls catch
 * that mutation. They are still worth having separately: the scan fails in
 * milliseconds with a legible message, and this one is the only thing that can
 * see a dependency arriving through a package barrel neither file names.
 *
 * ## Why this matters more than bundle size
 *
 * A Worker that can reach PGlite can fall back to it. A fallback that fires in
 * production serves an EMPTY DATABASE THAT ANSWERS SUCCESSFULLY — 200s,
 * well-formed envelopes, zero rows — which reads as "no results for that query"
 * rather than as an outage. Every alarm stays quiet, and the API tells paying
 * customers that entities do not exist.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

/**
 * Node built-ins, external because `nodejs_compat` supplies them at runtime.
 *
 * `pg` reaches for `net`, `tls` and `events` to talk to Hyperdrive over Workers
 * TCP sockets; that is exactly why `wrangler.toml` sets the flag. Bundling
 * them would be a different build from the one that deploys, and this test is
 * only worth having if it builds the same thing.
 */
const NODE_BUILTINS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'constants', 'crypto', 'dns', 'events',
  'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8',
  'vm', 'worker_threads', 'zlib',
];

let bundle: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'df-edge-bundle-'));
  const outfile = join(outDir, 'worker.js');
  await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    // `neutral` rather than `node`: a Worker is not Node, and building for Node
    // would let a Node-only module resolve here and fail on deploy instead.
    platform: 'neutral',
    external: [...NODE_BUILTINS, 'node:*', 'cloudflare:*'],
    loader: { '.json': 'json', '.wasm': 'binary' },
    outfile,
  });
  bundle = readFileSync(outfile, 'utf8');
}, 120_000);

afterAll(() => {
  if (outDir !== undefined) rmSync(outDir, { recursive: true, force: true });
});

/**
 * Comments stripped, for the same reason `env.test.ts` strips them.
 *
 * esbuild preserves some source comments, and this repository's comments
 * discuss PGlite at length precisely in order to explain why it is kept out.
 * A scan that could not tell prose from code would force those explanations out
 * of the files to stay green — which would cost the reader the reasoning and
 * buy no safety at all.
 */
const code = (): string => bundle.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

describe('the deployed bundle cannot reach PGlite', () => {
  it('builds at all', () => {
    // If this fails the rest prove nothing, so it is asserted separately rather
    // than left implicit in a passing grep over an empty string.
    expect(bundle.length).toBeGreaterThan(10_000);
  });

  it('carries no PGlite package', () => {
    expect(code()).not.toMatch(/electric-sql/i);
  });

  it('carries neither factory that can produce one', () => {
    // `createDriverFromEnv` is the more dangerous of the two: it does not name
    // PGlite, it falls back to it when no connection string is set.
    expect(code()).not.toMatch(/createPgliteDriver/);
    expect(code()).not.toMatch(/createDriverFromEnv/);
  });

  it('carries no WebAssembly payload', () => {
    // PGlite is a WASM build of Postgres. Even reduced to a data URI or a
    // base64 blob it would leave one of these behind.
    expect(code()).not.toMatch(/WebAssembly\.(instantiate|compile)/);
    expect(code()).not.toMatch(/\.wasm\b/);
  });

  /**
   * The driver that SHOULD be there.
   *
   * Without this, every assertion above passes just as well against a bundle
   * that failed to include the database layer at all — which is the vacuous
   * version of this whole file, and the version worth guarding against.
   */
  it('does carry the Postgres driver it is supposed to use', () => {
    expect(code()).toMatch(/Hyperdrive|POSTGRES_URL/);
    expect(bundle.length).toBeGreaterThan(100_000);
  });
});
