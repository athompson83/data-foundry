/**
 * The indexability quality gate, evaluated for real (doc 07 / AGENTS.md rule 8:
 * "Do not create thin SEO pages. Indexability is quality/demand gated.").
 *
 * `seo.yaml` declares gate THRESHOLDS; this module is what actually measures a
 * live entity against them, through the same `QueryModel` every other surface
 * reads (rule 5) — never a second opinion computed from raw rows.
 *
 * A gate dimension this module cannot honestly measure (no traffic/demand
 * system exists in this repository, and there is no dispute/correction ledger
 * beyond the per-fact conflict state `canonicalFacts` already reports) is NOT
 * silently treated as passing. It fails closed: absence of proof of quality is
 * absence of quality, which is the whole point of a gate rather than a
 * checklist. `on_gate_failure` in `seo.yaml` already makes a failed gate cheap
 * — the page still renders, still serves the API/MCP, just carries
 * `noindex,follow` — so failing closed here costs nothing but an index entry
 * the page had not earned yet.
 */
import type { CanonicalFactView, SurfaceQueryModel } from '@data-foundry/query-model';
import type { EntityId, VerticalId } from '@data-foundry/canonical-schema';
import type { QualityGate } from './seo.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';

/** Entities scanned when computing a vertical-wide signal (the `dataset` gate). */
const MAX_VERTICAL_SCAN = 200;

export interface GateSignals {
  readonly entity_quality_score?: number;
  readonly critical_fact_coverage?: number;
  readonly total_facts?: number;
  readonly evidence_coverage?: number;
  readonly distinct_sources?: number;
  readonly staleness_days?: number;
  readonly disputed_critical_property?: boolean;
  readonly unique_content_words?: number;
  readonly related_entities?: number;
  readonly supersession_edges?: number;
  readonly terminal_model_indexable?: boolean;
  readonly shared_properties?: number;
  readonly both_entities_indexable?: boolean;
  readonly results?: number;
  readonly indexable_results?: number;
  readonly whitelisted_combination?: boolean;
  readonly entities?: number;
}

export interface GateVerdict {
  readonly passed: boolean;
  /** Internal diagnostics only. Never render these strings on a public page. */
  readonly failures: readonly string[];
}

const UNMEASURED = (dimension: string): string =>
  `${dimension} has no measurement source in this deployment yet`;

/**
 * Pure: no I/O, only comparison. Every `min_*`/`max_*`/`require_*` key in
 * `gate` that has no matching signal fails closed with `UNMEASURED`, rather
 * than being skipped — a threshold this function does not know how to check
 * is not the same thing as a threshold that was cleared.
 */
export function evaluateGate(gate: QualityGate, signals: GateSignals): GateVerdict {
  const failures: string[] = [];
  const need = (value: number | undefined, min: number, label: string): void => {
    if (value === undefined) {
      failures.push(UNMEASURED(label));
      return;
    }
    if (value < min) failures.push(`${label} is ${value}, below the required ${min}`);
  };
  const needMax = (value: number | undefined, max: number, label: string): void => {
    if (value === undefined) {
      failures.push(UNMEASURED(label));
      return;
    }
    if (value > max) failures.push(`${label} is ${value}, above the allowed ${max}`);
  };
  const needTrue = (value: boolean | undefined, label: string): void => {
    if (value !== true) failures.push(value === false ? `${label} is false` : UNMEASURED(label));
  };

  if (gate.min_entity_quality_score !== undefined) {
    need(signals.entity_quality_score, gate.min_entity_quality_score, 'entity_quality_score');
  }
  if (gate.min_critical_fact_coverage !== undefined) {
    need(signals.critical_fact_coverage, gate.min_critical_fact_coverage, 'critical_fact_coverage');
  }
  if (gate.min_total_facts !== undefined) {
    need(signals.total_facts, gate.min_total_facts, 'total_facts');
  }
  if (gate.min_evidence_coverage !== undefined) {
    need(signals.evidence_coverage, gate.min_evidence_coverage, 'evidence_coverage');
  }
  if (gate.min_distinct_sources !== undefined) {
    need(signals.distinct_sources, gate.min_distinct_sources, 'distinct_sources');
  }
  if (gate.max_staleness_days !== undefined) {
    needMax(signals.staleness_days, gate.max_staleness_days, 'staleness_days');
  }
  if (gate.min_unique_content_words !== undefined) {
    need(signals.unique_content_words, gate.min_unique_content_words, 'unique_content_words');
  }
  if (gate.min_related_entities !== undefined) {
    need(signals.related_entities, gate.min_related_entities, 'related_entities');
  }
  if (gate.min_supersession_edges !== undefined) {
    need(signals.supersession_edges, gate.min_supersession_edges, 'supersession_edges');
  }
  if (gate.min_shared_properties !== undefined) {
    need(signals.shared_properties, gate.min_shared_properties, 'shared_properties');
  }
  if (gate.min_results !== undefined) {
    need(signals.results, gate.min_results, 'results');
  }
  if (gate.min_indexable_results !== undefined) {
    need(signals.indexable_results, gate.min_indexable_results, 'indexable_results');
  }
  if (gate.min_entities !== undefined) {
    need(signals.entities, gate.min_entities, 'entities');
  }
  if (gate.block_on_disputed_critical_property === true) {
    if (signals.disputed_critical_property === undefined) {
      failures.push(UNMEASURED('disputed_critical_property'));
    } else if (signals.disputed_critical_property === true) {
      failures.push('a critical property is under an unresolved conflict');
    }
  }
  if (gate.require_terminal_model_indexable === true) {
    needTrue(signals.terminal_model_indexable, 'terminal_model_indexable');
  }
  if (gate.min_both_entities_indexable === true) {
    needTrue(signals.both_entities_indexable, 'both_entities_indexable');
  }
  if (gate.require_whitelisted_combination === true) {
    needTrue(signals.whitelisted_combination, 'whitelisted_combination');
  }
  // require_all_sources_publishable is not re-checked here: `canonicalFacts`
  // already applies AGENTS.md rule 1 before a fact is ever visible to this
  // module, so every signal above is already computed only from publishable
  // evidence. Re-deriving the same filter here is the mistake the comment in
  // `apps/api/src/routes.ts` warns against.
  //
  // demand_threshold, block_on_open_dispute and require_distinct_value are
  // declared in seo.yaml but have no signal in this deployment: no
  // traffic/analytics pipeline, no dispute ledger beyond per-fact conflicts,
  // and no measurement of "does this page say something the sources do not
  // already say together" (seo.yaml's own definition of distinct value —
  // normalized specs, resolved identifiers, the supersession chain — is a
  // real property but not one this module computes). A gate that declares
  // any of the three therefore never passes here, which is the fail-closed
  // default this module commits to, not a bug to silence.
  if (gate.demand_threshold !== undefined) failures.push(UNMEASURED('demand_threshold'));
  if (gate.block_on_open_dispute === true) failures.push(UNMEASURED('open_dispute'));
  if (gate.require_distinct_value === true) failures.push(UNMEASURED('distinct_value'));

  return { passed: failures.length === 0, failures };
}

/** Facts plus surface-authorized evidence signals shared by every entity-scoped gate. */
export async function computeEntitySignals(
  queryModel: SurfaceQueryModel,
  entityId: EntityId,
  entityQualityScore: number,
  entityUpdatedAt: string,
  criticalProperties: readonly string[],
  policy: Parameters<SurfaceQueryModel['canonicalFacts']>[1],
  now: Date,
): Promise<GateSignals> {
  const facts = await queryModel.canonicalFacts(entityId, policy);
  const published = facts.filter((f) => f.fact_id !== null);

  const criticalPublished = published.filter((f) => criticalProperties.includes(f.property));
  const criticalCoverage =
    criticalProperties.length === 0 ? 1 : criticalPublished.length / criticalProperties.length;

  const evidence = await measureAuthorizedFactEvidence(queryModel, entityId, published, policy);

  const disputed = criticalPublished.some((f) => f.unresolved_conflict);

  // An unparseable entityUpdatedAt makes new Date(...).getTime() NaN, and
  // `NaN > max` is false — the naive form would fail OPEN on the staleness
  // gate for exactly the value that could not be measured. Omitting the
  // signal instead routes it through evaluateGate's own UNMEASURED path.
  const updatedAtMs = new Date(entityUpdatedAt).getTime();
  const stalenessDays = Number.isNaN(updatedAtMs)
    ? undefined
    : Math.max(0, Math.floor((now.getTime() - updatedAtMs) / (1000 * 60 * 60 * 24)));

  return {
    entity_quality_score: entityQualityScore,
    critical_fact_coverage: criticalCoverage,
    total_facts: published.length,
    evidence_coverage: evidence.coverage,
    distinct_sources: evidence.distinctSources,
    ...(stalenessDays === undefined ? {} : { staleness_days: stalenessDays }),
    disputed_critical_property: disputed,
  };
}

/**
 * `min_unique_content_words`: word count of the page's OWN content — the
 * caller passes only the text that is not shared boilerplate (nav, footer,
 * repeated disclaimers), so "unique" is enforced by what is handed in here,
 * not by de-duplicating the vocabulary of a single page against itself.
 */
export function countContentWords(renderedText: string): number {
  return renderedText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Signals for the `dataset` gate — the whole vertical, not one entity.
 *
 * The single implementation both `pages.ts` (deciding a page's own robots
 * meta) and `sitemap.ts` (deciding whether to list that same page) call.
 * Two implementations of "is the dataset landing page indexable" is exactly
 * how a sitemap and the page it points at end up disagreeing.
 */
export async function computeVerticalDatasetSignals(
  queryModel: SurfaceQueryModel,
  verticalId: VerticalId,
): Promise<GateSignals & { readonly entities: number }> {
  const result = await queryModel.search({ vertical_id: verticalId, limit: MAX_VERTICAL_SCAN, offset: 0 });
  // Bounded rather than serial, for the same reason as sitemap.ts's
  // per-entity fan-out (see concurrency.ts): up to MAX_VERTICAL_SCAN
  // sequential canonicalFacts round trips is slow at scale, and unbounded
  // parallel fan-out risks the connection pool instead.
  const scanned = result.hits.slice(0, MAX_VERTICAL_SCAN);
  const factLists = await mapWithConcurrency(scanned, DEFAULT_CONCURRENCY, (hit) =>
    queryModel.canonicalFacts(hit.entity.id),
  );
  const evidenceLists = await mapWithConcurrency(
    scanned,
    DEFAULT_CONCURRENCY,
    (hit, index) =>
      measureAuthorizedFactEvidence(queryModel, hit.entity.id, factLists[index] ?? [], {}),
  );
  const sources = new Set<string>();
  let factTotal = 0;
  let traceable = 0;
  for (const evidence of evidenceLists) {
    factTotal += evidence.total;
    traceable += evidence.traceable;
    for (const source of evidence.sources) sources.add(source);
  }
  return {
    entities: result.total,
    distinct_sources: sources.size,
    evidence_coverage: factTotal === 0 ? 1 : traceable / factTotal,
  };
}

interface AuthorizedFactEvidence {
  readonly total: number;
  readonly traceable: number;
  readonly coverage: number;
  readonly distinctSources: number;
  readonly sources: ReadonlySet<string>;
}

/**
 * Measure only evidence the already-bound surface model is allowed to return.
 * A raw provenance aggregate would include neighboring denied claims and turn
 * a public quality gate into an authorization side channel.
 */
async function measureAuthorizedFactEvidence(
  queryModel: SurfaceQueryModel,
  entityId: EntityId,
  facts: readonly CanonicalFactView[],
  policy: Parameters<SurfaceQueryModel['canonicalFacts']>[1],
): Promise<AuthorizedFactEvidence> {
  const selected = facts.filter((fact) => fact.fact_id !== null);
  const explanations = await mapWithConcurrency(selected, DEFAULT_CONCURRENCY, (fact) =>
    queryModel.explainFact(entityId, fact.property, policy),
  );
  const sources = new Set<string>();
  let traceable = 0;
  for (const [index, explanation] of explanations.entries()) {
    const fact = selected[index];
    const selectedExplanation = explanation?.selected ?? null;
    const attributions =
      selectedExplanation !== null && selectedExplanation.fact_id === fact?.fact_id
        ? selectedExplanation.attributions
        : [];
    if (attributions.length > 0) traceable += 1;
    for (const attribution of attributions) {
      sources.add(JSON.stringify([attribution.publisher, attribution.domain]));
    }
  }
  return {
    total: selected.length,
    traceable,
    coverage: selected.length === 0 ? 1 : traceable / selected.length,
    distinctSources: sources.size,
    sources,
  };
}
