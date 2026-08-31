/**
 * The single seam between `apps/mcp` and the rest of the platform.
 *
 * AGENTS.md rule 5: "Web/API/MCP must read from the same canonical query
 * layer." This module is how that is made structural rather than aspirational —
 * it is the ONLY file in this app allowed to name anything outside it, and it
 * names exactly one thing: `@data-foundry/query-model`. Every other module
 * imports from here. A future contributor reaching for `canonical-store`, for a
 * SQL string or for `pg` has to edit this file to do it, and
 * `test/query-layer-boundary.test.ts` fails when they do.
 *
 * IT IS THE PACKAGE SPECIFIER, NOT A RELATIVE PATH. It used to be a relative
 * path up out of the app and into the query layer's source tree, because this
 * app was built alongside sibling surfaces sharing one lockfile and an importer
 * entry conflicted destructively. That constraint is gone, and a relative path was
 * never the dependency — it was a way of having one without declaring it, so
 * `package.json` did not state the app's contract and nothing outside this
 * exact directory layout could resolve it. `@data-foundry/query-model` is now a
 * declared `workspace:*` dependency and the boundary test permits that
 * specifier and no other bare one.
 *
 * WHAT IS DELIBERATELY NOT RE-EXPORTED: `QueryModel` exposes no `driver` and no
 * `store` — that is a security boundary, not an oversight (see
 * `packages/query-model/src/query-model.ts`). Nothing here restores one.
 */

export {
  UnknownFieldError,
  assertNoReviewerIdentity,
  correctionFields,
  identifierCandidates,
  reviewerIdentityTokens,
  toMcpFact,
  CORRECTION_FIELDS_JSON_SCHEMA,
  ReviewerIdentityLeak,
  SEARCH_MATCH_KINDS,
  MAX_FACET_FILTERS,
  MAX_FACET_FILTER_VALUES,
  SurfaceCatalogCapacityError,
  type CanonicalFactView,
  type EntityComparison,
  type EntityView,
  type FacetFilter,
  type FacetResult,
  type QueryModel,
  type RelationshipEdge,
  type RelationshipTraversal,
  type RestFact,
  type SearchHit,
  type SearchMatchKind,
  type SearchResult,
  type SurfaceFactExplanation,
  type SurfaceQueryModel,
  type TraversalDirection,
  type WireCorrectionFields,
} from '@data-foundry/query-model';

import type {
  EntityView,
  QueryModel,
  SurfaceFactExplanation,
  SurfaceQueryModel,
} from '@data-foundry/query-model';

/**
 * Branded ids and vertical-defined identifiers, derived from what the query
 * layer's own signatures accept.
 *
 * They could be imported from `@data-foundry/canonical-schema`, one level
 * beneath the query layer. Deriving them instead means this app's type surface
 * is defined by exactly one thing: what the canonical query layer will accept
 * and return. There is no second definition to drift, and no import below the
 * layer rule 5 designates.
 */
export type EntityId = Parameters<QueryModel['getEntity']>[0];
export type VerticalId = Parameters<QueryModel['getEntityBySlug']>[0];
export type Identifier = Parameters<QueryModel['getEntityBySlug']>[1];
export type Slug = Parameters<QueryModel['getEntityBySlug']>[2];

export type Entity = EntityView['entity'];
export type EntityStatus = Entity['status'];
export type IsoDateTime = Entity['first_seen_at'];

export type SearchQuery = Parameters<QueryModel['search']>[0];
export type TraversalQuery = Parameters<QueryModel['relationships']>[0];
export type CompareQuery = Parameters<QueryModel['compare']>[0];

/**
 * The fact-selection policy the server is configured with. Server-side
 * configuration only — see `src/server.ts` for why no part of it is reachable
 * from a tool argument.
 */
export type FactSelectionPolicy = NonNullable<Parameters<QueryModel['canonicalFacts']>[1]>;

/**
 * The internal/audit trust surface. `explainFact` carries the editorial
 * reviewer's IDENTITY; `CanonicalFactView` deliberately does not. Everything in
 * `src/guard.ts` exists because this type crosses into this app at all.
 */
export type FactExplanation = NonNullable<Awaited<ReturnType<QueryModel['explainFact']>>>;
/** Customer-safe explanation exposed by a rights-bound surface facade. */
export type CustomerFactExplanation = SurfaceFactExplanation;
export type CustomerQueryModel = SurfaceQueryModel;
export type ClaimSummary = FactExplanation['claims'][number];
export type ClaimAttribution = ClaimSummary['attributions'][number];
export type RetainedConflict = FactExplanation['conflicts'][number];
export type ExcludedCandidate = FactExplanation['excluded'][number];
export type FactSelectionStep = FactExplanation['steps'][number];
export type FactSelectionRule = FactExplanation['rule'];
