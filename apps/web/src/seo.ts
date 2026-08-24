/**
 * Typed access to the compiled `seo.yaml` (doc 07) carried in a `WebRuntime`
 * artifact. `tooling/scripts/compile-web-runtime.ts` produces the artifact;
 * this module is the one place that gives its `unknown` payload a shape,
 * mirroring how `apps/edge/src/composition.ts` treats `fields`/`fact_selection`
 * as trusted-by-construction — `seo.yaml` is first-party config, checked by
 * `pnpm verticals:validate` and rebuilt with `--check` in CI, not adversarial
 * input that needs a Zod boundary.
 */

export interface PageClass {
  readonly id: string;
  readonly entity_type?: string;
  readonly path: string;
  readonly title: string;
  readonly structured_data: string | null;
  readonly sitemap: string | null;
  readonly indexable: 'true' | boolean | 'conditional';
  readonly quality_gate: string;
  readonly description?: string;
}

export interface QualityGate {
  readonly description?: string;
  readonly min_critical_fact_coverage?: number;
  readonly min_total_facts?: number;
  readonly min_evidence_coverage?: number;
  readonly min_distinct_sources?: number;
  readonly min_entity_quality_score?: number;
  readonly max_staleness_days?: number;
  readonly min_results?: number;
  readonly min_indexable_results?: number;
  readonly min_unique_content_words?: number;
  readonly require_all_sources_publishable?: boolean;
  readonly block_on_open_dispute?: boolean;
  readonly block_on_disputed_critical_property?: boolean;
  readonly require_distinct_value?: boolean;
  readonly min_related_entities?: number;
  readonly min_supersession_edges?: number;
  readonly require_terminal_model_indexable?: boolean;
  readonly min_shared_properties?: number;
  readonly min_both_entities_indexable?: boolean;
  readonly demand_threshold?: number;
  readonly require_whitelisted_combination?: boolean;
  readonly min_entities?: number;
}

export interface OnGateFailure {
  readonly robots: string;
  readonly in_sitemap: boolean;
  readonly in_api?: boolean;
  readonly in_mcp?: boolean;
  readonly show_coverage_notice?: boolean;
  readonly notice_template?: string;
}

export interface SitemapSegment {
  readonly id: string;
  readonly path: string;
}

export interface StructuredDataSpec {
  readonly type: string | null;
  readonly required_fields?: readonly string[];
  readonly reason?: string;
}

export interface SeoConfig {
  readonly url_prefix: string;
  readonly page_classes: readonly PageClass[];
  readonly quality_gates: Readonly<Record<string, QualityGate>>;
  readonly on_gate_failure: OnGateFailure;
  readonly sitemaps: {
    readonly index: string;
    readonly max_urls_per_file: number;
    readonly include_only_indexable?: boolean;
    readonly segments: readonly SitemapSegment[];
  };
  readonly canonical: {
    readonly redirect_on_merge: boolean;
    readonly redirect_status: number;
    readonly trailing_slash: boolean;
  };
  readonly structured_data: Readonly<Record<string, StructuredDataSpec>>;
  readonly llm_discovery: {
    readonly llms_txt: string;
    readonly llms_full_txt: string;
    readonly include?: readonly string[];
  };
  readonly agent_intents?: Readonly<
    Record<string, { readonly tool: string; readonly examples: readonly string[] }>
  >;
}

export interface IndexableCombination {
  readonly id: string;
  readonly fields: readonly string[];
  readonly max_depth: number;
  readonly min_results: number;
  readonly rationale?: string;
}

export interface FiltersConfig {
  readonly fields?: readonly {
    readonly field: string;
    readonly entity_type?: string;
    readonly seo?: { readonly indexable?: boolean; readonly min_results?: number };
  }[];
  readonly indexable_combinations?: readonly IndexableCombination[];
}

export interface EntityTypeMeta {
  readonly label_singular: string;
  readonly label_plural: string;
  readonly canonical_slug_pattern: string;
}

export interface WebRuntime {
  readonly vertical_slug: string;
  readonly vertical_name: string;
  readonly vertical_status: string;
  readonly entity_types: readonly string[];
  readonly entity_type_meta: Readonly<Record<string, EntityTypeMeta>>;
  readonly relationship_predicates: readonly string[];
  readonly fields: readonly unknown[];
  readonly fact_selection: Readonly<Record<string, unknown>>;
  readonly critical_properties: Readonly<Record<string, readonly string[]>>;
  readonly seo: SeoConfig;
  readonly filters: FiltersConfig;
}

export function pageClassForEntityType(seo: SeoConfig, entityType: string): PageClass | null {
  return seo.page_classes.find((pc) => pc.entity_type === entityType) ?? null;
}

export function pageClassById(seo: SeoConfig, id: string): PageClass | null {
  return seo.page_classes.find((pc) => pc.id === id) ?? null;
}

export function gateFor(seo: SeoConfig, gateId: string): QualityGate | null {
  return seo.quality_gates[gateId] ?? null;
}

/** `{canonical_slug}`, `{canonical_name}` etc. — no logic, just substitution. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
