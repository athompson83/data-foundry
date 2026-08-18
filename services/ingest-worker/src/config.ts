/**
 * Vertical configuration loader.
 *
 * The ingest worker knows nothing about HVAC. Everything that is
 * vertical-specific — which sources exist, what rights they carry, how each one
 * spells a model number, which vocabulary a category maps into, which source is
 * authoritative for which property — is read from `verticals/<slug>/` at run
 * time (AGENTS.md rule 4). Adding a fifth source, or a second vertical, is a
 * configuration change to files this service never imports by name.
 *
 * Nothing here interprets the configuration; it only parses and validates it.
 * The interpretation lives in `compile.ts` (source mappings → extraction /
 * normalization plans) and `fact-policy.ts` (fact selection).
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  InMemorySourceRegistry,
  parseSourceRegistryEntry,
  type SourceRegistryEntry,
  type SourceRegistryLoader,
} from '@data-foundry/source-registry';
import type { VocabularyDefinition } from '@data-foundry/normalization';
import { PipelineConfigurationError } from './errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `services/ingest-worker/src` → repository root. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const DEFAULT_VERTICALS_DIR = join(REPO_ROOT, 'verticals');

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

export interface LoadVerticalOptions {
  readonly verticalsDir?: string;
}

const readYaml = async (path: string): Promise<Yaml> => {
  try {
    return parseYaml(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new PipelineConfigurationError(`could not read vertical config ${path}`, { cause });
  }
};

export async function loadVerticalConfig(
  slug: string,
  options: LoadVerticalOptions = {},
): Promise<VerticalConfig> {
  const directory = join(options.verticalsDir ?? DEFAULT_VERTICALS_DIR, slug);
  const vertical = await readYaml(join(directory, 'vertical.yaml'));
  if (vertical?.slug !== slug) {
    throw new PipelineConfigurationError(
      `vertical.yaml in ${directory} declares slug ${String(vertical?.slug)}, not ${slug}`,
    );
  }

  const config = vertical.config ?? {};
  const sourcesDir = join(directory, String(config.sources_dir ?? 'sources'));
  const normalizersDir = join(directory, String(config.normalizers_dir ?? 'normalizers'));
  const entitiesDir = join(directory, String(config.entities_dir ?? 'entities'));

  const entityTypes: string[] = [...(vertical.entity_types ?? [])].map(String);
  const entities: Record<string, Yaml> = {};
  for (const entityType of entityTypes) {
    entities[entityType] = await readYaml(join(entitiesDir, `${entityType}.yaml`));
  }

  // Rule 1 lives here, at the earliest possible moment: a source file that does
  // not parse into a complete rights record is not a source we may fetch.
  const sourceFiles = (await readdir(sourcesDir)).filter((file) => file.endsWith('.yaml')).sort();
  const sources: SourceRegistryEntry[] = [];
  for (const file of sourceFiles) {
    const parsed = parseSourceRegistryEntry(await readYaml(join(sourcesDir, file)));
    if (!parsed.ok) {
      throw new PipelineConfigurationError(
        `${join(sourcesDir, file)} is not a valid source registry entry:\n  ${parsed.errors.join('\n  ')}`,
      );
    }
    sources.push(parsed.entry);
  }

  const domainNormalization = await readYaml(join(normalizersDir, '03-domain-normalization.yaml'));
  const ontology = await readYaml(join(normalizersDir, '04-ontology-mapping.yaml'));

  return {
    slug,
    name: String(vertical.name),
    schemaVersion: String(vertical.schema_version),
    status: String(vertical.status),
    defaultRefreshPolicy: vertical.default_refresh_policy,
    entityTypes,
    relationshipPredicates: [...(vertical.relationship_predicates ?? [])].map(String),
    aliasTypes: (vertical.alias_types ?? []).map((alias: Yaml) => ({
      type: String(alias.type),
      applies_to: [...(alias.applies_to ?? [])].map(String),
      strong: alias.strong === true,
      scoped_to: alias.scoped_to === undefined ? null : String(alias.scoped_to),
    })),
    entityResolution: vertical.entity_resolution ?? {},
    entities,
    sources,
    registry: new InMemorySourceRegistry(sources),
    sourceMappings: await readYaml(join(normalizersDir, 'source-mappings.yaml')),
    factSelection: await readYaml(join(normalizersDir, 'fact-selection.yaml')),
    typedValues: await readYaml(join(normalizersDir, '02-typed-values.yaml')),
    domainNormalization,
    ontology,
    filters: await readYaml(join(directory, String(config.filters ?? 'filters.yaml'))),
    publisherAliases: readPublisherAliases(domainNormalization),
    vocabularies: readVocabularies(ontology),
    directory,
  };
}

/**
 * `publisher_aliases` from layer 3 — a deterministic lookup table, never fuzzy
 * matching. Four spellings of one company collapse here or the graph carries
 * four manufacturers.
 */
function readPublisherAliases(domainNormalization: Yaml): PublisherAlias[] {
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
function readVocabularies(ontology: Yaml): Record<string, VocabularyDefinition> {
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
