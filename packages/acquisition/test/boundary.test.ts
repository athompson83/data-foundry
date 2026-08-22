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

  /**
   * The method enclosing a position, by walking declarations rather than
   * offsets. Source order is not containment: a `#fetch(` that merely appears
   * *after* `transport` may sit in a wholly different method, including a
   * public one.
   */
  const METHOD_DECL =
    /^\s{2}(?:(?:public|private|protected|static|override|async|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*[(<]/gm;

  /**
   * Every method declaration with the span it owns — its own declaration to the
   * start of the next. The same approximation `enclosingMethodOf` used, kept
   * because these files are flat classes; a class nested inside a method would
   * defeat it, and none exists here.
   */
  function declaredMethods(code: string): readonly { name: string; start: number; body: string }[] {
    const starts = [...code.matchAll(METHOD_DECL)].flatMap((match) =>
      match.index === undefined || match[1] === undefined
        ? []
        : [{ name: match[1], start: match.index }],
    );
    return starts.map((decl, i) => ({
      name: decl.name,
      start: decl.start,
      body: code.slice(decl.start, starts[i + 1]?.start ?? code.length),
    }));
  }

  /**
   * Call sites no method owns. The spans run from the first declaration to the
   * end of the file, so this is exactly the sites above it — invisible to the
   * closure, and therefore a way for the scan to pass while proving nothing.
   */
  function unownedFetchSites(code: string): number {
    const firstMethod = declaredMethods(code)[0]?.start ?? code.length;
    return [...code.matchAll(/#fetch\s*\(/g)].filter(
      (site) => (site.index ?? 0) < firstMethod,
    ).length;
  }

  /**
   * Every method that can reach `#fetch` *without* passing through `transport`.
   *
   * This is the property the rule needs, and `#private` alone does not give it.
   * An ECMAScript private method is callable from any method of the same class,
   * a public one included — so a public method can reach the transport through
   * a private helper while never mentioning `#fetch` itself. Asking only "which
   * method encloses this call site" cannot see that path.
   *
   * `transport` is the accepted sink, so reachability stops there rather than
   * propagating to its callers: being called from `transport` is the whole
   * point, and its own caller is the base class's gated `fetch`.
   */
  function methodsReachingFetch(code: string): ReadonlySet<string> {
    const methods = declaredMethods(code);
    const reaching = new Set(
      methods.filter((method) => /#fetch\s*\(/.test(method.body)).map((method) => method.name),
    );
    for (let changed = true; changed; ) {
      changed = false;
      for (const method of methods) {
        if (reaching.has(method.name)) continue;
        const calls = [...method.body.matchAll(/this\.(#?[A-Za-z_$][\w$]*)\s*\(/g)].map(
          (call) => call[1],
        );
        if (calls.some((callee) => callee !== undefined && callee !== 'transport' && reaching.has(callee))) {
          reaching.add(method.name);
          changed = true;
        }
      }
    }
    return reaching;
  }

  /** The methods on a reaching-set that anything outside the class could call. */
  function ungatedIn(reaching: ReadonlySet<string>): string[] {
    return [...reaching].filter((name) => name !== 'transport' && !name.startsWith('#')).sort();
  }

  it('confines every path to the transport behind `transport`', () => {
    // `#private` is the only boundary that survives compilation — TypeScript
    // erases `protected` — but it bounds who may call a method from *outside*
    // the class, not which of the class's own methods may. So the rule is
    // reachability, not enclosure: nothing callable from outside may reach
    // `#fetch` except through `transport`.
    for (const entry of TRANSPORT_ALLOWLIST) {
      const code = stripComments(readFileSync(join(SRC, entry), 'utf8'));
      expect(
        [...code.matchAll(/#fetch\s*\(/g)].length,
        `${entry} has no transport invocation`,
      ).toBeGreaterThan(0);
      expect(
        unownedFetchSites(code),
        `${entry}: a transport invocation sits outside every method, where the ` +
          `reachability closure cannot see it`,
      ).toBe(0);
      const reaching = methodsReachingFetch(code);
      expect(
        reaching.size,
        `${entry}: no method reaches #fetch, so this scan proved nothing`,
      ).toBeGreaterThan(0);
      expect(
        ungatedIn(reaching),
        `${entry}: these methods reach the transport without passing the gate`,
      ).toEqual([]);
    }
  });

  it('rejects an ungated invocation placed after transport', () => {
    // The negative fixture the positional check would have waved through: a
    // PUBLIC method, declared after `transport`, calling the same transport.
    const smuggled = [
      'class Sneaky extends BaseAcquisitionProvider {',
      '  protected async transport(context: TransportContext) {',
      '    return this.#fetch(context.request.url, {});',
      '  }',
      '',
      '  async peek(url: string) {',
      '    return this.#fetch(url, {});',
      '  }',
      '}',
    ].join('\n');

    // Positional order would accept both, because `peek` comes after
    // `transport`. Reachability rejects the second, which is the point.
    expect([...methodsReachingFetch(smuggled)].sort()).toEqual(['peek', 'transport']);
    expect(
      ungatedIn(methodsReachingFetch(smuggled)),
      'the rule must reject a public method',
    ).toEqual(['peek']);
  });

  it('rejects a public method that reaches #fetch through a #private helper', () => {
    // The hole that `#private`-alone leaves open, and the reason enclosure is
    // not enough: `peek` never mentions `#fetch`. Asking which method encloses
    // each call site finds only `#call`, which is private, and accepts the
    // file — verified RED against exactly this fixture before the closure
    // existed. An ECMAScript private method is callable from any method of the
    // same class, so `#call` being private says nothing about `peek`.
    const smuggled = [
      'class Sneaky extends BaseAcquisitionProvider {',
      '  protected async transport(c: TransportContext) {',
      '    return this.#call(c.request.url);',
      '  }',
      '',
      '  async peek(url: string) {',
      '    return this.#call(url);',
      '  }',
      '',
      '  async #call(url: string) {',
      '    return this.#fetch(url, {});',
      '  }',
      '}',
    ].join('\n');

    // Only one call site, and it is inside a private method — which is exactly
    // why the enclosing-method rule waved this through.
    expect([...smuggled.matchAll(/#fetch\s*\(/g)].length).toBe(1);
    expect([...methodsReachingFetch(smuggled)].sort()).toEqual(['#call', 'peek', 'transport']);
    expect(
      ungatedIn(methodsReachingFetch(smuggled)),
      'a public method on a private path must still be rejected',
    ).toEqual(['peek']);
  });

  it('permits the same call from a #private helper', () => {
    // The counterpart: browser-run legitimately calls #fetch from #call, which
    // is unreachable from outside the class. Over-tightening to "transport
    // only" would reject correct code and get the rule switched off.
    const legitimate = [
      'class Fine extends BaseAcquisitionProvider {',
      '  protected async transport(c: TransportContext) {',
      '    return this.#call(c.request.url);',
      '  }',
      '',
      '  async #call(url: string) {',
      '    return this.#fetch(url, {});',
      '  }',
      '}',
    ].join('\n');
    const reaching = methodsReachingFetch(legitimate);
    expect([...reaching].sort()).toEqual(['#call', 'transport']);
    expect(ungatedIn(reaching), 'over-tightening would reject correct code').toEqual([]);
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

/**
 * The gap a type system cannot close, closed by a scan instead.
 *
 * `AllowedAcquisition` cannot be *constructed* outside `rights-gate.ts` — the
 * brand symbol is never exported. It can be *asserted*: `result as
 * AllowedAcquisition` type-checks anywhere the type is imported. No type system
 * prevents a type assertion, so the honest control is a rule about where that
 * assertion may appear, enforced here.
 */
describe('the gate’s proof is minted in exactly one place', () => {
  // Both assertion syntaxes TypeScript accepts in a `.ts` file. The negative
  // lookbehind keeps `Promise<AllowedAcquisition>` and friends out: in a
  // generic argument the `<` follows an identifier, in an assertion it does not.
  const ASSERTION =
    /\bas\s+(?:unknown\s+as\s+)?AllowedAcquisition\b|(?<![\w$])<\s*AllowedAcquisition\s*>/;
  const MINTING_SITE = 'policy/rights-gate.ts';

  it('permits the assertion only where the gate mints the proof', () => {
    const offenders = sourceFiles()
      .filter((file) => rel(file) !== MINTING_SITE)
      .filter((file) => ASSERTION.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel);
    expect(
      offenders,
      'these files assert the gate’s proof without having run the gate',
    ).toEqual([]);
  });

  it('mints it exactly once, inside requireAcquisitionAllowed', () => {
    const code = stripComments(readFileSync(join(SRC, MINTING_SITE), 'utf8'));
    const assertions = [...code.matchAll(new RegExp(ASSERTION.source, 'g'))];
    expect(assertions.length, 'more than one mint means more than one way in').toBe(1);
    const fn = code.indexOf('export function requireAcquisitionAllowed');
    expect(fn, 'the minting function must exist').toBeGreaterThan(-1);
    expect(assertions[0]?.index ?? -1).toBeGreaterThan(fn);
  });

  it('detects the assertion it claims to detect', () => {
    expect(ASSERTION.test('return result as AllowedAcquisition;')).toBe(true);
    expect(ASSERTION.test('return x as unknown as AllowedAcquisition;')).toBe(true);
    expect(ASSERTION.test('return <AllowedAcquisition>result;')).toBe(true);
    expect(ASSERTION.test('const g: AcquisitionGateResult = r;')).toBe(false);
    // Generic arguments are uses of the type, not forgeries of it. Flagging
    // these would make the rule unusable and get it deleted.
    expect(ASSERTION.test('async function f(): Promise<AllowedAcquisition> {')).toBe(false);
    expect(ASSERTION.test('readonly allowed: AllowedAcquisition;')).toBe(false);
  });
});
