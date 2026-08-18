/**
 * Graph traversal over canonical relationships.
 *
 * Bounded, breadth-first and cycle-guarded. Depth is capped because doc 18's
 * scope control rules out a dedicated graph database for the MVP: if a traversal
 * needs unbounded depth, that is a signal to revisit the architecture, not to
 * quietly issue an unbounded recursive query against the operational store.
 */
import type { CanonicalStore } from '@data-foundry/canonical-store';
import type { Entity, EntityId, Identifier, Relationship } from '@data-foundry/canonical-schema';

export type TraversalDirection = 'out' | 'in' | 'both';

export interface RelationshipEdge {
  readonly relationship: Relationship;
  readonly direction: 'out' | 'in';
  readonly from_entity_id: EntityId;
  readonly neighbor: Entity;
  readonly depth: number;
  readonly evidence_count: number;
}

export interface TraversalQuery {
  readonly entity_id: EntityId;
  readonly predicate?: Identifier;
  readonly direction?: TraversalDirection;
  /** 1–4. Defaults to 1. */
  readonly depth?: number;
  readonly limit?: number;
}

export interface RelationshipTraversal {
  readonly root: EntityId;
  readonly edges: readonly RelationshipEdge[];
  readonly depth: number;
  readonly truncated: boolean;
}

const MAX_DEPTH = 4;
const MAX_EDGES = 500;

export async function traverseRelationships(
  store: CanonicalStore,
  query: TraversalQuery,
): Promise<RelationshipTraversal> {
  const depth = Math.max(1, Math.min(Math.trunc(query.depth ?? 1), MAX_DEPTH));
  const limit = Math.max(1, Math.min(Math.trunc(query.limit ?? MAX_EDGES), MAX_EDGES));
  const direction = query.direction ?? 'both';

  const edges: RelationshipEdge[] = [];
  const visited = new Set<string>([query.entity_id]);
  const seenEdges = new Set<string>();
  let frontier: EntityId[] = [query.entity_id];
  let truncated = false;

  for (let level = 1; level <= depth && frontier.length > 0 && !truncated; level += 1) {
    const next: EntityId[] = [];

    for (const current of frontier) {
      const relationships = await store.listRelationships(current, {
        ...(query.predicate === undefined ? {} : { predicate: query.predicate }),
        direction,
      });
      const counts = await evidenceCounts(store, relationships);

      for (const relationship of relationships) {
        if (seenEdges.has(relationship.id)) continue;
        seenEdges.add(relationship.id);

        const outgoing = relationship.subject_entity_id === current;
        const neighborId = outgoing ? relationship.object_entity_id : relationship.subject_entity_id;
        const neighbor = await store.getEntityById(neighborId);
        if (neighbor === null) continue;

        edges.push({
          relationship,
          direction: outgoing ? 'out' : 'in',
          from_entity_id: current,
          neighbor,
          depth: level,
          evidence_count: counts.get(relationship.id) ?? 0,
        });

        if (edges.length >= limit) {
          truncated = true;
          break;
        }
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          next.push(neighborId);
        }
      }
      if (truncated) break;
    }
    frontier = next;
  }

  return { root: query.entity_id, edges, depth, truncated };
}

async function evidenceCounts(
  store: CanonicalStore,
  relationships: readonly Relationship[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (relationships.length === 0) return counts;
  const placeholders = relationships.map((_, index) => `$${index + 1}`).join(', ');
  const rows = await store.driver.query(
    `SELECT relationship_id, count(*)::text AS total
       FROM relationship_evidence
      WHERE relationship_id IN (${placeholders})
      GROUP BY relationship_id`,
    relationships.map((relationship) => relationship.id),
  );
  for (const row of rows) {
    counts.set(String(row['relationship_id']), Number(row['total'] ?? 0));
  }
  return counts;
}
