import { fail, ok, type Normalized } from './failures.js';
import { comparisonKey } from './text.js';

/**
 * Layer 4 of doc 06: ontology mapping.
 *
 * ```text
 * "Condenser Fan Motor" | "Outdoor Fan Motor" | "OD Fan Motor" → condenser_fan_motor
 * ```
 *
 * A vocabulary is plain vertical config: canonical term → the source variants
 * that mean it. Unmapped terms are a failure, never a passthrough — letting an
 * unknown string become the canonical value is how a facet ends up with
 * `R-410A`, `R410A`, `r-410a` and `Puron` as four different filter options, and
 * how a vertical quietly stops being comparable.
 */
export interface VocabularyDefinition {
  readonly id: string;
  /** Canonical term → source variants. The canonical term always matches itself. */
  readonly terms: Readonly<Record<string, readonly string[]>>;
  /**
   * When true, an unmapped value passes through unchanged and the match is
   * reported as inexact. Off by default; a vertical opting in is accepting facet
   * drift for that field with its eyes open.
   */
  readonly allow_unmapped?: boolean;
}

/**
 * The comparison key. Deliberately aggressive — punctuation and spacing carry no
 * meaning in a product-category label — but never applied to the stored value.
 */
export const vocabularyKey = (value: string): string =>
  comparisonKey(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export interface VocabularyMatch {
  readonly term: string;
  /** `canonical` — the value already was the term; `alias` — matched a variant. */
  readonly via: 'canonical' | 'alias' | 'unmapped';
  readonly source_value: string;
}

interface CompiledVocabulary {
  readonly canonical: ReadonlyMap<string, string>;
  readonly alias: ReadonlyMap<string, string>;
}

const CACHE = new WeakMap<VocabularyDefinition, CompiledVocabulary>();

const compile = (vocabulary: VocabularyDefinition): CompiledVocabulary => {
  const cached = CACHE.get(vocabulary);
  if (cached !== undefined) return cached;

  const canonical = new Map<string, string>();
  const alias = new Map<string, string>();
  for (const [term, variants] of Object.entries(vocabulary.terms)) {
    canonical.set(vocabularyKey(term), term);
    for (const variant of variants) {
      const key = vocabularyKey(variant);
      if (!canonical.has(key)) alias.set(key, term);
    }
  }

  const compiled: CompiledVocabulary = { canonical, alias };
  CACHE.set(vocabulary, compiled);
  return compiled;
};

export function mapVocabulary(
  raw: string,
  vocabulary: VocabularyDefinition,
): Normalized<VocabularyMatch> {
  const key = vocabularyKey(raw);
  if (key === '') return fail('EMPTY_VALUE', 'vocabulary value is empty');

  const compiled = compile(vocabulary);

  const canonicalHit = compiled.canonical.get(key);
  if (canonicalHit !== undefined) {
    return ok({ term: canonicalHit, via: 'canonical', source_value: raw });
  }

  const aliasHit = compiled.alias.get(key);
  if (aliasHit !== undefined) {
    return ok({ term: aliasHit, via: 'alias', source_value: raw });
  }

  if (vocabulary.allow_unmapped === true) {
    return ok({ term: raw, via: 'unmapped', source_value: raw });
  }

  return fail(
    'UNMAPPED_VOCABULARY_TERM',
    `${JSON.stringify(raw)} is not a term or known variant in vocabulary ${vocabulary.id}; add it to the vertical's vocabulary config rather than coercing it`,
  );
}
