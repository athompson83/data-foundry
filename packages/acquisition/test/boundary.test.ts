/**
 * The gate is the package's property, not each adapter's diligence.
 *
 * `BaseAcquisitionProvider.fetch` evaluates the rights and politeness gate and
 * then calls a `protected transport` hook. That ordering is what keeps a RED,
 * killed, out-of-scope or prohibited source off the network — and until this
 * file existed, nothing enforced it beyond the fact that every current provider
 * happened to be written correctly.
 *
 * Two things now do. `TransportContext` requires an `AllowedAcquisition`, a
 * branded value only the gate can mint, so transport cannot be called without
 * proof the gate ran — deleting the refusal is a type error, not a silent hole.
 * That covers everything reachable through the base class. What it cannot cover
 * is a NEW file that never uses the base class at all, or a stray `fetch(` in
 * some helper. That is what the scans below are for: they are the part of the
 * invariant the type system genuinely cannot express.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const rel = (path: string): string => relative(SRC, path).replaceAll('\\', '/');

/**
 * Network capability in this package comes in two distinct forms, and lumping
 * them together produced a scan that flagged the gated entry point's own method
 * name — `AcquisitionProvider.fetch` — as if it were an outbound request. The
 * two are policed separately because they are different permissions.
 *
 * 1. **Acquiring the ambient capability**: reaching for `globalThis.fetch`,
 *    `node:http`, a client library, a browser driver. Exactly one file may do
 *    this, and its whole job is to hand back a `FetchLike`.
 * 2. **Invoking it**: calling the injected `#fetch`. Only a provider's
 *    `transport` may, and transport is unreachable without the gate's proof.
 *
 * Deliberately NOT policed: the identifier `fetch` as a method name. That is
 * the gated entry point itself, declared in `provider.ts` and implemented in
 * `providers/base.ts`. Forbidding it would forbid the gate.
 */
const AMBIENT_NETWORK =
  /\bglobalThis\b[^;\n]*\bfetch\b|\bnode:https?\b|\bundici\b|\baxios\b|\bXMLHttpRequest\b|\bnew WebSocket\b|\bnode:child_process\b|\bpuppeteer\b|\bplaywright\b/;
const AMBIENT_ALLOWLIST: readonly string[] = ['providers/http-client.ts'];

/** Invoking the injected transport function. */
const TRANSPORT_INVOKE = /#fetch\s*\(/;
const TRANSPORT_ALLOWLIST: readonly string[] = [
  'providers/browser-run.ts',
  'providers/crawl4ai.ts',
  'providers/http.ts',
];

describe('network capability is confined to the gated transport layer', () => {
  it('lets one file and one file only reach for the ambient network', () => {
    const offenders = sourceFiles()
      .filter((file) => !AMBIENT_ALLOWLIST.includes(rel(file)))
      .filter((file) => AMBIENT_NETWORK.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders, 'these files acquire network capability directly').toEqual([]);
  });

  it('lets only provider transports invoke it', () => {
    const offenders = sourceFiles()
      .filter((file) => !TRANSPORT_ALLOWLIST.includes(rel(file)))
      .filter((file) => TRANSPORT_INVOKE.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders, 'these files invoke a transport outside a gated provider').toEqual([]);
  });

  it('keeps both allowlists honest — every entry still does the thing', () => {
    // An allowlist that outlives its reason is a permission nobody revoked.
    for (const entry of AMBIENT_ALLOWLIST) {
      const code = stripComments(readFileSync(join(SRC, entry), 'utf8'));
      expect(AMBIENT_NETWORK.test(code), `${entry} no longer needs ambient access; drop it`).toBe(
        true,
      );
    }
    for (const entry of TRANSPORT_ALLOWLIST) {
      const code = stripComments(readFileSync(join(SRC, entry), 'utf8'));
      expect(TRANSPORT_INVOKE.test(code), `${entry} no longer invokes transport; drop it`).toBe(
        true,
      );
    }
  });

  it('confines every invocation to a transport method, not merely to the file', () => {
    // File-level allowlisting would permit a second, ungated entry point inside
    // an already-allowlisted provider. Every invocation must sit below the
    // `transport` hook, which cannot be called without the gate's proof.
    for (const entry of TRANSPORT_ALLOWLIST) {
      const code = stripComments(readFileSync(join(SRC, entry), 'utf8'));
      const transportAt = code.search(/protected\s+async\s+transport\s*\(/);
      expect(transportAt, `${entry} has no transport hook`).toBeGreaterThan(-1);
      for (const match of code.matchAll(/#fetch\s*\(/g)) {
        expect(
          match.index,
          `${entry}: a transport invocation at ${match.index} precedes the transport hook`,
        ).toBeGreaterThan(transportAt);
      }
    }
  });

  it('detects the primitives it claims to detect', () => {
    // Guards the regexes: if these stop matching, every scan above passes
    // vacuously and this file becomes decoration.
    for (const sample of [
      'const c = (globalThis as { fetch?: unknown }).fetch;',
      "import https from 'node:https';",
      "import axios from 'axios';",
      'const ws = new WebSocket(url);',
      "import { chromium } from 'playwright';",
    ]) {
      expect(AMBIENT_NETWORK.test(sample), sample).toBe(true);
    }
    expect(TRANSPORT_INVOKE.test('await this.#fetch(url, init)')).toBe(true);
    // And does not fire on the gated entry point's own name.
    expect(AMBIENT_NETWORK.test('fetch(request: SourceRequest): Promise<AcquisitionResult>;')).toBe(
      false,
    );
    expect(TRANSPORT_INVOKE.test('await provider.fetch(request)')).toBe(false);
  });
});

describe('every provider goes through the base class', () => {
  const providerFiles = sourceFiles(join(SRC, 'providers')).filter(
    (file) => !['base.ts', 'http-client.ts'].includes(rel(file).replace('providers/', '')),
  );

  it('finds the providers at all', () => {
    // Without this, an empty glob would make every assertion below vacuous.
    expect(providerFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('has every provider class extend BaseAcquisitionProvider', () => {
    for (const file of providerFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [, name] of code.matchAll(/export class (\w*Provider)\b/g)) {
        expect(
          code,
          `${rel(file)}: ${name} must extend BaseAcquisitionProvider — a provider that does ` +
            `not inherit the gated fetch is a provider with no gate`,
        ).toMatch(new RegExp(`class ${name}\\s+extends\\s+BaseAcquisitionProvider`));
      }
    }
  });

  it('lets no provider override the gated fetch', () => {
    // Overriding `fetch` replaces the gate evaluation wholesale. Implementing
    // `transport` is the supported extension point precisely because it runs
    // after the gate and now requires the gate's proof to be callable.
    for (const file of providerFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${rel(file)} overrides fetch, bypassing the gate`).not.toMatch(
        /^\s*(?:public\s+|override\s+)*async\s+fetch\s*\(/m,
      );
    }
  });

  it('requires the gate’s proof before transport can be called', () => {
    const base = stripComments(readFileSync(join(SRC, 'providers', 'base.ts'), 'utf8'));
    // The structural half of the invariant, asserted where it lives: the
    // context type carries the proof, and the proof is minted by the gate.
    expect(base).toMatch(/readonly allowed:\s*AllowedAcquisition/);
    expect(base).toMatch(/requireAcquisitionAllowed\(/);
  });
});
