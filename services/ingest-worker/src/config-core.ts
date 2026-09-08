/** Filesystem-free ingestion configuration contract and deterministic helpers. */
import type { SourceRegistryEntry, SourceRegistryLoader } from '@data-foundry/source-registry';
import type { VocabularyDefinition } from '@data-foundry/normalization';
/**
 * YAML is untyped by nature. Every consumer below narrows what it reads and
 * fails loudly, by path, on the shape it needs.
 */
type Yaml = any;

/** One declared manufacturer/publisher and the spellings that mean it. */
export interface PublisherAlias {
  readonly key: string;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
}

export interface VerticalConfig {
  readonly slug: string;
  readonly name: string;
  readonly schemaVersion: string;
  readonly status: string;
  readonly defaultRefreshPolicy: {
    readonly cadence: string;
    readonly max_staleness_hours: number;
    readonly priority: number;
  };
  readonly entityTypes: readonly string[];
  readonly relationshipPredicates: readonly string[];
  readonly aliasTypes: readonly {
    readonly type: string;
    readonly applies_to: readonly string[];
    readonly strong: boolean;
    /** Identity scope, e.g. `manufacturer` for SKUs that are only locally unique. */
    readonly scoped_to: string | null;
  }[];
  readonly entityResolution: Yaml;
  /** `entities/<type>.yaml`, keyed by entity type. */
  readonly entities: Readonly<Record<string, Yaml>>;
  readonly sources: readonly SourceRegistryEntry[];
  readonly registry: SourceRegistryLoader;
  readonly sourceMappings: Yaml;
  readonly factSelection: Yaml;
  /** `02-typed-values.yaml` — unit conversions and derived properties. */
  readonly typedValues: Yaml;
  readonly domainNormalization: Yaml;
  readonly ontology: Yaml;
  readonly filters: Yaml;
  readonly publisherAliases: readonly PublisherAlias[];
  readonly vocabularies: Readonly<Record<string, VocabularyDefinition>>;
  /** Absolute path of `verticals/<slug>`. */
  readonly directory: string;
}

/**
 * `publisher_aliases` from layer 3 — a deterministic lookup table, never fuzzy
 * matching. Four spellings of one company collapse here or the graph carries
 * four manufacturers.
 */
export function readPublisherAliases(domainNormalization: Yaml): PublisherAlias[] {
  const table = domainNormalization?.publisher_aliases ?? {};
  return Object.entries(table).map(([key, value]) => {
    const entry = value as Yaml;
    return {
      key,
      canonicalName: String(entry.canonical_name),
      aliases: [...(entry.aliases ?? [])].map(String),
    };
  });
}

/** Layer 4 controlled vocabularies, in the shape `@data-foundry/normalization` consumes. */
export function readVocabularies(ontology: Yaml): Record<string, VocabularyDefinition> {
  const vocabularies: Record<string, VocabularyDefinition> = {};
  for (const vocabulary of ontology?.controlled_vocabularies ?? []) {
    const property = String(vocabulary.property);
    const terms: Record<string, readonly string[]> = {};
    for (const term of vocabulary.terms ?? []) {
      terms[String(term.canonical)] = [...(term.synonyms ?? [])].map(String);
    }
    vocabularies[property] = {
      id: property,
      terms,
      // Deliberately absent: `unmapped_term_policy: quarantine` means an
      // unrecognised term is a recorded failure, never a silent passthrough.
      allow_unmapped: ontology?.unmapped_term_policy === 'passthrough',
    };
  }
  return vocabularies;
}

/**
 * Case-insensitive exact resolution of a brand string to a declared publisher.
 * `null` is the quarantine path: `unknown_publisher_policy: quarantine` — a
 * catalogue that auto-creates manufacturers from unrecognised brand strings
 * grows phantom companies.
 */
export function resolvePublisher(
  config: VerticalConfig,
  raw: string,
): PublisherAlias | null {
  const needle = raw.trim().toLowerCase();
  if (needle === '') return null;
  for (const publisher of config.publisherAliases) {
    if (publisher.canonicalName.toLowerCase() === needle) return publisher;
    if (publisher.aliases.some((alias) => alias.toLowerCase() === needle)) return publisher;
  }
  return null;
}

/**
 * The alias type that *names* an entity of this type — the one an inbound
 * reference from another record is written in.
 *
 * Derived from `vertical.yaml`: the first strong alias type that applies to
 * this entity type, preferring one that applies to no other. Without the
 * preference, `certification`'s `ahri_ref` would be a candidate for
 * `equipment_model` too and a `certified_by` edge would point at the wrong
 * side of the join.
 */
export function primaryAliasType(config: VerticalConfig, entityType: string): string | null {
  const applicable = config.aliasTypes.filter(
    (alias) => alias.strong && alias.applies_to.includes(entityType),
  );
  const exclusive = applicable.find((alias) => alias.applies_to.length === 1);
  return (exclusive ?? applicable[0])?.type ?? null;
}
