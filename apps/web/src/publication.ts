/**
 * Publication policy shared by routes, renderers, and sitemaps.
 *
 * PUBLIC_WEB answers whether content may be served to a human. SEARCH_INDEX is
 * a separate distribution decision. Neither surface is inferred from vertical
 * configuration or from a neighboring grant.
 */
import type { Entity } from '@data-foundry/canonical-schema';
import type {
  CanonicalFactView,
  RelationshipEdge,
  RelationshipTraversal,
  SurfaceFactExplanation,
  SurfaceQueryModel,
  TraversalQuery,
} from '@data-foundry/query-model';
import type { VerticalDeployment } from './composition.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';

const SEARCH_PAGE_SIZE = 200;

export type WebPublicationSurface = 'PUBLIC_WEB' | 'SEARCH_INDEX';

function surfaceModel(
  vertical: VerticalDeployment,
  surface: WebPublicationSurface,
): SurfaceQueryModel {
  return surface === 'PUBLIC_WEB'
    ? vertical.publicQueryModel
    : vertical.searchIndexQueryModel;
}

/** One exact, surface-bound answer for whether a vertical may participate. */
export async function verticalEligibleForSurface(
  vertical: VerticalDeployment,
  surface: WebPublicationSurface,
): Promise<boolean> {
  if (vertical.runtime.vertical_status !== 'ACTIVE') return false;
  const result = await surfaceModel(vertical, surface).search({
    vertical_id: vertical.verticalId,
    limit: 1,
    offset: 0,
  });
  return result.total > 0 && result.hits.length > 0;
}

export interface VerticalPublicationEligibility {
  readonly publicWeb: boolean;
  readonly searchIndex: boolean;
}

export async function verticalPublicationEligibility(
  vertical: VerticalDeployment,
): Promise<VerticalPublicationEligibility> {
  const [publicWeb, searchIndex] = await Promise.all([
    verticalEligibleForSurface(vertical, 'PUBLIC_WEB'),
    verticalEligibleForSurface(vertical, 'SEARCH_INDEX'),
  ]);
  return { publicWeb, searchIndex };
}

function renderedEntityIdentity(entity: Entity): string {
  return JSON.stringify([
    entity.id,
    entity.entity_type,
    entity.canonical_name,
    entity.canonical_slug,
    entity.quality_score,
    entity.last_verified_at,
    entity.updated_at,
  ]);
}

export function sameRenderedEntityIdentity(left: Entity, right: Entity): boolean {
  return renderedEntityIdentity(left) === renderedEntityIdentity(right);
}

function renderedAttribution(attribution: NonNullable<SurfaceFactExplanation['selected']>['attributions'][number]): string {
  return JSON.stringify([
    attribution.publisher,
    attribution.domain,
    attribution.source_type,
    attribution.locator,
    attribution.artifact_url,
  ]);
}

function renderedFact(fact: CanonicalFactView): string {
  return JSON.stringify([
    fact.property,
    fact.fact_id,
    fact.value,
    fact.value_type,
    fact.unit,
    fact.reason,
    fact.unresolved_conflict,
  ]);
}

function explanationCoversRenderedContent(
  publicExplanation: SurfaceFactExplanation | null,
  indexExplanation: SurfaceFactExplanation | null,
  fact: CanonicalFactView,
): boolean {
  if (publicExplanation === null) return indexExplanation === null;
  if (indexExplanation === null) return false;
  if (publicExplanation.reason !== indexExplanation.reason) return false;
  if (publicExplanation.selected?.fact_id !== fact.fact_id) return false;
  if (indexExplanation.selected?.fact_id !== fact.fact_id) return false;

  const indexAttributions = new Set(
    (indexExplanation.selected?.attributions ?? []).map(renderedAttribution),
  );
  return (publicExplanation.selected?.attributions ?? []).every((attribution) =>
    indexAttributions.has(renderedAttribution(attribution)),
  );
}

function renderedEdge(edge: RelationshipEdge): string {
  return JSON.stringify([
    edge.relationship.id,
    edge.relationship.predicate,
    edge.direction,
    edge.from_entity_id,
    edge.neighbor.id,
    edge.neighbor.entity_type,
    edge.neighbor.canonical_name,
    edge.neighbor.canonical_slug,
    edge.evidence_count,
  ]);
}

export function relationshipTraversalEquivalent(
  publicTraversal: RelationshipTraversal,
  indexTraversal: RelationshipTraversal,
  requireSameSet = false,
): boolean {
  if (publicTraversal.truncated || indexTraversal.truncated) return false;
  const publicEdges = new Set(publicTraversal.edges.map(renderedEdge));
  const indexEdges = new Set(indexTraversal.edges.map(renderedEdge));
  if ([...publicEdges].some((edge) => !indexEdges.has(edge))) return false;
  return !requireSameSet || [...indexEdges].every((edge) => publicEdges.has(edge));
}

export interface EntityContentIntersection {
  readonly publicFacts: readonly CanonicalFactView[];
  readonly publicExplanations: readonly (SurfaceFactExplanation | null)[];
  readonly publicTraversal: RelationshipTraversal;
  readonly indexFacts: readonly CanonicalFactView[];
  readonly indexTraversal: RelationshipTraversal;
  readonly searchIndexCoversRenderedContent: boolean;
}

/**
 * Load the exact claims an entity page renders and prove SEARCH_INDEX can see
 * those same claims, explanations, attributions, and relationship edges.
 */
export async function loadEntityContentIntersection(
  vertical: VerticalDeployment,
  entity: Entity,
  relationshipQuery: Omit<TraversalQuery, 'entity_id'> = {
    direction: 'both',
    depth: 1,
    limit: 50,
  },
): Promise<EntityContentIntersection> {
  const traversalQuery: TraversalQuery = {
    entity_id: entity.id,
    ...relationshipQuery,
  };
  const [publicFacts, publicTraversal, indexView, indexFacts, indexTraversal] =
    await Promise.all([
      vertical.publicQueryModel.canonicalFacts(entity.id),
      vertical.publicQueryModel.relationships(traversalQuery),
      vertical.searchIndexQueryModel.getEntity(entity.id),
      vertical.searchIndexQueryModel.canonicalFacts(entity.id),
      vertical.searchIndexQueryModel.relationships(traversalQuery),
    ]);

  const publicPublished = publicFacts.filter((fact) => fact.fact_id !== null);
  const indexPublished = indexFacts.filter((fact) => fact.fact_id !== null);
  const [publicExplanations, indexExplanations] = await Promise.all([
    mapWithConcurrency(publicPublished, DEFAULT_CONCURRENCY, (fact) =>
      vertical.publicQueryModel.explainFact(entity.id, fact.property),
    ),
    mapWithConcurrency(publicPublished, DEFAULT_CONCURRENCY, (fact) =>
      vertical.searchIndexQueryModel.explainFact(entity.id, fact.property),
    ),
  ]);

  const indexFactsByProperty = new Map(indexPublished.map((fact) => [fact.property, fact]));
  const factsCovered = publicPublished.every((fact, index) => {
    const indexFact = indexFactsByProperty.get(fact.property);
    return (
      indexFact !== undefined &&
      renderedFact(indexFact) === renderedFact(fact) &&
      explanationCoversRenderedContent(
        publicExplanations[index] ?? null,
        indexExplanations[index] ?? null,
        fact,
      )
    );
  });
  const entityCovered =
    indexView !== null && sameRenderedEntityIdentity(indexView.entity, entity);

  return {
    publicFacts,
    publicExplanations,
    publicTraversal,
    indexFacts,
    indexTraversal,
    searchIndexCoversRenderedContent:
      entityCovered &&
      factsCovered &&
      relationshipTraversalEquivalent(publicTraversal, indexTraversal),
  };
}

async function allSurfaceEntityIdentities(
  model: SurfaceQueryModel,
  vertical: VerticalDeployment,
): Promise<ReadonlySet<string> | null> {
  const identities = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const result = await model.search({
      vertical_id: vertical.verticalId,
      limit: SEARCH_PAGE_SIZE,
      offset,
    });
    if (result.offset !== offset || (result.hits.length === 0 && offset < result.total)) {
      return null;
    }
    for (const hit of result.hits) {
      identities.add(JSON.stringify([hit.entity.id, hit.entity.entity_type]));
    }
    total = result.total;
    if (result.hits.length === 0) break;
    offset += result.hits.length;
  }
  return identities;
}

/** Dataset counts are indexable only when both surfaces cover the same entities. */
export async function datasetRenderedCountsCovered(
  vertical: VerticalDeployment,
): Promise<boolean> {
  const [publicEntities, indexEntities] = await Promise.all([
    allSurfaceEntityIdentities(vertical.publicQueryModel, vertical),
    allSurfaceEntityIdentities(vertical.searchIndexQueryModel, vertical),
  ]);
  if (publicEntities === null || indexEntities === null) return false;
  return (
    publicEntities.size === indexEntities.size &&
    [...publicEntities].every((identity) => indexEntities.has(identity))
  );
}
