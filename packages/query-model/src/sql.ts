/**
 * Small helpers for building portable, parameterised SQL by hand.
 *
 * There is no query builder here on purpose: the canonical layer writes plain
 * Postgres that must run unchanged on PGlite and on hosted Postgres, and an
 * abstraction that hides the SQL would hide exactly the thing that has to stay
 * portable. `Params` exists only so that dynamic predicates cannot drift out of
 * step with their placeholder numbering — the one bookkeeping error hand-built
 * SQL actually makes.
 */
import type { SqlParam } from '@data-foundry/canonical-store';

export class Params {
  private readonly bound: SqlParam[] = [];
  private readonly jsonArrays = new WeakMap<readonly string[], string>();

  /** Bind a value and get its placeholder. */
  add(value: SqlParam): string {
    this.bound.push(value);
    return `$${this.bound.length}`;
  }

  addAll(values: readonly SqlParam[]): string[] {
    return values.map((value) => this.add(value));
  }

  /** Bind and serialize one immutable string array once within a statement. */
  addJsonArray(values: readonly string[]): string {
    const existing = this.jsonArrays.get(values);
    if (existing !== undefined) return existing;
    const placeholder = this.add(JSON.stringify(values));
    this.jsonArrays.set(values, placeholder);
    return placeholder;
  }

  get values(): SqlParam[] {
    return [...this.bound];
  }

  get length(): number {
    return this.bound.length;
  }
}

/** jsonb scalar → text. Portable across every canonical value type. */
export const VALUE_TEXT = (alias: string): string => `(${alias}.normalized_value #>> '{}')`;

/** The versions that make up "what is true right now". */
export const CURRENT_FACT = (alias: string): string =>
  `${alias}.valid_to IS NULL AND ${alias}.status <> 'RETRACTED'`;

export const NUMERIC_FACT_TYPES = `('number', 'integer', 'quantity')`;

/**
 * Membership in a trusted UUID set carried as one JSON parameter. The SQL and
 * bind count stay constant as the set grows; callers still impose their own
 * deterministic candidate limits before constructing a surface-wide query.
 */
export function uuidJsonSetPredicate(
  column: string,
  values: readonly string[],
  params: Params,
  relationAlias: string,
): string {
  const payload = params.addJsonArray(values);
  return `${column} IN (
    SELECT ${relationAlias}.value::uuid
      FROM jsonb_array_elements_text(${payload}::jsonb) AS ${relationAlias}(value)
  )`;
}

/** Lowercase, alphanumeric-only. `24-ANB/7` → `24anb7`. */
export function collapseIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Uppercase, alphanumeric-only. `24acc6-36a003` → `24ACC636A003`.
 *
 * This is the form the ingest side actually stores: a vertical's alias op chain
 * case-folds and then strips separators, and the HVAC vertical folds to UPPER
 * (`verticals/hvac/normalizers/03-domain-normalization.yaml`). Omitting it made
 * every separator-bearing lowercase spelling of a stored identifier unfindable.
 */
export function collapseIdentifierUpper(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/** Lowercase, hyphen-separated. `Carrier 24ANB7` → `carrier-24anb7`. */
export function slugifyIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Every deterministic spelling of a user's query worth trying as an exact
 * identifier. Deliberately conservative: these are equality probes, so an
 * over-eager normalisation would turn an exact match into a wrong match.
 *
 * The separator-stripped forms are generated in BOTH case conventions. The
 * write path stores whatever the vertical's op chain produces, and a query
 * layer that only ever collapses to lower case simply cannot equal an
 * upper-cased stored value — which is how `24acc6-36a003` and `24ACC6 36A003`
 * (two of the HVAC vertical's own documented spellings of one identifier)
 * both missed while `24ACC636A003` hit. Generating both keeps the probe
 * deterministic and vertical-agnostic without widening the match class:
 * case folding plus separator stripping is the same equivalence relation
 * either way round.
 *
 * This is the single definition of "exact" for the query layer. Both
 * `lookupByIdentifier` and `lookupExactIdentifier` MUST use it — two
 * independent notions of exactness in one package is the bug this replaces.
 */
export function identifierCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  const candidates = new Set<string>([
    trimmed,
    trimmed.toLowerCase(),
    trimmed.toUpperCase(),
    collapseIdentifier(trimmed),
    collapseIdentifierUpper(trimmed),
    slugifyIdentifier(trimmed),
  ]);
  candidates.delete('');
  return [...candidates];
}

/** Escape a value for use inside a LIKE pattern. */
export function likePattern(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
