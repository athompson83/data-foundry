/**
 * Graph traversal over canonical relationships.
 *
 * Bounded, breadth-first and cycle-guarded. Depth is capped because doc 18's
 * scope control rules out a dedicated graph database for the MVP: if a traversal
 * needs unbounded depth, that is a signal to revisit the architecture, not to
 * quietly issue an unbounded recursive query against the operational store.
 *
 * AGENTS.md rule 1 applies here exactly as it applies to facts. An edge is a
 * published claim — "this model replaces that one" — and it is evidenced the
 * same way a fact is, through `relationship_evidence` to an artifact and a
 * source. Serving an edge that only a RED or UNREVIEWED source vouches for
 * publishes that source's claim, so traversal filters evidence by the same
 * predicate fact selection uses (`canPublish`) under the same flag, with the
 * same fail-closed default. There is one rule-1 predicate in this codebase and
 * this file does not add a second.
 */
import {
  DEFAULT_REQUIRE_PUBLISHABLE_RIGHTS,
  type CanonicalStore,
} from '@data-foundry/canonical-store';
import { canPublish } from '@data-foundry/canonical-schema';
import type {
  Entity,
  EntityId,
  Identifier,
  Relationship,
  RightsClassification,
} from '@data-foundry/canonical-schema';

export type TraversalDirection = 'out' | 'in' | 'both';

export interface RelationshipEdge {
  readonly relationship: Relationship;
  readonly direction: 'out' | 'in';
  readonly from_entity_id: EntityId;
  readonly neighbor: Entity;
  readonly depth: number;
  /**
   * How many evidence rows the caller is entitled to see behind this edge.
   *
   * Under the default (`require_publishable_rights`), rows whose source may not
   * publish are not counted: an edge that advertises evidence a consumer can
   * never be shown is its own kind of misstatement, and a count that includes
   * blocked rows would let a caller infer the existence of a source rule 1 says
   * must not publish. With the flag off it is the raw count, matching what the
   * caller can then actually retrieve.
   */
  readonly evidence_count: number;
}

export interface TraversalQuery {
  readonly entity_id: EntityId;
  readonly predicate?: Identifier;
  readonly direction?: TraversalDirection;
  /** 1–4. Defaults to 1. */
  readonly depth?: number;
  readonly limit?: number;
  /**
   * AGENTS.md rule 1: exclude evidence whose source may not publish, and with
   * it any edge left with no evidence at all. Defaults to
   * `DEFAULT_REQUIRE_PUBLISHABLE_RIGHTS` — the same fail-closed default
   * `resolveFactSelectionPolicy` applies to `policy.requirePublishableRights`,
   * read from the same constant so the two cannot drift.
   *
   * It lives on the query rather than arriving as a `FactSelectionPolicyInput`
   * because a traversal has no use for the rest of that policy (`at`,
   * `fieldReliability`, `editorialOverrides`, and `consistencyChecks`, which
   * carries functions and is therefore not serializable). `TraversalQuery` is a
   * plain data object that REST and MCP build straight from a request, and this
   * flag has to survive that trip; a fact-selection policy does not.
   *
   * Set it false only for internal analysis that is not publishing what it
   * reads — the same escape hatch, and the same responsibility, as the fact
   * selection flag it mirrors.
   */
  readonly require_publishable_rights?: boolean;
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
  const requirePublishableRights =
    query.require_publishable_rights ?? DEFAULT_REQUIRE_PUBLISHABLE_RIGHTS;

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
      const counts = await evidenceCounts(store, relationships, requirePublishableRights);

      for (const relationship of relationships) {
        if (seenEdges.has(relationship.id)) continue;
        seenEdges.add(relationship.id);

        const evidenceCount = counts.get(relationship.id) ?? 0;
        // Rule 1 + rule 2: an edge nothing publishable vouches for is not a
        // claim this layer may serve, and it is not a hop this layer may take
        // either — reaching a node *through* a blocked edge would publish the
        // blocked claim as a path. The neighbour stays unvisited, so a
        // publishable edge to the same node later still finds it.
        if (requirePublishableRights && evidenceCount === 0) continue;

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
          evidence_count: evidenceCount,
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

/**
 * Evidence rows per relationship, split by the rights classification of the
 * source that supplied them.
 *
 * The join to `sources` runs `relationship_evidence → source_records → sources`,
 * the same path `loadEvidenceChains` takes for fact evidence; both columns are
 * `NOT NULL` with restricting foreign keys (`0005_relationships.sql`), so the
 * inner join drops nothing.
 *
 * The rights decision is deliberately NOT made in SQL. `canPublish` is the one
 * place that knows RED and UNREVIEWED cannot publish and that AMBER can, and a
 * `WHERE rights_classification = 'GREEN'` here would silently disagree with it
 * and refuse every AMBER source. Grouping by classification and letting the
 * shared predicate decide keeps a single rule.
 */
async function evidenceCounts(
  store: CanonicalStore,
  relationships: readonly Relationship[],
  requirePublishableRights: boolean,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (relationships.length === 0) return counts;
  const placeholders = relationships.map((_, index) => `$${index + 1}`).join(', ');
  const rows = await store.driver.query(
    `SELECT re.relationship_id, s.rights_classification, count(*)::text AS total
       FROM relationship_evidence re
       JOIN source_records sr ON sr.id = re.source_record_id
       JOIN sources s ON s.id = sr.source_id
      WHERE re.relationship_id IN (${placeholders})
      GROUP BY re.relationship_id, s.rights_classification`,
    relationships.map((relationship) => relationship.id),
  );
  for (const row of rows) {
    const rights = String(row['rights_classification']) as RightsClassification;
    if (requirePublishableRights && !canPublish(rights)) continue;
    const id = String(row['relationship_id']);
    counts.set(id, (counts.get(id) ?? 0) + Number(row['total'] ?? 0));
  }
  return counts;
}
