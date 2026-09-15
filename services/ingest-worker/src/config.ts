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

export * from './config-core.js';
import { readPublisherAliases, readVocabularies, type VerticalConfig } from './config-core.js';
type Yaml = any;

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
