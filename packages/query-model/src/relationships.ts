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
  /**
   * Edges the walk reached and refused because NOTHING asserts them — no
   * evidence row at all (rule 2). The store will not write such a relationship,
   * so one can only exist where something bypassed it; the count is a
   * store-integrity signal, and in a healthy database it is 0.
   *
   * Reported rather than silently omitted, because "the graph holds nothing
   * here" is a stronger claim than "we hold something nothing vouches for", and
   * a caller cannot tell them apart without this. Reporting it discloses no
   * source, because an unevidenced edge has none.
   *
   * WHAT THIS DELIBERATELY DOES NOT COUNT is an edge refused on RIGHTS. That
   * asymmetry is the whole point, and it was learned the hard way: a per-query
   * count of rights-refused edges is a disclosure oracle. `predicate` and
   * `direction` are chosen by the caller, so the count is a yes/no answer about
   * any triple they care to name. Sweeping the predicate list against a subject
   * and then the entity list against that predicate reconstructs the exact
   * (subject, predicate, object) a blocked source asserted — the claim rule 1
   * refused to publish, republished in unary. It was demonstrated end-to-end
   * against the REST surface before this was changed.
   *
   * So rule-1 refusals are silent, and the incompleteness is stated in the
   * route and tool contracts instead: an edge list from this layer is a view of
   * the publishable graph, and callers are told not to read it as the whole
   * graph. A contract a caller reads once cannot be differenced.
   *
   * Evidence is never optional, even when the deprecated coarse rights filter
   * is disabled in favor of a matrix gate. An unevidenced edge is always
   * refused and counted; the flag controls source-classification filtering,
   * not AGENTS.md rule 2.
   */
  readonly unevidenced_edge_count: number;
}

/** Trusted, request-scoped matrix gate supplied by a surface-bound QueryModel. */
export type RelationshipRightsGate = (relationship: Relationship) => Promise<boolean>;

const MAX_DEPTH = 4;
const MAX_EDGES = 500;

export async function traverseRelationships(
  store: CanonicalStore,
  query: TraversalQuery,
  rightsGate?: RelationshipRightsGate,
): Promise<RelationshipTraversal> {
  const depth = Math.max(1, Math.min(Math.trunc(query.depth ?? 1), MAX_DEPTH));
  const limit = Math.max(1, Math.min(Math.trunc(query.limit ?? MAX_EDGES), MAX_EDGES));
  const direction = query.direction ?? 'both';
  const requirePublishableRights =
    query.require_publishable_rights ?? DEFAULT_REQUIRE_PUBLISHABLE_RIGHTS;

  const edges: RelationshipEdge[] = [];
  let unevidenced = 0;
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

        const tally = counts.get(relationship.id) ?? { stored: 0, publishable: 0 };
        const evidenceCount = tally.publishable;

        // Rule 1 + rule 2: an edge nothing publishable vouches for is not a
        // claim this layer may serve, and it is not a hop this layer may take
        // either — reaching a node *through* a blocked edge would publish the
        // blocked claim as a path. The neighbour stays unvisited, so a
        // publishable edge to the same node later still finds it.
        //
        // Both refusals drop the edge; only one of them is counted. An edge
        // with no evidence at all names no source, so saying how many there
        // are gives nothing away. An edge refused on rights does name one, and
        // a per-query count of those is a differencing oracle for the very
        // claim the gate refused — see `unevidenced_edge_count`.
        if (tally.stored === 0) {
          unevidenced += 1;
          continue;
        }
        if (requirePublishableRights && evidenceCount === 0) {
          continue;
        }

        // Matrix refusals are intentionally silent for the same reason coarse
        // rights refusals are: a caller-controlled predicate/direction plus a
        // refusal count would be a differencing oracle for the hidden claim.
        // This check happens before the neighbor is loaded or visited, so a
        // blocked edge cannot be used as a traversal hop.
        if (rightsGate !== undefined && !(await rightsGate(relationship))) continue;

        const outgoing = relationship.subject_entity_id === current;
        const neighborId = outgoing ? relationship.object_entity_id : relationship.subject_entity_id;
        const neighbor = await store.getEntityById(neighborId);
        if (neighbor === null) continue;

        // Checked BEFORE the push, not after. Testing `edges.length >= limit`
        // once an edge is already in the array reports `truncated` for a walk
        // that served everything and had nothing left to serve — with exactly
        // `limit` publishable edges, the last successful push tripped it. REST
        // publishes that as `boundReached`, documented as "more edges exist",
        // so the old order made the surface say more edges existed when none
        // did. Here the flag is only set on an edge the bound actually stopped.
        if (edges.length >= limit) {
          truncated = true;
          break;
        }

        edges.push({
          relationship,
          direction: outgoing ? 'out' : 'in',
          from_entity_id: current,
          neighbor,
          depth: level,
          evidence_count: evidenceCount,
        });

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          next.push(neighborId);
        }
      }
      if (truncated) break;
    }
    frontier = next;
  }

  return { root: query.entity_id, edges, depth, truncated, unevidenced_edge_count: unevidenced };
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
interface EvidenceTally {
  /** Rows from any source at all, whatever its rights. */
  readonly stored: number;
  /** Rows from a source that may publish. Equals `stored` when the gate is off. */
  readonly publishable: number;
}

async function evidenceCounts(
  store: CanonicalStore,
  relationships: readonly Relationship[],
  requirePublishableRights: boolean,
): Promise<Map<string, EvidenceTally>> {
  const counts = new Map<string, EvidenceTally>();
  if (relationships.length === 0) return counts;
  const placeholders = relationships.map((_, index) => `$${index + 1}`).join(', ');
  const rows = await store.driver.query(
    `SELECT re.relationship_id, s.rights_classification, count(*)::text AS total
       FROM relationship_evidence re
       JOIN source_records sr ON sr.id = re.source_record_id
       JOIN sources s ON s.id = sr.source_id
      WHERE re.relationship_id IN (${placeholders})
        AND sr.is_current
        AND sr.revision_state = 'FINALIZED'
      GROUP BY re.relationship_id, s.rights_classification`,
    relationships.map((relationship) => relationship.id),
  );
  for (const row of rows) {
    const rights = String(row['rights_classification']) as RightsClassification;
    const id = String(row['relationship_id']);
    const total = Number(row['total'] ?? 0);
    const usable = requirePublishableRights ? canPublish(rights) : true;
    const running = counts.get(id) ?? { stored: 0, publishable: 0 };
    counts.set(id, {
      stored: running.stored + total,
      publishable: running.publishable + (usable ? total : 0),
    });
  }
  if (requirePublishableRights) {
    for (const [id, tally] of counts) {
      // A relationship is one combined claim. Every evidence contribution must
      // authorize the intent; an allowed row never launders a blocked neighbor.
      if (tally.publishable !== tally.stored) {
        counts.set(id, { stored: tally.stored, publishable: 0 });
      }
    }
  }
  return counts;
}
