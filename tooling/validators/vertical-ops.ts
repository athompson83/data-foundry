/**
 * Declared-op validation: does a vertical name operations the platform
 * actually implements?
 *
 * A vertical configures behaviour by naming ops in YAML; the platform
 * implements a fixed vocabulary of them. Nothing used to check that the two
 * agreed. The failure surfaced instead at run time, deep in ingestion, as
 * `PipelineConfigurationError: identifier op "..." is declared by the vertical
 * but not implemented by the ingest worker` — correct fail-closed behaviour,
 * but the *first* thing to notice, long after acquisition has already cost time
 * and money. This module moves that check to `pnpm verticals:validate`, where a
 * typo costs a red CI run instead of a crawl.
 *
 * Two rules govern everything below.
 *
 * **The vocabularies are imported, never copied.** `IDENTIFIER_OPS` and
 * `TRANSFORM_KINDS` come from the modules that dispatch them, each derived from
 * its own dispatch table rather than written out beside it. A hand-copied list
 * here would drift the first time someone added an op — the same class of bug
 * this gate exists to catch, one layer up.
 *
 * **The namespaces stay apart.** Identifier ops (doc 06 layer 3, alias join
 * keys) and value transforms (layers 1/2/4, property values) are different
 * vocabularies for different pipeline stages. Pooling them would accept `round`
 * as an identifier op and `left_pad` as a value transform — a typo that lands
 * in the wrong stage and is not caught until the same runtime this gate is
 * meant to protect.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { IDENTIFIER_OPS } from '../../services/ingest-worker/src/identifiers.js';
import { TRANSFORM_KINDS } from '../../packages/normalization/src/rules.js';
import type { ValidationProblem } from './validate-verticals.js';

/** YAML arrives untyped; every reader below narrows what it needs. */
type Yaml = any;

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

export interface OpNamespace {
  /** Stable id, used to tell one namespace from another in messages and tests. */
  readonly id: 'identifier' | 'value';
  /** How a message names one member, e.g. `identifier op`. */
  readonly noun: string;
  /** The implemented vocabulary, imported from the module that dispatches it. */
  readonly ops: readonly string[];
  /** Repo-relative path of that dispatch, so an operator knows where to look. */
  readonly implementedIn: string;
}

/** Doc 06 layer 3 — the ops that build `entity_aliases.normalized_value`. */
export const IDENTIFIER_OP_NAMESPACE: OpNamespace = {
  id: 'identifier',
  noun: 'identifier op',
  ops: IDENTIFIER_OPS,
  implementedIn: 'services/ingest-worker/src/identifiers.ts',
};

/** Doc 06 layers 1/2/4 — the transforms that turn a source value into a fact. */
export const VALUE_OP_NAMESPACE: OpNamespace = {
  id: 'value',
  noun: 'value transform kind',
  ops: TRANSFORM_KINDS,
  implementedIn: 'packages/normalization/src/pipeline.ts',
};

export const OP_NAMESPACES: readonly OpNamespace[] = [
  IDENTIFIER_OP_NAMESPACE,
  VALUE_OP_NAMESPACE,
];

// ---------------------------------------------------------------------------
// Declaration sites
// ---------------------------------------------------------------------------

/** One op named by a vertical, with the YAML path that located it. */
export interface DeclaredOp {
  /** Path within the file, e.g. `identifier_rules[0].ops[1].op`. */
  readonly path: string;
  /** The declared name, or `null` when the entry names no op at all. */
  readonly op: string | null;
}

export interface OpDeclarationSite {
  /** Path segments of the file, relative to the vertical directory. */
  readonly file: readonly string[];
  readonly namespace: OpNamespace;
  readonly collect: (doc: Yaml) => readonly DeclaredOp[];
}

/** `identifier_rules[].ops[].op` — read by `AliasNormalizer` in the ingest worker. */
export function collectIdentifierOps(doc: Yaml): DeclaredOp[] {
  const declared: DeclaredOp[] = [];
  const rules: Yaml[] = Array.isArray(doc?.identifier_rules) ? doc.identifier_rules : [];
  rules.forEach((rule: Yaml, ruleIndex: number) => {
    const ops: Yaml[] = Array.isArray(rule?.ops) ? rule.ops : [];
    ops.forEach((op: Yaml, opIndex: number) => {
      const path = `identifier_rules[${ruleIndex}].ops[${opIndex}].op`;
      const name = op === null || op === undefined ? undefined : op.op;
      declared.push({
        path,
        op: name === undefined || name === null ? null : String(name),
      });
    });
  });
  return declared;
}

/**
 * The op declarations the platform actually **dispatches**.
 *
 * Deliberately short, and the omissions are findings rather than oversights.
 * Both were verified by loading the real HVAC vertical and watching what the
 * code does with it:
 *
 *   * `normalizers/01-primitive-cleanup.yaml` is **not read by anything**.
 *     `loadVerticalConfig` never opens it, so no `VerticalConfig` field holds
 *     it. The behaviour it describes is hard-coded instead — `primitiveCleanup`
 *     in `packages/normalization/src/pipeline.ts` and `NULL_TOKENS` in
 *     `.../text.ts`. Its `op:` names therefore belong to no vocabulary that any
 *     code assigns meaning to, and checking them against one would be inventing
 *     a contract rather than enforcing one.
 *   * `normalizers/02-typed-values.yaml` **is** loaded, but its
 *     `derived_properties[].op` and `.operand` keys are never read:
 *     `compile.ts` builds a `quantity` (+ optional `round`) transform chain from
 *     the target property's declared unit, so the arithmetic comes from the unit
 *     registry, not from the op. Replacing `op: divide` with a nonsense value
 *     produces byte-identical compiled output.
 *
 * Neither is a runtime hazard today, and neither is checked here. Both are
 * reported to the humans who own the config, because deleting configuration a
 * vertical author wrote is a product decision. If either is ever wired up, add
 * it to this table and its ops become enforceable in the same breath.
 */
export const OP_DECLARATION_SITES: readonly OpDeclarationSite[] = [
  {
    file: ['normalizers', '03-domain-normalization.yaml'],
    namespace: IDENTIFIER_OP_NAMESPACE,
    collect: collectIdentifierOps,
  },
];

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance. Small, pure and dependency-free — an operator fixing a
 * typo should not have to read source to find the name they meant.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i, ...Array.from<number>({ length: b.length }).fill(0)];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The closest implemented names, nearest first.
 *
 * Two filters, because either alone misbehaves. The absolute threshold scales
 * with the name's length so that `strip_contorl_characters` still reaches
 * `strip_characters` (a whole misspelled word away, distance 8) without a short
 * name matching half the vocabulary. The relative one then keeps only names
 * about as close as the best candidate, so a confident suggestion is not
 * diluted by the runners-up — `uppercse` should offer `uppercase`, not
 * `uppercase` or `lowercase`.
 *
 * Ordering is by distance then by code-unit comparison — never `localeCompare`,
 * which would make the message depend on the machine that produced it.
 */
export function nearestOps(
  op: string,
  vocabulary: readonly string[],
  limit = 3,
): readonly string[] {
  const threshold = Math.max(2, Math.floor(op.length / 3));
  const scored = vocabulary
    .map((candidate) => ({ candidate, distance: editDistance(op, candidate) }))
    .filter((entry) => entry.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1));

  const best = scored[0];
  if (best === undefined) return [];
  return scored
    .filter((entry) => entry.distance <= best.distance + 1)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export interface OpCheckContext {
  readonly vertical: string;
  /** Path reported on the problem, normally the YAML file. */
  readonly file: string;
}

const quote = (value: string): string => `"${value}"`;

/**
 * Explains one unimplemented op, closing on the full vocabulary so a fix never
 * requires opening the platform's source.
 */
function explainUnknownOp(op: string, namespace: OpNamespace, path: string, vertical: string): string {
  const parts: string[] = [
    `${path}: vertical ${quote(vertical)} declares ${namespace.noun} ${quote(op)}, which the platform does not implement (dispatch: ${namespace.implementedIn})`,
  ];

  // A name that is real, but belongs to the other pipeline stage, is the most
  // useful thing this check can say — and the reason the namespaces are not
  // pooled.
  const otherNamespace = OP_NAMESPACES.find(
    (candidate) => candidate.id !== namespace.id && candidate.ops.includes(op),
  );
  if (otherNamespace !== undefined) {
    parts.push(
      `${quote(op)} is a ${otherNamespace.noun} (${otherNamespace.implementedIn}), which runs at a different pipeline stage and is not valid here`,
    );
  }

  const suggestions = nearestOps(op, namespace.ops);
  if (suggestions.length > 0) {
    parts.push(`did you mean ${suggestions.map(quote).join(' or ')}?`);
  }

  parts.push(`implemented ${namespace.noun}s: ${[...namespace.ops].sort().join(', ')}`);
  return parts.join('; ');
}

/** Checks a set of declared ops against one namespace. Pure; no I/O. */
export function checkDeclaredOps(
  declared: readonly DeclaredOp[],
  namespace: OpNamespace,
  context: OpCheckContext,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  for (const entry of declared) {
    if (entry.op === null) {
      problems.push({
        file: context.file,
        message: `${entry.path}: vertical ${quote(context.vertical)} declares a step with no op name; every step must name one of the implemented ${namespace.noun}s: ${[...namespace.ops].sort().join(', ')}`,
      });
      continue;
    }
    if (namespace.ops.includes(entry.op)) continue;
    problems.push({
      file: context.file,
      message: explainUnknownOp(entry.op, namespace, entry.path, context.vertical),
    });
  }
  return problems;
}

/**
 * Checks every op a vertical declares at a site the platform dispatches.
 *
 * A site whose file is absent contributes nothing: no file, no declared ops,
 * nothing to reject. Whether the file is *required* is a separate contract that
 * this check deliberately does not invent.
 */
export async function validateDeclaredOps(
  dir: string,
  vertical: string,
): Promise<ValidationProblem[]> {
  const problems: ValidationProblem[] = [];

  for (const site of OP_DECLARATION_SITES) {
    const path = join(dir, ...site.file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }

    let doc: Yaml;
    try {
      doc = parseYaml(raw);
    } catch (error) {
      problems.push({
        file: path,
        message: `unparseable: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    problems.push(
      ...checkDeclaredOps(site.collect(doc), site.namespace, { vertical, file: path }),
    );
  }

  return problems;
}
