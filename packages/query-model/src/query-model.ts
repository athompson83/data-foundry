/**
 * The canonical query layer (AGENTS.md rule 5).
 *
 * Web pages, the REST API and the MCP server all consume this object and
 * nothing below it. That is the whole contract: interfaces are interfaces, and
 * business logic — selection, redirect following, exact-before-fuzzy ordering,
 * facet derivation — lives here exactly once. If a consumer needs behaviour
 * this object does not expose, the fix is to add it here, not to reach past it
 * into the store or into SQL.
 */
import type { CanonicalStore, FactSelectionPolicyInput, SqlDriver } from '@data-foundry/canonical-store';
import {
  explainEntity,
  explainFact,
  provenanceCoverage,
  type FactExplanation,
  type ProvenanceCoverageOptions,
  type ProvenanceCoverageReport,
} from '@data-foundry/provenance';
import type { EntityId, Identifier, Slug, VerticalId } from '@data-foundry/canonical-schema';
import {
  FieldMetadataRegistry,
  type FacetResult,
  type FieldMetadataInput,
} from './field-metadata.js';
import { computeFacets, type FacetQuery } from './filters.js';
import {
  getEntityById,
  getEntityBySlug,
  lookupByIdentifier,
  type EntityView,
  type IdentifierLookup,
} from './entities.js';
import {
  canonicalFacts,
  listFactsWithEvidence,
  type CanonicalFactView,
  type FactWithEvidence,
  type ListFactsQuery,
} from './facts.js';
import { searchEntities, type SearchQuery, type SearchResult } from './search.js';
import { traverseRelationships, type RelationshipTraversal, type TraversalQuery } from './relationships.js';
import { compareEntities, type CompareQuery, type EntityComparison } from './compare.js';
import {
  createSurfaceQueryModel,
  createSurfaceQueryModelForSnapshot,
  withSurfaceStoreSnapshot,
  type SurfaceAccessOptions,
  type SurfaceQueryModel,
} from './surface-access.js';
import type { RightsSurface } from '@data-foundry/rights-engine';

declare const surfaceReadSnapshotBrand: unique symbol;

/**
 * An opaque capability proving that a caller is inside one request-wide,
 * read-only surface snapshot. Runtime state is held only in this module's
 * WeakMap; the token carries no driver, store, or surface-selection API.
 */
export interface SurfaceReadSnapshot {
  readonly [surfaceReadSnapshotBrand]: true;
}

interface SurfaceReadSnapshotState {
  readonly ownerStore: CanonicalStore;
  readonly snapshotStore: CanonicalStore;
  readonly assertActive: () => void;
}

const surfaceReadSnapshots = new WeakMap<SurfaceReadSnapshot, SurfaceReadSnapshotState>();

export interface QueryModelOptions {
  /**
   * Field metadata for the vertical(s) this instance serves. Facets, filters,
   * sorting and search boosts are derived from it; an empty registry simply
   * means no faceting is available, never a hard-coded fallback.
   */
  readonly fields?: readonly FieldMetadataInput[] | FieldMetadataRegistry;
}

/**
 * The read facade web, REST, MCP and exports consume (AGENTS.md rule 5).
 *
 * SECURITY BOUNDARY: this object deliberately exposes NO `driver` and NO
 * `store`. It previously carried both, which handed every future request
 * handler unrestricted SQL — including writes — against the canonical
 * database, bypassing the rule-2 evidence invariant (enforced in
 * `appendFactWithEvidence`, not in SQL), append-only fact versioning, and the
 * publish gate. The store and driver are captured in the closure below so
 * internal reads still work while no property leads back to raw SQL.
 *
 * Trusted infrastructure that genuinely needs raw access (the ingest worker,
 * provenance) receives a `CanonicalStore` by dependency injection at the
 * composition root instead of reaching through this facade.
 *
 * The boundary is asserted structurally in `test/driver-boundary.test.ts` —
 * any property that quacks like a driver fails, so a rename cannot restore it.
 */
export interface QueryModel {
  readonly fields: FieldMetadataRegistry;

  /** Run all explicitly bound surface reads on one physical database snapshot. */
  withSurfaceSnapshot<T>(
    run: (snapshot: SurfaceReadSnapshot) => Promise<T>,
  ): Promise<T>;

  /** Bind immutable, trusted per-request distribution rights to every read. */
  forSurface(
    surface: RightsSurface,
    options?: SurfaceAccessOptions,
    snapshot?: SurfaceReadSnapshot,
  ): SurfaceQueryModel;

  getEntity(id: EntityId): Promise<EntityView | null>;
  getEntityBySlug(
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<EntityView | null>;
  lookupIdentifier(lookup: IdentifierLookup): ReturnType<typeof lookupByIdentifier>;

  search(query: SearchQuery): Promise<SearchResult>;
  facets(query: FacetQuery): Promise<FacetResult[]>;

  facts(query: ListFactsQuery): Promise<FactWithEvidence[]>;
  canonicalFacts(
    entityId: EntityId,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<CanonicalFactView[]>;
  explainFact(
    entityId: EntityId,
    property: Identifier,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<FactExplanation | null>;
  explainEntity(
    entityId: EntityId,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<Map<Identifier, FactExplanation>>;

  relationships(query: TraversalQuery): Promise<RelationshipTraversal>;
  compare(query: CompareQuery): Promise<EntityComparison>;

  provenanceCoverage(options?: ProvenanceCoverageOptions): Promise<ProvenanceCoverageReport>;
}

export function createQueryModel(
  store: CanonicalStore,
  options: QueryModelOptions = {},
): QueryModel {
  const fields =
    options.fields instanceof FieldMetadataRegistry
      ? options.fields
      : new FieldMetadataRegistry(options.fields ?? []);

  return {
    fields,

    withSurfaceSnapshot: (run) => withSurfaceStoreSnapshot(store, async (
      snapshotStore,
      assertActive,
    ) => {
      const snapshot = Object.freeze({}) as SurfaceReadSnapshot;
      surfaceReadSnapshots.set(snapshot, { ownerStore: store, snapshotStore, assertActive });
      try {
        return await run(snapshot);
      } finally {
        surfaceReadSnapshots.delete(snapshot);
      }
    }),

    forSurface: (surface, accessOptions = {}, snapshot) => {
      if (snapshot === undefined) {
        return createSurfaceQueryModel(store, fields, surface, accessOptions);
      }
      const state = surfaceReadSnapshots.get(snapshot);
      if (state === undefined || state.ownerStore !== store) {
        throw new Error('Surface read snapshot is invalid for this QueryModel.');
      }
      state.assertActive();
      return createSurfaceQueryModelForSnapshot(
        state.snapshotStore,
        fields,
        surface,
        accessOptions,
        state.assertActive,
      );
    },

    getEntity: (id) => getEntityById(store, id),
    getEntityBySlug: (verticalId, entityType, slug) =>
      getEntityBySlug(store, verticalId, entityType, slug),
    lookupIdentifier: (lookup) => lookupByIdentifier(store, lookup),

    search: (query) => searchEntities(store.driver, fields, query),
    facets: (query) => computeFacets(store.driver, fields, query),

    facts: (query) => listFactsWithEvidence(store, query),
    canonicalFacts: (entityId, policy = {}) => canonicalFacts(store, entityId, policy),
    explainFact: (entityId, property, policy = {}) =>
      explainFact(store, entityId, property, policy),
    explainEntity: (entityId, policy = {}) => explainEntity(store, entityId, policy),

    relationships: (query) => traverseRelationships(store, query),
    compare: (query) => compareEntities(store, fields, query),

    provenanceCoverage: (coverageOptions = {}) =>
      provenanceCoverage(store.driver, coverageOptions),
  };
}
