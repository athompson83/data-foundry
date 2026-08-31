/**
 * `@data-foundry/query-model`
 *
 * The single canonical query layer. Web pages, the REST API and the MCP server
 * read through this package and nothing beneath it (AGENTS.md rule 5), so the
 * three surfaces cannot drift apart in what they consider true.
 *
 * Two things it will not do:
 *
 *   * It will not let text similarity outrank an exact identifier. Exact
 *     matching is a separate tier evaluated before ranking, not a bonus added
 *     to a score (rule 7).
 *   * It will not hard-code a vertical. Facets, filters, sorting and search
 *     boosts are derived from doc 04 field metadata, so a new vertical is a
 *     configuration change (rule 4).
 *
 * There is no vector search here, deliberately (doc 02).
 */

export {
  FILTER_CONTROL_TYPES,
  MAX_FACET_FILTERS,
  MAX_FACET_FILTER_VALUES,
  FieldFilterSchema,
  FieldMetadataRegistry,
  FieldMetadataSchema,
  FilterControlTypeSchema,
  UnknownFieldError,
  isNumericValueType,
  type FacetFilter,
  type FacetResult,
  type FacetValueCount,
  type FieldFilter,
  type FieldMetadata,
  type FieldMetadataInput,
  type FilterControlType,
} from './field-metadata.js';

export {
  Params,
  collapseIdentifier,
  collapseIdentifierUpper,
  identifierCandidates,
  likePattern,
  slugifyIdentifier,
} from './sql.js';

export {
  CORRECTION_FIELDS_JSON_SCHEMA,
  MIN_IDENTITY_FRAGMENT,
  ReviewerIdentityLeak,
  assertNoReviewerIdentity,
  reviewerIdentityTokens,
  correctionFields,
  correctionInvariantViolation,
  toExportRow,
  toMcpFact,
  toRestFact,
  type ExportFactRow,
  type RestFact,
  type WireCorrectionFields,
} from './serialization.js';

export {
  computeFacets,
  facetFilterPredicate,
  facetFilterPredicates,
  type FacetQuery,
} from './filters.js';

export {
  getEntityById,
  getEntityBySlug,
  lookupByIdentifier,
  type EntityView,
  type IdentifierLookup,
  type RedirectTrace,
} from './entities.js';

export {
  SEARCH_MATCH_KINDS,
  lookupExactIdentifier,
  searchEntities,
  type SearchHit,
  type SearchMatchKind,
  type SearchQuery,
  type SearchResult,
} from './search.js';

export {
  canonicalFacts,
  listFactsWithEvidence,
  type CanonicalFactView,
  type FactWithEvidence,
  type ListFactsQuery,
} from './facts.js';

export {
  traverseRelationships,
  type RelationshipRightsGate,
  type RelationshipEdge,
  type RelationshipTraversal,
  type TraversalDirection,
  type TraversalQuery,
} from './relationships.js';

export {
  compareEntities,
  type ComparisonAccess,
  type ComparisonCell,
  type ComparisonRow,
  type CompareQuery,
  type EntityComparison,
} from './compare.js';

export {
  createQueryModel,
  type QueryModel,
  type QueryModelOptions,
} from './query-model.js';

export {
  MAX_SURFACE_CATALOG_ENTITY_CANDIDATES,
  MAX_SURFACE_CATALOG_FACT_CANDIDATES,
  MAX_SURFACE_AUTHORIZATION_ROWS,
  MAX_SURFACE_FACT_DEPENDENCY_NODES,
  MAX_SURFACE_FACT_DEPENDENCY_EDGES,
  MAX_SURFACE_FACT_DEPENDENCY_DEPTH,
  SurfaceCatalogCapacityError,
  createSurfaceQueryModel,
  type SurfaceClaimAttribution,
  type SurfaceClaimSummary,
  type SurfaceFactExplanation,
  type SurfaceAccessOptions,
  type SurfaceCatalogCapacityResource,
  type SurfaceEntityListPage,
  type SurfaceEntityListQuery,
  type SurfaceQueryModel,
} from './surface-access.js';
export { RIGHTS_SURFACES, type RightsSurface } from '@data-foundry/rights-engine';

export {
  runtimeSchema,
  type RuntimeSchemaOutput,
} from './runtime-schema.js';
