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
import ts from 'typescript';
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
 * Syntax only — no program, no type checker. These scans ask what the source
 * *says*, and the whole build graph is not needed to answer that.
 */
const parse = (code: string, fileName = 'scan.ts'): ts.SourceFile =>
  ts.createSourceFile(fileName, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

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
   * Parsed, not pattern-matched.
   *
   * Every regex version of this rule has been wrong, and each time in the
   * direction that lets something through. Two ordinary TypeScript shapes
   * defeated the last one:
   *
   *     peek = async (url: string) => this.#fetch(url, {});
   *
   * is a class *field*, so a method-shaped pattern never saw it and billed its
   * call site to whichever method happened to sit above it. And a member can
   * take a reference to the transport without ever calling it there.
   *
   * The compiler already knows what a class member is. Asking it is not
   * gold-plating — it is the difference between a control and something that
   * reads like one.
   */
  const INJECTED = '#fetch';
  const SINK = 'transport';

  interface Member {
    readonly name: string;
    /**
     * Whether anything outside the class can reach it. Only `#private` cannot:
     * TypeScript's `private` and `protected` are erased and enforce nothing.
     */
    readonly external: boolean;
    readonly touches: ReadonlySet<string>;
  }

  /**
   * Assigning to `this.#fetch` is how the transport gets *in* — the constructor
   * writing an injected dependency. That is not reaching it, and counting it as
   * such would flag every provider's constructor. Only a plain `=` is treated
   * as a write; a compound assignment reads the old value too.
   */
  function isAssignmentTarget(node: ts.PropertyAccessExpression): boolean {
    const parent = node.parent;
    return (
      ts.isBinaryExpression(parent) &&
      parent.left === node &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    );
  }

  /**
   * Every `this.x` and `this.#x` a subtree reads — called or merely referenced,
   * because taking a reference and invoking it elsewhere reaches exactly as far.
   */
  function thisAccesses(node: ts.Node): Set<string> {
    const names = new Set<string>();
    const visit = (child: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(child) &&
        child.expression.kind === ts.SyntaxKind.ThisKeyword &&
        !isAssignmentTarget(child)
      ) {
        names.add(child.name.text);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return names;
  }

  function classesIn(file: ts.SourceFile): ts.ClassLikeDeclaration[] {
    const found: ts.ClassLikeDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return found;
  }

  function membersOf(cls: ts.ClassLikeDeclaration): Member[] {
    return cls.members.flatMap((member) => {
      const touches = thisAccesses(member);
      // A constructor runs on `new`, which makes it as reachable as a public
      // method even though it has no name of its own.
      if (ts.isConstructorDeclaration(member)) {
        return [{ name: 'constructor', external: true, touches }];
      }
      const name = member.name;
      if (name === undefined) return [];
      return [
        {
          name: ts.isPrivateIdentifier(name) ? name.text : name.getText(),
          external: !ts.isPrivateIdentifier(name),
          touches,
        },
      ];
    });
  }

  /**
   * Members reachable from outside the class that can reach the transport
   * without going through `transport`.
   *
   * Reachability stops at `transport` rather than propagating to its callers:
   * being called from `transport` is the entire point, and its own caller is
   * the base class's gated `fetch`, which the type system already guards by
   * demanding an `AllowedAcquisition`.
   */
  function ungatedTransportPaths(code: string): string[] {
    const offenders = new Set<string>();
    for (const cls of classesIn(parse(code))) {
      const members = membersOf(cls);
      const reaching = new Set(
        members.filter((member) => member.touches.has(INJECTED)).map((member) => member.name),
      );
      for (let changed = true; changed; ) {
        changed = false;
        for (const member of members) {
          if (reaching.has(member.name)) continue;
          if ([...member.touches].some((name) => name !== SINK && reaching.has(name))) {
            reaching.add(member.name);
            changed = true;
          }
        }
      }
      for (const member of members) {
        if (reaching.has(member.name) && member.external && member.name !== SINK) {
          offenders.add(member.name);
        }
      }
    }
    return [...offenders].sort();
  }

  /**
   * References to the transport that belong to no class member. The closure
   * only walks members, so one of these would be invisible to it — a way for
   * the scan to pass while proving nothing about that call.
   */
  function unownedTransportRefs(code: string): number {
    let unowned = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.name.text === INJECTED
      ) {
        let scope: ts.Node | undefined = node.parent;
        while (scope !== undefined && !ts.isClassElement(scope)) scope = scope.parent;
        if (scope === undefined) unowned += 1;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(parse(code), visit);
    return unowned;
  }

  /** Members that reach the transport at all, gated or not. */
  function transportReachers(code: string): string[] {
    const names = new Set<string>();
    for (const cls of classesIn(parse(code))) {
      const members = membersOf(cls);
      const reaching = new Set(
        members.filter((member) => member.touches.has(INJECTED)).map((member) => member.name),
      );
      for (let changed = true; changed; ) {
        changed = false;
        for (const member of members) {
          if (reaching.has(member.name)) continue;
          if ([...member.touches].some((name) => name !== SINK && reaching.has(name))) {
            reaching.add(member.name);
            changed = true;
          }
        }
      }
      for (const name of reaching) names.add(name);
    }
    return [...names].sort();
  }

  it('confines every path to the transport behind `transport`', () => {
    // `#private` is the only boundary that survives compilation, but it bounds
    // who may call a member from *outside* the class — not which of the class's
    // own members may. So the rule is reachability, not enclosure: nothing
    // callable from outside may reach `#fetch` except through `transport`.
    for (const entry of TRANSPORT_ALLOWLIST) {
      const code = readFileSync(join(SRC, entry), 'utf8');
      expect(
        transportReachers(code).length,
        `${entry} has no member reaching the transport, so this scan proved nothing`,
      ).toBeGreaterThan(0);
      expect(
        unownedTransportRefs(code),
        `${entry}: a transport reference sits outside every class member, where ` +
          `the reachability closure cannot see it`,
      ).toBe(0);
      expect(
        ungatedTransportPaths(code),
        `${entry}: these members reach the transport without passing the gate`,
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

    expect(transportReachers(smuggled)).toEqual(['peek', 'transport']);
    expect(ungatedTransportPaths(smuggled), 'the rule must reject a public method').toEqual([
      'peek',
    ]);
  });

  it('rejects a public method that reaches #fetch through a #private helper', () => {
    // `peek` never mentions `#fetch`. Asking which member encloses each call
    // site finds only `#call`, which is private, and accepts the file —
    // verified RED against exactly this fixture. An ECMAScript private method
    // is callable from any method of the same class, so `#call` being private
    // says nothing about `peek`.
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

    expect(transportReachers(smuggled)).toEqual(['#call', 'peek', 'transport']);
    expect(
      ungatedTransportPaths(smuggled),
      'a public method on a private path must still be rejected',
    ).toEqual(['peek']);
  });

  it('rejects a public class field, which is not a method declaration at all', () => {
    // The shape that defeated the pattern-matching version and the reason this
    // scan parses. `peek` is a PropertyDeclaration holding an arrow function:
    // externally callable, reaching the transport directly, and invisible to
    // anything looking for a method signature. Verified RED by writing exactly
    // this into the real `providers/http.ts`, which the old scan accepted.
    const smuggled = [
      'class Sneaky extends BaseAcquisitionProvider {',
      '  protected async transport(c: TransportContext) {',
      '    return this.#fetch(c.request.url, {});',
      '  }',
      '',
      '  peek = async (url: string): Promise<unknown> => this.#fetch(url, {});',
      '}',
    ].join('\n');

    expect(ungatedTransportPaths(smuggled), 'a field is a member too').toEqual(['peek']);
  });

  it('rejects taking a reference to the transport without calling it there', () => {
    // Reaching is not calling. Handing the function out is enough.
    const smuggled = [
      'class Sneaky extends BaseAcquisitionProvider {',
      '  protected async transport(c: TransportContext) {',
      '    return this.#fetch(c.request.url, {});',
      '  }',
      '',
      '  escape() {',
      '    return this.#fetch;',
      '  }',
      '}',
    ].join('\n');

    expect(ungatedTransportPaths(smuggled), 'handing out the transport is reaching it').toEqual([
      'escape',
    ]);
  });

  it('does not mistake injecting the transport for reaching it', () => {
    // Every provider's constructor assigns `this.#fetch = ...`. That is the
    // dependency arriving, not the constructor calling out — and this is the
    // reason the rule reads assignment targets differently rather than simply
    // exempting constructors, which would hide a real one.
    const injected = [
      'class Fine extends BaseAcquisitionProvider {',
      '  readonly #fetch: FetchLike;',
      '',
      '  constructor(options: Options) {',
      '    super(options.deps);',
      '    this.#fetch = requireFetch("fine", options.fetch);',
      '  }',
      '',
      '  protected async transport(c: TransportContext) {',
      '    return this.#fetch(c.request.url, {});',
      '  }',
      '}',
    ].join('\n');

    expect(transportReachers(injected), 'the constructor writes it, transport reads it').toEqual([
      'transport',
    ]);
    expect(ungatedTransportPaths(injected)).toEqual([]);
  });

  it('still rejects a constructor that actually calls the transport', () => {
    // The other half of the distinction: reading it in a constructor is a real
    // ungated path, because construction happens without the gate.
    const smuggled = [
      'class Sneaky extends BaseAcquisitionProvider {',
      '  constructor(options: Options) {',
      '    super(options.deps);',
      '    this.#fetch = options.fetch;',
      '    void this.#fetch("https://example.test/", {});',
      '  }',
      '',
      '  protected async transport(c: TransportContext) {',
      '    return this.#fetch(c.request.url, {});',
      '  }',
      '}',
    ].join('\n');

    expect(ungatedTransportPaths(smuggled)).toEqual(['constructor']);
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

    expect(transportReachers(legitimate)).toEqual(['#call', 'transport']);
    expect(ungatedTransportPaths(legitimate), 'over-tightening would reject correct code').toEqual(
      [],
    );
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
  const PROOF = 'AllowedAcquisition';
  const MINTING_SITE = 'policy/rights-gate.ts';

  /**
   * The names that denote the proof type *in this file*. A literal search for
   * `AllowedAcquisition` misses every one of these:
   *
   *     import type { AllowedAcquisition as Proof } from '...';  // → `Proof`
   *     import * as Gate from '...';               // → `Gate.AllowedAcquisition`
   *
   * Both forge the token, and neither spells its name where the forgery
   * happens. A namespace is admitted without resolving what it points at, so
   * any `Ns.AllowedAcquisition` assertion is flagged — the conservative
   * direction, since the alternative is a scan that can be renamed around.
   */
  function proofNames(file: ts.SourceFile): {
    readonly locals: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
  } {
    const locals = new Set<string>();
    const namespaces = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
        node.name.text === PROOF
      ) {
        locals.add(PROOF);
      }
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if ((element.propertyName ?? element.name).text === PROOF) {
              locals.add(element.name.text);
            }
          }
        }
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          namespaces.add(bindings.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return { locals, namespaces };
  }

  /** Every assertion *to* the proof type, by either syntax, under any name. */
  function proofAssertions(code: string): ts.Node[] {
    const file = parse(code);
    const { locals, namespaces } = proofNames(file);
    const denotesProof = (type: ts.TypeNode): boolean => {
      if (!ts.isTypeReferenceNode(type)) return false;
      const name = type.typeName;
      if (ts.isIdentifier(name)) return locals.has(name.text);
      return (
        ts.isQualifiedName(name) &&
        ts.isIdentifier(name.left) &&
        namespaces.has(name.left.text) &&
        name.right.text === PROOF
      );
    };
    const hits: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        denotesProof(node.type)
      ) {
        hits.push(node);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return hits;
  }

  function enclosingFunction(node: ts.Node | undefined): ts.FunctionDeclaration | undefined {
    let scope = node?.parent;
    while (scope !== undefined && !ts.isFunctionDeclaration(scope)) scope = scope.parent;
    return scope;
  }

  it('permits the assertion only where the gate mints the proof', () => {
    const offenders = sourceFiles()
      .filter((file) => rel(file) !== MINTING_SITE)
      .filter((file) => proofAssertions(readFileSync(file, 'utf8')).length > 0)
      .map(rel);
    expect(
      offenders,
      'these files assert the gate’s proof without having run the gate',
    ).toEqual([]);
  });

  it('mints it exactly once, inside requireAcquisitionAllowed', () => {
    const assertions = proofAssertions(readFileSync(join(SRC, MINTING_SITE), 'utf8'));
    expect(assertions.length, 'more than one mint means more than one way in').toBe(1);
    const minting = enclosingFunction(assertions[0]);
    expect(minting?.name?.text, 'the mint must sit inside the gate’s own function').toBe(
      'requireAcquisitionAllowed',
    );
  });

  it('detects every assertion syntax, under every name', () => {
    const imported = "import type { AllowedAcquisition } from './rights-gate.js';\n";
    expect(proofAssertions(`${imported}const a = r as AllowedAcquisition;`).length).toBe(1);
    expect(proofAssertions(`${imported}const a = r as unknown as AllowedAcquisition;`).length).toBe(
      1,
    );
    expect(proofAssertions(`${imported}const a = <AllowedAcquisition>r;`).length).toBe(1);

    // The two forms that defeated the literal-name scan, both verified RED
    // against the real `providers/http.ts` before this rewrite.
    expect(
      proofAssertions(
        "import type { AllowedAcquisition as Proof } from './rights-gate.js';\nconst a = r as Proof;",
      ).length,
      'an aliased import renames the token and forges it just the same',
    ).toBe(1);
    expect(
      proofAssertions(
        "import * as Gate from './rights-gate.js';\nconst a = r as Gate.AllowedAcquisition;",
      ).length,
      'a namespace import qualifies the name rather than changing it',
    ).toBe(1);
  });

  it('leaves ordinary uses of the type alone', () => {
    // A scan that flagged these would be correct once and switched off after.
    const imported = "import type { AllowedAcquisition } from './rights-gate.js';\n";
    expect(proofAssertions(`${imported}declare function f(): Promise<AllowedAcquisition>;`).length)
      .toBe(0);
    expect(proofAssertions(`${imported}interface C { readonly allowed: AllowedAcquisition }`).length)
      .toBe(0);
    expect(proofAssertions(`${imported}const g: AcquisitionGateResult = r;`).length).toBe(0);
    // An unrelated local type that merely shares an alias name is not the token.
    expect(
      proofAssertions('type Proof = string;\nconst a = r as Proof;').length,
      'only names actually bound to the imported token count',
    ).toBe(0);
  });
});
