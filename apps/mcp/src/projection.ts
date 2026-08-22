/**
 * Query-layer values → tool results.
 *
 * Three rules govern everything in this file.
 *
 * ONE SERIALIZER (ADR-0004). Facts are projected by `toMcpFact` and by nothing
 * else. That function exists specifically so REST and MCP cannot drift about
 * what a fact looks like, and a second mapper here — however tidy — would
 * reintroduce exactly the divergence it was written to prevent. So the trust
 * fields (`editoriallyCorrected`, `editorialCorrectionReason`,
 * `selectionWarnings`, `sources`, `unresolvedConflict`) reach an agent because
 * they are on the shared shape, not because this file remembered them.
 *
 * WHITELIST, NEVER SPREAD. Every projection names the fields it emits. Nothing
 * is `...spread` out of a query-layer object, because the internal shapes grow
 * fields — `explainFact` already carries a staff reviewer's name — and a spread
 * publishes tomorrow's additions without anybody deciding to.
 *
 * SUPPRESSION IS REPORTED, NOT SILENT. A property with no publishable claim is
 * withheld (AGENTS.md rules 1 and 2, and the `suppress_facts_without_evidence`
 * and `exclude_unpublishable_sources` contract every vertical's `mcp.yaml`
 * declares) — but it is listed in `withheld_facts` with the query layer's own
 * reason. An agent that cannot see the gap will assume the property does not
 * exist, which is a different and worse claim than "we hold nothing publishable
 * about it".
 */
import {
  toMcpFact,
  type CanonicalFactView,
  type ClaimSummary,
  type Entity,
  type EntityComparison,
  type EntityView,
  type FacetResult,
  type FactExplanation,
  type RelationshipEdge,
  type RelationshipTraversal,
  type RestFact,
  type SearchHit,
  type SearchResult,
} from './query-layer.js';
import { namesReviewer } from './guard.js';

/* ------------------------------------------------------------------ *
 * Shared shapes
 * ------------------------------------------------------------------ */

export interface EntityRef {
  readonly entityId: string;
  readonly entityType: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly qualityScore: number;
  readonly firstSeenAt: string;
  readonly lastVerifiedAt: string | null;
  readonly canonicalUrl: string | null;
}

/** A merge/rename must not silently serve different content at an old id. */
export interface RedirectNotice {
  readonly fromEntityId: string | null;
  readonly fromSlug: string | null;
  readonly reason: string | null;
  readonly hops: number;
}

/** A property the platform holds claims about but publishes nothing for. */
export interface WithheldFact {
  readonly property: string;
  readonly rule: string;
  readonly reason: string;
}

export interface TrustSummary {
  readonly factCount: number;
  readonly withheldCount: number;
  readonly editoriallyCorrectedCount: number;
  readonly unresolvedConflictCount: number;
  /** Distinct selection warning codes across the sheet. Unknown codes: ignore, do not fail. */
  readonly selectionWarnings: readonly string[];
}

export interface FactSheet {
  readonly facts: readonly RestFact[];
  readonly withheldFacts: readonly WithheldFact[];
  readonly trust: TrustSummary;
}

/** Builds `canonicalUrl`. Presentation only — no lookup, no business logic. */
export type CanonicalUrlBuilder = (entity: Entity) => string | null;

export const noCanonicalUrls: CanonicalUrlBuilder = () => null;

export function canonicalUrlsUnder(base: string): CanonicalUrlBuilder {
  const trimmed = base.replace(/\/+$/, '');
  return (entity) => `${trimmed}/${entity.entity_type}/${entity.canonical_slug}`;
}

export function entityRef(entity: Entity, url: CanonicalUrlBuilder): EntityRef {
  return {
    entityId: entity.id,
    entityType: entity.entity_type,
    name: entity.canonical_name,
    slug: entity.canonical_slug,
    status: entity.status,
    qualityScore: entity.quality_score,
    firstSeenAt: entity.first_seen_at,
    lastVerifiedAt: entity.last_verified_at,
    canonicalUrl: url(entity),
  };
}

export function redirectNotice(view: EntityView): RedirectNotice | null {
  const trace = view.redirected_from;
  if (trace === null) return null;
  return {
    fromEntityId: trace.from_entity_id,
    fromSlug: trace.from_slug,
    reason: trace.reason,
    hops: trace.hops.length,
  };
}

/* ------------------------------------------------------------------ *
 * Fact sheets
 * ------------------------------------------------------------------ */

/**
 * A canonical view with no selected fact has no publishable claim: every
 * candidate was retracted, out of its validity window, unevidenced (rule 2) or
 * backed only by RED/UNREVIEWED sources (rule 1). The query layer decides that;
 * this only declines to print it as a fact.
 */
const isPublished = (view: CanonicalFactView): boolean => view.fact_id !== null;

export function factSheet(views: readonly CanonicalFactView[]): FactSheet {
  const published = views.filter(isPublished);
  const facts = published.map((view) => toMcpFact(view));

  const withheldFacts: WithheldFact[] = views
    .filter((view) => !isPublished(view))
    .map((view) => ({ property: view.property, rule: view.rule, reason: view.reason }));

  const warnings = new Set<string>();
  for (const fact of facts) for (const warning of fact.selectionWarnings) warnings.add(warning);

  return {
    facts,
    withheldFacts,
    trust: {
      factCount: facts.length,
      withheldCount: withheldFacts.length,
      editoriallyCorrectedCount: facts.filter((fact) => fact.editoriallyCorrected).length,
      unresolvedConflictCount: facts.filter((fact) => fact.unresolvedConflict).length,
      selectionWarnings: [...warnings].sort(),
    },
  };
}

/* ------------------------------------------------------------------ *
 * search_entities
 * ------------------------------------------------------------------ */

export interface SearchHitView {
  readonly entity: EntityRef;
  readonly matchKind: string;
  /** True when a deterministic identifier/slug/name match placed this hit. */
  readonly exact: boolean;
  readonly score: number;
  /** The purely textual rank, so exact-first ordering is observable, not asserted. */
  readonly textRank: number;
  readonly matchedOn: string | null;
  readonly why: string;
}

export interface SearchEntitiesResult {
  readonly vertical: string;
  readonly query: string | null;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  /** True when an exact identifier match short-circuited ranking (rule 7). */
  readonly exactMatch: boolean;
  readonly exactCount: number;
  readonly strategy: SearchResult['strategy'];
  readonly hits: readonly SearchHitView[];
  readonly facets: readonly FacetResult[];
}

const searchHit = (hit: SearchHit, url: CanonicalUrlBuilder): SearchHitView => ({
  entity: entityRef(hit.entity, url),
  matchKind: hit.match_kind,
  exact: hit.exact,
  score: hit.score,
  textRank: hit.text_rank,
  matchedOn: hit.matched_on,
  why: hit.explain,
});

export function searchResult(
  vertical: string,
  query: string | null,
  result: SearchResult,
  url: CanonicalUrlBuilder,
): SearchEntitiesResult {
  return {
    vertical,
    query,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    exactMatch: result.exact_short_circuit,
    exactCount: result.exact_count,
    // Passed through verbatim, including `vector: false`. An agent asking why
    // a fuzzy-looking near-match lost should be able to see that this server
    // never ranked it against a vector in the first place (rule 7).
    strategy: result.strategy,
    hits: result.hits.map((hit) => searchHit(hit, url)),
    facets: result.facets,
  };
}

/* ------------------------------------------------------------------ *
 * get_entity / list_facts
 * ------------------------------------------------------------------ */

export type EntityResolution = 'entity_id' | 'identifier' | 'slug';

export interface GetEntityResult {
  readonly entity: EntityRef;
  readonly resolvedBy: EntityResolution;
  readonly matchedOn: string | null;
  readonly redirectedFrom: RedirectNotice | null;
  readonly asOf: string;
  readonly facts: readonly RestFact[] | null;
  readonly withheldFacts: readonly WithheldFact[] | null;
  readonly trust: TrustSummary | null;
}

export interface ListFactsResult {
  readonly entity: EntityRef;
  readonly asOf: string;
  readonly properties: readonly string[] | null;
  readonly facts: readonly RestFact[];
  readonly withheldFacts: readonly WithheldFact[];
  readonly trust: TrustSummary;
}

/* ------------------------------------------------------------------ *
 * compare_entities
 * ------------------------------------------------------------------ */

export interface ComparisonCellView {
  readonly entityId: string;
  readonly present: boolean;
  readonly value: unknown;
  readonly valueType: string | null;
  readonly unit: string | null;
  readonly rule: string | null;
  readonly sources: readonly string[];
  readonly unresolvedConflict: boolean;
}

export interface ComparisonRowView {
  readonly property: string;
  readonly label: string;
  readonly unit: string | null;
  readonly differs: boolean;
  readonly cells: readonly ComparisonCellView[];
}

export interface CompareEntitiesResult {
  readonly entities: readonly EntityRef[];
  readonly rows: readonly ComparisonRowView[];
  readonly propertiesCompared: number;
  readonly propertiesDiffering: number;
  /** Ids asked for that resolved to nothing, so a partial answer is legible. */
  readonly unresolvedEntityIds: readonly string[];
}

export function comparison(
  result: EntityComparison,
  requested: readonly string[],
  url: CanonicalUrlBuilder,
): CompareEntitiesResult {
  const resolved = new Set<string>(result.entities.map((entity) => entity.id));
  return {
    entities: result.entities.map((entity) => entityRef(entity, url)),
    rows: result.rows.map((row) => ({
      property: row.property,
      label: row.label,
      unit: row.unit,
      differs: row.differs,
      cells: row.cells.map((cell) => ({
        entityId: cell.entity_id,
        present: cell.present,
        value: cell.value,
        valueType: cell.value_type,
        unit: cell.unit,
        rule: cell.rule,
        sources: [...cell.sources],
        unresolvedConflict: cell.unresolved_conflict,
      })),
    })),
    propertiesCompared: result.properties_compared,
    propertiesDiffering: result.properties_differing,
    unresolvedEntityIds: requested.filter((id) => !resolved.has(id)),
  };
}

/* ------------------------------------------------------------------ *
 * traverse_relationships
 * ------------------------------------------------------------------ */

export interface RelationshipEdgeView {
  readonly relationshipId: string;
  readonly predicate: string;
  readonly direction: 'out' | 'in';
  readonly depth: number;
  readonly fromEntityId: string;
  readonly to: EntityRef;
  readonly confidence: number;
  readonly status: string;
  readonly validFrom: string;
  readonly evidenceCount: number;
}

export interface TraverseRelationshipsResult {
  readonly root: EntityRef;
  readonly depth: number;
  readonly truncated: boolean;
  readonly edges: readonly RelationshipEdgeView[];
  /**
   * Edges the walk reached and would not serve: no evidence at all (AGENTS.md
   * rule 2, and the `suppress_facts_without_evidence` contract in `mcp.yaml`),
   * or evidence only from sources that fail the publish gate (rule 1, and
   * `exclude_unpublishable_sources`). Counted rather than hidden: a traversal
   * that quietly returns fewer edges than the graph holds is indistinguishable
   * from a graph that is missing them.
   *
   * A count, never an identity. It says how many edges were refused, not which
   * or whose, so it reports the gap without disclosing a blocked source.
   */
  readonly withheldEdgeCount: number;
}

const edgeView = (edge: RelationshipEdge, url: CanonicalUrlBuilder): RelationshipEdgeView => ({
  relationshipId: edge.relationship.id,
  predicate: edge.relationship.predicate,
  direction: edge.direction,
  depth: edge.depth,
  fromEntityId: edge.from_entity_id,
  to: entityRef(edge.neighbor, url),
  confidence: edge.relationship.confidence,
  status: edge.relationship.status,
  validFrom: edge.relationship.valid_from,
  evidenceCount: edge.evidence_count,
});

export function traversal(
  root: Entity,
  result: RelationshipTraversal,
  url: CanonicalUrlBuilder,
): TraverseRelationshipsResult {
  // Two withholding points, deliberately added rather than one trusted.
  //
  // The query layer refuses an edge nothing publishable backs and reports how
  // many in `withheld_edge_count` — it has to drop them there, because a hop
  // taken through a blocked edge would publish the blocked claim as a path, so
  // this projection never sees them and cannot count them itself.
  //
  // The filter below is what is left of the rule-2 check this projection used
  // to do alone. Under the layer's fail-closed default it drops nothing, since
  // an unevidenced edge is already withheld upstream. It stays because the
  // alternative is a surface whose rule-2 guarantee holds only for as long as
  // somebody else's default does, and it is one predicate.
  const evidenced = result.edges.filter((edge) => edge.evidence_count > 0);
  return {
    root: entityRef(root, url),
    depth: result.depth,
    truncated: result.truncated,
    edges: evidenced.map((edge) => edgeView(edge, url)),
    withheldEdgeCount: result.withheld_edge_count + (result.edges.length - evidenced.length),
  };
}

/* ------------------------------------------------------------------ *
 * explain_fact
 * ------------------------------------------------------------------ */

/** The query layer's own warning-code union. Never widened to `string` here. */
export type SelectionWarningCode = FactExplanation['selection_warnings'][number];

export interface ClaimSourceView {
  readonly publisher: string;
  readonly domain: string;
  readonly sourceType: string;
  readonly authorityRank: number;
  /** The value exactly as the source wrote it, before normalization. */
  readonly sourceValue: string;
  readonly locator: string;
  readonly artifactUrl: string;
  readonly retrievedAt: string;
  readonly observedAt: string;
}

export interface ClaimView {
  readonly value: unknown;
  readonly valueType: string;
  readonly unit: string | null;
  readonly status: string;
  readonly confidence: number;
  readonly selected: boolean;
  readonly sources: readonly ClaimSourceView[];
  /** Backing sources dropped for failing the publish gate (rule 1). */
  readonly withheldSourceCount: number;
}

export interface ConflictView {
  readonly value: unknown;
  readonly valueType: string;
  readonly unit: string | null;
  readonly claimedBy: readonly string[];
  readonly lastObservedAt: string | null;
}

export interface ExclusionView {
  readonly factId: string;
  readonly reason: string;
  readonly detail: string;
}

export interface ExplainFactResult {
  readonly entity: {
    readonly entityId: string;
    readonly entityType: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly property: string;
  readonly asOf: string;
  readonly canonicalValue: unknown;
  readonly valueType: string | null;
  readonly unit: string | null;
  readonly selectedBy: string;
  readonly selectionReason: string;
  readonly editoriallyCorrected: boolean;
  readonly editorialCorrectionReason: string | null;
  readonly selectionWarnings: readonly SelectionWarningCode[];
  readonly claims: readonly ClaimView[];
  readonly conflicts: readonly ConflictView[];
  readonly unresolvedConflict: boolean;
  readonly excluded: readonly ExclusionView[];
  /** Claims dropped entirely because no backing source is publishable (rule 1). */
  readonly withheldClaimCount: number;
  readonly narrative: readonly string[];
}

const REDACTED_REVIEWER_LINE =
  'One or more explanation lines were withheld: they named the internal reviewer who ' +
  'authorised the editorial correction. The correction and its customer-visible reason are ' +
  'reported above; who made it is not published.';

const REDACTED_SOURCE_LINE =
  'One or more explanation lines were withheld: they repeated a claim from a source that fails ' +
  'the publish gate. Such a source does not publish (AGENTS.md rule 1), and `withheldClaimCount` ' +
  'above counts what was dropped.';

/**
 * What the projected result must never contain: the publisher, domain or
 * artifact URL of a source that failed the publish gate.
 *
 * NOT the asserted value. "99" is a substring of a confidence of 0.99, and a
 * sweep on values would refuse ordinary results. Every narrative line that
 * carries a withheld claim's value begins with its publisher, so removing the
 * line by publisher removes the value with it.
 */
export function withheldSourceTokens(source: FactExplanation): string[] {
  const tokens = new Set<string>();
  for (const claim of source.claims) {
    for (const attribution of claim.attributions) {
      if (attribution.publishable) continue;
      tokens.add(attribution.publisher.toLowerCase());
      tokens.add(attribution.domain.toLowerCase());
      tokens.add(attribution.artifact_url.toLowerCase());
    }
  }
  return [...tokens].filter((token) => token !== '');
}

/**
 * The only projection of the INTERNAL trust surface.
 *
 * `FactExplanation` carries `editorial_correction.reviewer` and a rendered
 * narrative line reading "Reviewer: <name>". Neither reaches the result: the
 * correction is projected down to its customer-visible reason (the same field
 * `toMcpFact` publishes), and narrative lines naming a reviewer are dropped and
 * replaced by a line that says a line was dropped.
 *
 * `reviewerTokens` is supplied by the caller from the very correction being
 * projected. `src/guard.ts` then sweeps the finished object with the same
 * tokens, so a line this filter fails to catch does not become an answer.
 */
export function explanation(
  source: FactExplanation,
  reviewerTokens: readonly string[],
  sourceTokens: readonly string[],
): ExplainFactResult {
  const claims: ClaimView[] = [];
  let withheldClaimCount = 0;

  for (const claim of source.claims) {
    const view = claimView(claim);
    if (view === null) withheldClaimCount += 1;
    else claims.push(view);
  }

  // The narrative renders one line per attribution — including the ones
  // excluded on rights, complete with the value they asserted and the document
  // it was read from. Forwarding it verbatim would publish exactly what the
  // claim filter above just refused to publish.
  const withoutReviewer = source.narrative.filter((line) => !namesReviewer(line, reviewerTokens));
  const kept = withoutReviewer.filter((line) => !namesReviewer(line, sourceTokens));

  const narrative = [
    ...kept,
    ...(withoutReviewer.length === source.narrative.length ? [] : [REDACTED_REVIEWER_LINE]),
    ...(kept.length === withoutReviewer.length ? [] : [REDACTED_SOURCE_LINE]),
  ];

  return {
    entity: {
      entityId: source.entity.id,
      entityType: source.entity.entity_type,
      name: source.entity.canonical_name,
      slug: source.entity.canonical_slug,
    },
    property: source.property,
    asOf: source.at,
    canonicalValue: source.selected?.value ?? null,
    valueType: source.selected?.value_type ?? null,
    unit: source.selected?.unit ?? null,
    selectedBy: source.rule,
    selectionReason: source.reason,
    editoriallyCorrected: source.editorially_corrected,
    // The reason only. `source.editorial_correction` also holds `reviewer` and
    // is never spread, never forwarded, and never read here for any purpose
    // other than searching the payload for it.
    editorialCorrectionReason: source.editorial_correction?.reason ?? null,
    selectionWarnings: [...source.selection_warnings],
    claims,
    conflicts: source.conflicts.map((conflict) => ({
      value: conflict.value,
      valueType: conflict.value_type,
      unit: conflict.unit,
      claimedBy: conflict.claimed_by.map((info) => info.publisher),
      lastObservedAt: conflict.last_observed_at,
    })),
    unresolvedConflict: source.unresolved_conflict,
    excluded: source.excluded.map((item) => ({
      factId: item.fact_id,
      reason: item.reason,
      detail: item.detail,
    })),
    withheldClaimCount,
    narrative,
  };
}

/**
 * A claim, minus every attribution that fails the publish gate.
 *
 * `publishable` is computed by the query layer from the source's rights
 * classification; this reads that decision rather than making its own. A claim
 * left with no publishable attribution is not a claim this surface may repeat
 * (rule 1), so it is dropped and counted.
 */
function claimView(claim: ClaimSummary): ClaimView | null {
  const publishable = claim.attributions.filter((attribution) => attribution.publishable);
  if (publishable.length === 0) return null;
  return {
    value: claim.value,
    valueType: claim.value_type,
    unit: claim.unit,
    status: claim.status,
    confidence: claim.confidence,
    selected: claim.selected,
    sources: publishable.map((attribution) => ({
      publisher: attribution.publisher,
      domain: attribution.domain,
      sourceType: attribution.source_type,
      authorityRank: attribution.authority_rank,
      sourceValue: attribution.source_value,
      locator: attribution.locator,
      artifactUrl: attribution.artifact_url,
      retrievedAt: attribution.retrieved_at,
      observedAt: attribution.observed_at,
    })),
    withheldSourceCount: claim.attributions.length - publishable.length,
  };
}
