/**
 * Internal snake_case → wire camelCase.
 *
 * **Facts do not have a serializer here.** `factWire` calls `toRestFact` from
 * `@data-foundry/query-model` and adds nothing. ADR-0004 is explicit about why:
 * "Every REST, MCP, search-index and bulk-export handler MUST produce its wire
 * objects through the shared serializer... No surface may construct a fact wire
 * object independently." A second fact mapper here is how `editoriallyCorrected`
 * ends up on the MCP payload and not on the REST one, and nobody notices for a
 * quarter. `test/wire-boundary.test.ts` asserts mechanically that this file is
 * the only one that touches fact wire shapes and that it only does so through
 * the shared mapper — the enforcement ADR-0004 deferred until a surface existed.
 *
 * The other shapes (entities, redirects, edges, comparisons) have no shared
 * mapper yet because no second surface consumes them. When `apps/mcp` lands,
 * the mappers move down into query-model rather than being copied sideways.
 */
import type {
  Entity,
  EntityRedirect,
} from '../../../packages/canonical-schema/src/index.js';
import {
  assertNoReviewerIdentity,
  toRestFact,
  type CanonicalFactView,
  type ComparisonCell,
  type ComparisonRow,
  type EntityComparison,
  type EntityView,
  type FacetResult,
  type RedirectTrace,
  type RelationshipEdge,
  type RestFact,
  type SearchHit,
} from '../../../packages/query-model/src/index.js';

export interface EntityWire {
  readonly id: string;
  readonly verticalId: string;
  readonly entityType: string;
  readonly canonicalName: string;
  readonly canonicalSlug: string;
  readonly status: string;
  readonly qualityScore: number;
  readonly firstSeenAt: string;
  readonly lastVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function entityWire(entity: Entity): EntityWire {
  return {
    id: entity.id,
    verticalId: entity.vertical_id,
    entityType: entity.entity_type,
    canonicalName: entity.canonical_name,
    canonicalSlug: entity.canonical_slug,
    status: entity.status,
    qualityScore: entity.quality_score,
    firstSeenAt: entity.first_seen_at,
    lastVerifiedAt: entity.last_verified_at,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
  };
}

export interface RedirectHopWire {
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly fromSlug: string | null;
  readonly reason: string;
  readonly createdAt: string;
}

export interface RedirectTraceWire {
  readonly fromEntityId: string | null;
  readonly fromSlug: string | null;
  readonly reason: string | null;
  readonly hops: readonly RedirectHopWire[];
}

const hopWire = (hop: EntityRedirect): RedirectHopWire => ({
  fromEntityId: hop.from_entity_id,
  toEntityId: hop.to_entity_id,
  fromSlug: hop.from_slug,
  reason: hop.reason,
  createdAt: hop.created_at,
});

export function redirectTraceWire(trace: RedirectTrace): RedirectTraceWire {
  return {
    fromEntityId: trace.from_entity_id,
    fromSlug: trace.from_slug,
    reason: trace.reason,
    hops: trace.hops.map(hopWire),
  };
}

/**
 * The one fact projection. `reviewers` comes from the deployment's compiled
 * fact-selection policy — the only place a reviewer identity is declared — and
 * every fact leaving this surface is checked against it.
 *
 * The query layer already refuses a reviewer-naming reason inside
 * `canonicalFacts`. This is the second gate that `serialization.ts` describes
 * as guarding "the boundary for surfaces that assemble a payload from anywhere
 * else": a fact view reaching this function from a cache, a fixture or a future
 * batch path never passed through that first gate.
 */
export function factWire(view: CanonicalFactView, reviewers: readonly string[]): RestFact {
  const wire = toRestFact(view);
  assertNoReviewerIdentity(wire, reviewers);
  return wire;
}

export interface SearchHitWire {
  readonly entity: EntityWire;
  readonly matchKind: string;
  readonly score: number;
  readonly textRank: number;
  readonly exact: boolean;
  readonly matchedOn: string | null;
  readonly explain: string;
}

export function searchHitWire(hit: SearchHit): SearchHitWire {
  return {
    entity: entityWire(hit.entity),
    matchKind: hit.match_kind,
    score: hit.score,
    textRank: hit.text_rank,
    exact: hit.exact,
    matchedOn: hit.matched_on,
    explain: hit.explain,
  };
}

export interface FacetWire {
  readonly property: string;
  readonly label: string;
  readonly control: string;
  readonly valueType: string;
  readonly unit: string | null;
  readonly values: readonly { readonly value: string; readonly count: number }[];
  readonly range: { readonly min: number; readonly max: number } | null;
  readonly entityCount: number;
}

export function facetWire(facet: FacetResult): FacetWire {
  return {
    property: facet.property,
    label: facet.label,
    control: facet.control,
    valueType: facet.value_type,
    unit: facet.unit,
    values: facet.values.map((value) => ({ value: value.value, count: value.count })),
    range: facet.range,
    entityCount: facet.entity_count,
  };
}

export interface RelationshipEdgeWire {
  readonly relationshipId: string;
  readonly predicate: string;
  readonly direction: 'out' | 'in';
  readonly fromEntityId: string;
  readonly neighbor: EntityWire;
  readonly depth: number;
  readonly evidenceCount: number;
  readonly confidence: number;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export function relationshipEdgeWire(edge: RelationshipEdge): RelationshipEdgeWire {
  return {
    relationshipId: edge.relationship.id,
    predicate: edge.relationship.predicate,
    direction: edge.direction,
    fromEntityId: edge.from_entity_id,
    neighbor: entityWire(edge.neighbor),
    depth: edge.depth,
    evidenceCount: edge.evidence_count,
    confidence: edge.relationship.confidence,
    validFrom: edge.relationship.valid_from,
    validTo: edge.relationship.valid_to,
  };
}

export interface ComparisonCellWire {
  readonly entityId: string;
  readonly present: boolean;
  readonly value: unknown;
  readonly valueType: string | null;
  readonly unit: string | null;
  readonly rule: string | null;
  readonly sources: readonly string[];
  readonly unresolvedConflict: boolean;
}

export interface ComparisonRowWire {
  readonly property: string;
  readonly label: string;
  readonly unit: string | null;
  readonly differs: boolean;
  readonly cells: readonly ComparisonCellWire[];
}

export interface ComparisonWire {
  readonly entities: readonly EntityWire[];
  readonly rows: readonly ComparisonRowWire[];
  readonly propertiesCompared: number;
  readonly propertiesDiffering: number;
}

const cellWire = (cell: ComparisonCell): ComparisonCellWire => ({
  entityId: cell.entity_id,
  present: cell.present,
  value: cell.value,
  valueType: cell.value_type,
  unit: cell.unit,
  rule: cell.rule,
  sources: [...cell.sources],
  unresolvedConflict: cell.unresolved_conflict,
});

const rowWire = (row: ComparisonRow): ComparisonRowWire => ({
  property: row.property,
  label: row.label,
  unit: row.unit,
  differs: row.differs,
  cells: row.cells.map(cellWire),
});

export function comparisonWire(comparison: EntityComparison): ComparisonWire {
  return {
    entities: comparison.entities.map(entityWire),
    rows: comparison.rows.map(rowWire),
    propertiesCompared: comparison.properties_compared,
    propertiesDiffering: comparison.properties_differing,
  };
}

export function entityViewWire(view: EntityView): {
  readonly entity: EntityWire;
  readonly redirectedFrom: RedirectTraceWire | null;
} {
  return {
    entity: entityWire(view.entity),
    redirectedFrom: view.redirected_from === null ? null : redirectTraceWire(view.redirected_from),
  };
}
