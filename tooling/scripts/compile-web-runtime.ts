/**
 * Compile a vertical's read-side AND publish-side configuration into a bundled
 * JSON artifact for `apps/web`.
 *
 * `compile-vertical-runtime.ts` compiles what `apps/edge`'s metered API needs
 * — `fields` and `fact_selection` — and nothing about pages, because the API
 * has no pages. `apps/web` is a different surface with a different job: it
 * renders human pages, so it additionally needs `seo.yaml` (page classes,
 * quality gates, sitemap segments, structured data, LLM discovery) and the
 * per-entity-type `critical` property list `seo.yaml`'s quality gates are
 * defined against (doc 07). Two compilers rather than one shared one because
 * the two bundles genuinely carry different content for different reasons —
 * conflating them would mean the metered API bundle grows page-rendering
 * config it never reads.
 *
 * Also unlike the edge compiler, this one is not one-artifact-per-Worker: the
 * web surface is a single deployment serving every vertical (the "master
 * site with child sites per industry" ADR-0011 decides), so it compiles one
 * artifact per vertical AND an index naming which slugs exist.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  buildFactSelectionPolicy,
  buildFieldMetadata,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import type { IsoDateTime } from '@data-foundry/canonical-schema';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'apps', 'web', 'generated');

/** See `compile-vertical-runtime.ts` for why a build timestamp cannot be baked in. */
const SENTINEL_AT = '1970-01-01T00:00:00.000Z' as IsoDateTime;

export interface CriticalProperties {
  /** `entity_type` -> the property names `seo.yaml`'s gates call "critical". */
  readonly [entityType: string]: readonly string[];
}

export interface EntityTypeMeta {
  readonly [entityType: string]: {
    readonly label_singular: string;
    readonly label_plural: string;
    readonly canonical_slug_pattern: string;
  };
}

export interface WebRuntime {
  readonly vertical_slug: string;
  readonly vertical_name: string;
  readonly vertical_status: string;
  readonly entity_types: readonly string[];
  readonly entity_type_meta: EntityTypeMeta;
  readonly relationship_predicates: readonly string[];
  readonly fields: readonly unknown[];
  readonly fact_selection: Readonly<Record<string, unknown>>;
  readonly critical_properties: CriticalProperties;
  /** Raw parsed `seo.yaml`. Untyped here deliberately — `apps/web/src/seo.ts` owns the shape. */
  readonly seo: unknown;
  /** Raw parsed `filters.yaml` — `indexable_combinations` and facet fields. */
  readonly filters: unknown;
}

function criticalPropertiesOf(entities: Readonly<Record<string, unknown>>): CriticalProperties {
  const out: Record<string, readonly string[]> = {};
  for (const [entityType, raw] of Object.entries(entities)) {
    const properties = (raw as { properties?: readonly { name: string; critical?: boolean }[] })
      .properties ?? [];
    out[entityType] = properties.filter((p) => p.critical === true).map((p) => p.name);
  }
  return out;
}

function entityTypeMetaOf(entities: Readonly<Record<string, unknown>>): EntityTypeMeta {
  const out: Record<string, EntityTypeMeta[string]> = {};
  for (const [entityType, raw] of Object.entries(entities)) {
    const shape = raw as {
      label?: { singular?: string; plural?: string };
      canonical_slug?: { pattern?: string };
    };
    out[entityType] = {
      label_singular: shape.label?.singular ?? entityType,
      label_plural: shape.label?.plural ?? entityType,
      canonical_slug_pattern: shape.canonical_slug?.pattern ?? '{canonical_slug}',
    };
  }
  return out;
}

export async function compileWebRuntime(slug: string): Promise<WebRuntime> {
  const config = await loadVerticalConfig(slug, { verticalsDir: join(REPO_ROOT, 'verticals') });
  const policy = buildFactSelectionPolicy(config, { at: SENTINEL_AT });

  const factSelection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(policy)) {
    if (key === 'at') continue;
    factSelection[key] = value;
  }

  const seoPath = join(config.directory, 'seo.yaml');
  const seo = parseYaml(await readFile(seoPath, 'utf8'));

  return {
    vertical_slug: slug,
    vertical_name: config.name,
    vertical_status: config.status,
    entity_types: config.entityTypes,
    entity_type_meta: entityTypeMetaOf(config.entities),
    relationship_predicates: config.relationshipPredicates,
    fields: buildFieldMetadata(config),
    fact_selection: factSelection,
    critical_properties: criticalPropertiesOf(config.entities),
    seo,
    filters: config.filters,
  };
}

/** Stable, sorted, newline-terminated — so `--check` compares content, not formatting. */
export function serialize(runtime: WebRuntime): string {
  return `${JSON.stringify(runtime, null, 2)}\n`;
}

export function artifactPath(slug: string): string {
  return join(OUTPUT_DIR, `${slug}.web-runtime.json`);
}

export function indexPath(): string {
  return join(OUTPUT_DIR, 'index.json');
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Verticals with a compiled web presence. `_template` is not deployable. */
export const PUBLISHED_VERTICALS: readonly string[] = ['hvac'];

export async function run(slugs: readonly string[], check: boolean): Promise<number> {
  const stale: string[] = [];
  const index = { verticals: [...slugs].sort() };
  const indexExpected = `${JSON.stringify(index, null, 2)}\n`;

  for (const slug of slugs) {
    const expected = serialize(await compileWebRuntime(slug));
    const path = artifactPath(slug);
    if (check) {
      if ((await readIfPresent(path)) !== expected) stale.push(`${slug}.web-runtime.json`);
      continue;
    }
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path, expected, 'utf8');
  }

  if (check) {
    if ((await readIfPresent(indexPath())) !== indexExpected) stale.push('index.json');
  } else {
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(indexPath(), indexExpected, 'utf8');
  }

  if (check && stale.length > 0) {
    process.stderr.write(
      `Stale web runtime artifact(s): ${stale.join(', ')}.\n` +
        `Run \`pnpm web:compile\` and commit the result.\n`,
    );
    return 1;
  }
  process.stdout.write(
    check
      ? `OK: ${slugs.length} web runtime artifact(s) plus the index are up to date.\n`
      : `Wrote ${slugs.length} web runtime artifact(s) plus the index to apps/web/generated.\n`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  run(PUBLISHED_VERTICALS, check).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
