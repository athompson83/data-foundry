import {
  createCanonicalStore,
  ENTITY_COLUMNS,
  loadStoredRightsContext,
  mapEntity,
  selectCanonicalFact,
  type CandidateEvidence,
  type CanonicalStore,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicyInput,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  compareCodeUnits,
  type Entity,
  type EntityId,
  type EntityStatus,
  type Identifier,
  type IsoDateTime,
  type Relationship,
  type Slug,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import {
  authorizeSurface,
  evaluateRights,
  type RightsConditionReceipt,
  type RightsChannel,
  type RightsEvaluationOptions,
  type RightsOperation,
  type RightsOutputClass,
  type SurfaceRightsContribution,
  type RightsSurface,
} from '@data-foundry/rights-engine';
import type { FieldMetadataRegistry, FacetResult } from './field-metadata.js';
import { factLineage, type EvidenceChainLink } from '@data-foundry/provenance';
import { computeFacets, type FacetQuery } from './filters.js';
import {
  getEntityById,
  getEntityBySlug,
  lookupByIdentifier,
  type EntityView,
  type IdentifierLookup,
} from './entities.js';
import { canonicalFactView, type CanonicalFactView } from './facts.js';
import { searchEntities, type SearchQuery, type SearchResult } from './search.js';
import {
  traverseRelationships,
  type RelationshipTraversal,
  type TraversalQuery,
} from './relationships.js';
import { compareEntities, type CompareQuery, type EntityComparison } from './compare.js';

export interface SurfaceAccessOptions {
  /** Permission is evaluated when the response is produced, not at fact-validity time. */
  readonly asOf?: IsoDateTime;
  /** Trusted server-computed condition receipts; never populate from request input. */
  readonly conditionReceipts?: readonly RightsConditionReceipt[];
  readonly trustedConditionEvaluators?: readonly string[];
}

/**
 * One bounded raw-entity keyset scan. The continuation identifies the last
 * raw row inspected, which may itself be denied for this surface. That keeps
 * each call bounded even when an entire database page fails rights checks.
 */
export interface SurfaceEntityListQuery {
  readonly vertical_id: VerticalId;
  readonly entity_type?: Identifier;
  readonly statuses?: readonly EntityStatus[];
  readonly limit?: number;
  readonly after_id?: EntityId;
}

export interface SurfaceEntityListPage {
  readonly entities: readonly Entity[];
  readonly next_after_id: EntityId | null;
}

/**
 * Customer-safe subset of the canonical query layer. Audit/history reads are
 * intentionally absent: a surface cannot ask for raw facts, internal
 * explanations, or unrestricted provenance coverage and then filter them
 * after the disclosure has already occurred.
 */
export interface SurfaceQueryModel {
  readonly fields: FieldMetadataRegistry;
  readonly surface: RightsSurface;

  getEntity(id: EntityId): Promise<EntityView | null>;
  getEntityBySlug(
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<EntityView | null>;
  lookupIdentifier(lookup: IdentifierLookup): ReturnType<typeof lookupByIdentifier>;
  listEntities(query: SurfaceEntityListQuery): Promise<SurfaceEntityListPage>;
  search(query: SearchQuery): Promise<SearchResult>;
  facets(query: FacetQuery): Promise<FacetResult[]>;
  canonicalFacts(
    entityId: EntityId,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<CanonicalFactView[]>;
  explainFact(
    entityId: EntityId,
    property: Identifier,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<SurfaceFactExplanation | null>;
  relationships(query: TraversalQuery): Promise<RelationshipTraversal>;
  compare(query: CompareQuery): Promise<EntityComparison>;
}

/** An attribution already authorized for the bound customer surface. */
export interface SurfaceClaimAttribution {
  readonly publisher: string;
  readonly domain: string;
  readonly source_type: CandidateEvidence['source']['source_type'];
  readonly authority_rank: number;
  /** Exact source text is independently gated by QUOTE_OR_EXCERPT. */
  readonly source_value: string | null;
  readonly locator: string;
  readonly artifact_url: string;
  readonly retrieved_at: IsoDateTime;
  readonly observed_at: IsoDateTime;
}

export interface SurfaceClaimSummary {
  readonly fact_id: FactCandidate['fact']['id'];
  readonly value: FactCandidate['fact']['normalized_value'];
  readonly value_type: FactCandidate['fact']['value_type'];
  readonly unit: string | null;
  readonly status: FactCandidate['fact']['status'];
  readonly confidence: number;
  readonly selected: boolean;
  readonly attributions: readonly SurfaceClaimAttribution[];
}

/**
 * Customer-safe trust explanation. It intentionally has no raw exclusions,
 * reviewer identity, internal lineage object, or withheld counts: all four can
 * turn an ungranted neighboring claim into an oracle.
 */
export interface SurfaceFactExplanation {
  readonly entity: Pick<
    EntityView['entity'],
    'id' | 'entity_type' | 'canonical_name' | 'canonical_slug'
  >;
  readonly property: Identifier;
  readonly at: IsoDateTime;
  readonly selected: SurfaceClaimSummary | null;
  readonly rule: FactSelection['rule'];
  readonly reason: string;
  readonly steps: FactSelection['steps'];
  readonly claims: readonly SurfaceClaimSummary[];
  readonly conflicts: FactSelection['conflicts'];
  readonly unresolved_conflict: boolean;
  readonly editorially_corrected: boolean;
  readonly editorial_correction_reason: string | null;
  readonly selection_warnings: FactSelection['selection_warnings'];
  readonly narrative: readonly string[];
}

interface ArtifactContribution {
  readonly contributionId: string;
  readonly sourceId: string;
  readonly acquisitionRoute: NonNullable<CandidateEvidence['artifact']['acquisition_route']>;
  readonly accountOrProductPlan: string | null;
  readonly acquisitionJurisdiction: string | null;
}

interface EntityEvidenceRow extends SqlRow {
  readonly entity_id: string;
  readonly evidence_id: string | null;
  readonly source_id: string | null;
  readonly acquisition_route: string | null;
  readonly account_or_product_plan: string | null;
  readonly acquisition_jurisdiction: string | null;
}

interface BatchedEntityEvidenceRow extends EntityEvidenceRow {
  readonly identity_authority: boolean;
}

interface FactAuthorizationRow extends SqlRow {
  readonly fact_id: string;
  readonly property: string;
  readonly output_kind: string | null;
  readonly input_fact_id: string | null;
  readonly evidence_id: string | null;
  readonly source_id: string | null;
  readonly acquisition_route: string | null;
  readonly account_or_product_plan: string | null;
  readonly acquisition_jurisdiction: string | null;
}

interface FactAuthorizationRecord {
  readonly property: string;
  readonly outputKind: string | null;
  readonly dependencies: readonly string[];
  readonly contributions: readonly ArtifactContribution[] | null;
}

const nowIso = (): IsoDateTime => new Date().toISOString() as IsoDateTime;

/**
 * Bind canonical reads to the transaction connection that owns one immutable
 * surface snapshot. Nested store transactions reuse that connection; DDL and
 * connection ownership remain unavailable inside this read-only boundary.
 */
function snapshotDriver(
  base: SqlDriver,
  transaction: SqlTransactionExecutor,
): SqlDriver {
  return {
    label: `${base.label} (surface snapshot)`,
    dialect: base.dialect,
    capabilityCacheKey: base.capabilityCacheKey ?? base,
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]) {
      return transaction.query<R>(sql, params);
    },
    async exec() {
      throw new Error('surface snapshots do not execute DDL');
    },
    async transaction<T>(run: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      return run(transaction);
    },
    async close() {
      // The outer request owns the real driver and transaction lifecycle.
    },
  };
}

/**
 * Keep authorization and alias lookup on one PostgreSQL snapshot. Without
 * this boundary, a newly committed denied-source alias could appear between
 * the rights query and search SQL and disclose its association (CWE-367).
 */
function withSurfaceSnapshot<T>(
  store: CanonicalStore,
  run: (snapshotStore: CanonicalStore) => Promise<T>,
): Promise<T> {
  return store.driver.transaction(async (transaction) => {
    await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const driver = snapshotDriver(store.driver, transaction);
    return run(createCanonicalStore(driver));
  });
}

const SURFACE_CHANNEL = Object.freeze({
  PUBLIC_WEB: 'PUBLIC_WEBSITE',
  SEARCH_INDEX: 'SEARCH_INDEX',
  API_FREE: 'DIRECT_CUSTOMER_API',
  API_PAID: 'DIRECT_CUSTOMER_API',
  RAPIDAPI: 'RAPIDAPI_MARKETPLACE',
  MCP: 'MCP_AGENT',
  BULK_EXPORT: 'BULK_DOWNLOAD',
  PARTNER_DELIVERY: 'PARTNER_DELIVERY',
  MODEL_TRAINING: 'MODEL_PIPELINE',
  MODEL_EVALUATION: 'MODEL_PIPELINE',
} satisfies Record<RightsSurface, RightsChannel>);

const SURFACE_ENTITY_SCAN_LIMIT = 200;

const boundedEntityScanLimit = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return SURFACE_ENTITY_SCAN_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), SURFACE_ENTITY_SCAN_LIMIT));
};

const locatorFor = (evidence: CandidateEvidence): string =>
  evidence.evidence.locator_type === 'WHOLE_DOCUMENT'
    ? 'whole document'
    : `${evidence.evidence.locator_type} ${evidence.evidence.locator_value}`;

/**
 * Direct evidence is rendered only when it was authoritative for this
 * candidate's selection instant. Recursive dependency evidence remains
 * immutable history: derived output authorization and attribution depend on
 * the exact input fact versions recorded by fact_dependencies.
 */
const surfaceLineageForCandidate = (
  candidate: FactCandidate,
  lineage: readonly EvidenceChainLink[],
): readonly EvidenceChainLink[] => {
  const directEvidenceIds = new Set(
    candidate.evidence.map((entry) => entry.evidence.id),
  );
  return lineage.filter(
    (link) =>
      !('fact_id' in link.evidence) ||
      link.evidence.fact_id !== candidate.fact.id ||
      directEvidenceIds.has(link.evidence.id),
  );
};

const summarizeSurfaceClaim = (
  candidate: FactCandidate,
  selectedId: FactCandidate['fact']['id'] | null,
  quoteAllowed: boolean,
  lineage: readonly EvidenceChainLink[],
): SurfaceClaimSummary => ({
  fact_id: candidate.fact.id,
  value: candidate.fact.normalized_value,
  value_type: candidate.fact.value_type,
  unit: candidate.fact.unit,
  status: candidate.fact.status,
  confidence: candidate.fact.confidence,
  selected: candidate.fact.id === selectedId,
  attributions: lineage.map((link) => ({
    publisher: link.source.publisher,
    domain: link.source.domain,
    source_type: link.source.source_type,
    authority_rank: link.source.authority_rank,
    source_value:
      quoteAllowed && 'fact_id' in link.evidence && link.evidence.fact_id === candidate.fact.id
        ? link.source_value
        : null,
    locator:
      link.locator.type === 'WHOLE_DOCUMENT'
        ? 'whole document'
        : `${link.locator.type} ${link.locator.value}`,
    artifact_url: link.artifact.url,
    retrieved_at: link.retrieved_at,
    observed_at: link.observed_at,
  })),
});

const renderValue = (value: FactCandidate['fact']['normalized_value'], unit: string | null): string => {
  const rendered = Array.isArray(value) ? value.join(', ') : String(value);
  return unit === null ? rendered : `${rendered} ${unit}`;
};

/** Render only the already-authorized candidate set; no exclusion oracle. */
const narrateSurfaceSelection = (
  selection: FactSelection,
  claims: readonly SurfaceClaimSummary[],
): readonly string[] => {
  const lines: string[] = [];
  for (const claim of claims) {
    for (const source of claim.attributions) {
      const excerpt =
        source.source_value === null
          ? ''
          : ` The source text reads "${source.source_value}".`;
      lines.push(
        `${source.publisher} (${source.domain}, ${source.source_type}, authority ` +
          `${source.authority_rank}) supports "${renderValue(claim.value, claim.unit)}" for ` +
          `${selection.property} at ${source.locator} in ${source.artifact_url}.` +
          excerpt,
      );
    }
  }

  if (selection.selected === null) {
    lines.push(`No value is available for ${selection.property} on this surface.`);
  } else {
    lines.push(
      `Published value for ${selection.property}: ` +
        `"${renderValue(selection.selected.fact.normalized_value, selection.selected.fact.unit)}" ` +
        `(rule ${selection.rule}). ${selection.reason}`,
    );
  }
  if (selection.selection_warnings.includes('AMBIGUOUS_EDITORIAL_INTENT')) {
    lines.push(
      'Editorial review conflict: multiple valid declarations proposed different values. ' +
        'No editorial correction was applied.',
    );
  }
  if (selection.editorial_correction !== null) {
    lines.push(
      `Editorially corrected: ${selection.editorial_correction.reason}`,
    );
  }
  for (const conflict of selection.conflicts) {
    const publishers = conflict.claimed_by.map((source) => source.publisher).join(', ');
    lines.push(
      `Unresolved conflict retained: "${renderValue(conflict.value, conflict.unit)}" is still ` +
        `claimed by ${publishers}.`,
    );
  }
  return lines;
};

const intersect = <T>(
  authorized: readonly T[],
  requested: readonly T[] | undefined,
): readonly T[] => {
  if (requested === undefined) return authorized;
  const wanted = new Set(requested);
  return authorized.filter((value) => wanted.has(value));
};

const contributionFromEvidence = (evidence: CandidateEvidence): ArtifactContribution | null => {
  const route = evidence.artifact.acquisition_route;
  // A legacy artifact with unknown acquisition scope must not match a broad
  // grant. Unknown provenance is refusal, even when the terms cell itself is
  // intentionally route-agnostic.
  if (route === null) return null;
  return {
    contributionId: evidence.evidence.id,
    sourceId: evidence.source.source_id,
    acquisitionRoute: route,
    accountOrProductPlan: evidence.artifact.account_or_product_plan,
    acquisitionJurisdiction: evidence.artifact.acquisition_jurisdiction,
  };
};

const contributionFromEntityRow = (row: EntityEvidenceRow): ArtifactContribution | null => {
  if (
    row.evidence_id === null ||
    row.source_id === null ||
    row.acquisition_route === null
  ) {
    return null;
  }
  return {
    contributionId: row.evidence_id,
    sourceId: row.source_id,
    acquisitionRoute: row.acquisition_route as ArtifactContribution['acquisitionRoute'],
    accountOrProductPlan: row.account_or_product_plan,
    acquisitionJurisdiction: row.acquisition_jurisdiction,
  };
};

class SurfaceRightsAuthorizer {
  readonly #store: CanonicalStore;
  readonly #surface: RightsSurface;
  readonly #asOf: IsoDateTime;
  readonly #conditionReceipts: readonly RightsConditionReceipt[];
  readonly #evaluationOptions: RightsEvaluationOptions;
  readonly #contexts = new Map<string, ReturnType<typeof loadStoredRightsContext>>();
  readonly #entityResults = new Map<string, Promise<boolean>>();
  readonly #factResults = new Map<string, Promise<boolean>>();
  readonly #relationshipResults = new Map<string, Promise<boolean>>();
  readonly #visibleEntities = new Map<string, Promise<readonly EntityId[]>>();
  readonly #visibleFacts = new Map<string, Promise<readonly string[]>>();

  constructor(
    store: CanonicalStore,
    surface: RightsSurface,
    options: SurfaceAccessOptions,
  ) {
    this.#store = store;
    this.#surface = surface;
    this.#asOf = options.asOf ?? nowIso();
    this.#conditionReceipts = options.conditionReceipts ?? [];
    this.#evaluationOptions = {
      trustedConditionEvaluators: options.trustedConditionEvaluators ?? [],
    };
  }

  #context(sourceId: string): ReturnType<typeof loadStoredRightsContext> {
    const cached = this.#contexts.get(sourceId);
    if (cached !== undefined) return cached;
    const loaded = loadStoredRightsContext(this.#store.driver, sourceId, this.#asOf);
    this.#contexts.set(sourceId, loaded);
    return loaded;
  }

  async #expandContributions(
    contributions: readonly ArtifactContribution[],
    fieldKey: string | null,
    outputClass: RightsOutputClass,
  ): Promise<readonly SurfaceRightsContribution[] | null> {
    if (contributions.length === 0) return null;
    const expanded: SurfaceRightsContribution[] = [];
    for (const contribution of contributions) {
      const stored = await this.#context(contribution.sourceId);
      if (stored === null) return null;
      const fieldGroupIds = [...(stored.snapshot.fieldGroupMembers ?? new Map()).entries()]
        .filter(([, members]) => fieldKey !== null && members.includes(fieldKey))
        .map(([id]) => id);
      expanded.push({
        contributionId: contribution.contributionId,
        request: {
          source: stored.source,
          sourceStatusRequirement: 'ACTIVE',
          acquisitionRoute: contribution.acquisitionRoute,
          accountOrProductPlan: contribution.accountOrProductPlan,
          jurisdiction: contribution.acquisitionJurisdiction,
          assetClass: 'DATA',
          fieldKey,
          fieldGroupIds,
          outputClass,
          asOf: this.#asOf,
          conditionReceipts: this.#conditionReceipts,
        },
        snapshot: stored.snapshot,
      });
    }
    return expanded;
  }

  async #authorizeContributions(
    contributions: readonly ArtifactContribution[],
    fieldKey: string | null,
    outputClass: RightsOutputClass,
    requireDerive = false,
  ): Promise<boolean> {
    const expanded = await this.#expandContributions(contributions, fieldKey, outputClass);
    if (expanded === null) return false;
    if (requireDerive) {
      for (const contribution of expanded) {
        if (
          !evaluateRights(
            {
              ...contribution.request,
              operation: 'DERIVE',
              channel: 'INTERNAL_PROCESSING',
            },
            contribution.snapshot,
            this.#evaluationOptions,
          ).permitted
        ) {
          return false;
        }
      }
    }
    return authorizeSurface(this.#surface, expanded, this.#evaluationOptions).permitted;
  }

  async #authorizeAdditionalOperation(
    contributions: readonly ArtifactContribution[],
    fieldKey: string | null,
    outputClass: RightsOutputClass,
    operation: RightsOperation,
  ): Promise<boolean> {
    const expanded = await this.#expandContributions(contributions, fieldKey, outputClass);
    if (expanded === null) return false;
    return expanded.every((contribution) =>
      evaluateRights(
        {
          ...contribution.request,
          operation,
          channel: SURFACE_CHANNEL[this.#surface],
        },
        contribution.snapshot,
        this.#evaluationOptions,
      ).permitted,
    );
  }

  async #authorizeDerivationContribution(
    contributions: readonly ArtifactContribution[],
    targetFieldKey: string,
  ): Promise<boolean> {
    const expanded = await this.#expandContributions(
      contributions,
      targetFieldKey,
      'DERIVED_METRIC',
    );
    if (expanded === null) return false;
    return expanded.every((contribution) =>
      evaluateRights(
        {
          ...contribution.request,
          operation: 'DERIVE',
          channel: 'INTERNAL_PROCESSING',
        },
        contribution.snapshot,
        this.#evaluationOptions,
      ).permitted,
    );
  }

  async #authorizeEntities(entityIds: readonly EntityId[]): Promise<readonly boolean[]> {
    const uniqueIds = [...new Set(entityIds)];
    const missing = uniqueIds.filter((id) => !this.#entityResults.has(id));
    if (missing.length > 0) {
      const batch = this.#loadEntityAuthorizationDecisions(missing);
      for (const id of missing) {
        this.#entityResults.set(id, batch.then((decisions) => decisions.get(id) ?? false));
      }
    }
    return Promise.all(
      entityIds.map((id) => this.#entityResults.get(id) ?? Promise.resolve(false)),
    );
  }

  /**
   * Load identity authority and every provenance contribution for a candidate
   * set in one statement. Rights evaluation remains in the pure engine, but a
   * catalog scan no longer turns each row into two more SQL round trips on the
   * request's pinned repeatable-read connection.
   */
  async #loadEntityAuthorizationDecisions(
    entityIds: readonly EntityId[],
  ): Promise<ReadonlyMap<EntityId, boolean>> {
    const rows = await this.#store.driver.query<BatchedEntityEvidenceRow>(
      `WITH requested(id) AS (
         SELECT value::uuid
           FROM jsonb_array_elements_text($1::jsonb) AS requested_id(value)
       )
       SELECT e.id AS entity_id,
              BOOL_OR(COALESCE(sr.is_current AND sr.revision_state = 'FINALIZED', FALSE))
                OVER (PARTITION BY e.id) AS identity_authority,
              ee.id AS evidence_id, sr.source_id,
              sa.acquisition_route, sa.account_or_product_plan,
              sa.acquisition_jurisdiction
         FROM requested
         JOIN entities e ON e.id = requested.id
         LEFT JOIN entity_evidence ee ON ee.entity_id = e.id
         LEFT JOIN source_records sr ON sr.id = ee.source_record_id
         LEFT JOIN source_artifacts sa ON sa.id = ee.artifact_id
        ORDER BY e.id, ee.id`,
      [JSON.stringify(entityIds)],
    );

    const grouped = new Map<
      EntityId,
      { identityAuthority: boolean; contributions: Array<ArtifactContribution | null> }
    >();
    for (const row of rows) {
      const id = row.entity_id as EntityId;
      const current = grouped.get(id) ?? {
        identityAuthority: row.identity_authority === true,
        contributions: [],
      };
      current.identityAuthority ||= row.identity_authority === true;
      current.contributions.push(contributionFromEntityRow(row));
      grouped.set(id, current);
    }

    const decisions = new Map<EntityId, boolean>();
    // The snapshot uses one pinned connection. Evaluate candidates in order so
    // a catalog with many distinct sources cannot enqueue an unbounded number
    // of rights-context query chains on that connection.
    for (const id of entityIds) {
      const candidate = grouped.get(id);
      if (
        candidate === undefined ||
        !candidate.identityAuthority ||
        candidate.contributions.length === 0 ||
        candidate.contributions.some((entry) => entry === null)
      ) {
        decisions.set(id, false);
        continue;
      }
      decisions.set(
        id,
        await this.#authorizeContributions(
          candidate.contributions as ArtifactContribution[],
          null,
          'METADATA',
        ),
      );
    }
    return decisions;
  }

  authorizeEntity(entityId: EntityId): Promise<boolean> {
    const cached = this.#entityResults.get(entityId);
    if (cached !== undefined) return cached;
    const result = this.#authorizeEntities([entityId]).then((decisions) => decisions[0] ?? false);
    this.#entityResults.set(entityId, result);
    return result;
  }

  authorizeFact(factId: string): Promise<boolean> {
    const cached = this.#factResults.get(factId);
    if (cached !== undefined) return cached;
    const result = this.#authorizeFacts([factId]).then((decisions) => decisions[0] ?? false);
    this.#factResults.set(factId, result);
    return result;
  }

  async #authorizeFacts(factIds: readonly string[]): Promise<readonly boolean[]> {
    const uniqueIds = [...new Set(factIds)];
    const missing = uniqueIds.filter((id) => !this.#factResults.has(id));
    if (missing.length > 0) {
      const decisions = this.#loadFactAuthorizationDecisions(missing);
      for (const id of missing) {
        this.#factResults.set(
          id,
          decisions.then((loaded) => loaded.get(id) ?? false),
        );
      }
    }
    return Promise.all(
      factIds.map((id) => this.#factResults.get(id) ?? Promise.resolve(false)),
    );
  }

  async #loadFactAuthorizationDecisions(
    factIds: readonly string[],
  ): Promise<ReadonlyMap<string, boolean>> {
    const records = await this.#loadFactAuthorizationRecords(factIds);
    const decisions = new Map<string, boolean>();
    const tupleAuthorization = new Map<string, Promise<boolean>>();
    const contributionClosures = new Map<
      string,
      readonly ArtifactContribution[] | null
    >();
    // Keep rights-context loading bounded on the snapshot's single connection.
    // The recursive evidence/dependency SQL is already set-based; this loop is
    // pure evaluation after at most one cached context load per source. Graph
    // memoization keeps a shared dependency DAG proportional to its nodes and
    // edges instead of the number of paths through it.
    for (const id of factIds) {
      decisions.set(
        id,
        await this.#authorizeFactFromRecords(
          id,
          records,
          new Set(),
          tupleAuthorization,
          contributionClosures,
        ),
      );
    }
    return decisions;
  }

  /**
   * Load each requested fact, its recursive dependency closure, and every
   * immutable evidence contribution in one rowset. A derived fact can still
   * fail closed at any node, but its authorization no longer performs a query
   * for every fact and dependency in the graph.
   */
  async #loadFactAuthorizationRecords(
    factIds: readonly string[],
  ): Promise<ReadonlyMap<string, FactAuthorizationRecord>> {
    const rows = await this.#store.driver.query<FactAuthorizationRow>(
      `WITH RECURSIVE requested(id) AS (
         SELECT value::uuid
           FROM jsonb_array_elements_text($1::jsonb) AS requested_id(value)
       ), fact_closure(id) AS (
         SELECT id FROM requested
         UNION
         SELECT dependency.input_fact_id
           FROM fact_dependencies dependency
           JOIN fact_closure closure ON closure.id = dependency.derived_fact_id
       ), authorization_rows AS (
         -- One metadata row retains a fact even when it has no evidence or
         -- dependency. Dependency and evidence rows stay additive instead of
         -- multiplying each other for high-degree derived facts.
         SELECT fact.id::text AS fact_id, fact.property, fact.output_kind,
                NULL::text AS input_fact_id,
                NULL::text AS evidence_id, NULL::text AS source_id,
                NULL::text AS acquisition_route,
                NULL::text AS account_or_product_plan,
                NULL::text AS acquisition_jurisdiction
           FROM fact_closure closure
           JOIN facts fact ON fact.id = closure.id
         UNION ALL
         SELECT fact.id::text AS fact_id, fact.property, fact.output_kind,
                dependency.input_fact_id::text AS input_fact_id,
                NULL::text AS evidence_id, NULL::text AS source_id,
                NULL::text AS acquisition_route,
                NULL::text AS account_or_product_plan,
                NULL::text AS acquisition_jurisdiction
           FROM fact_closure closure
           JOIN facts fact ON fact.id = closure.id
           JOIN fact_dependencies dependency ON dependency.derived_fact_id = fact.id
         UNION ALL
         SELECT fact.id::text AS fact_id, fact.property, fact.output_kind,
                NULL::text AS input_fact_id,
                evidence.id::text AS evidence_id,
                record.source_id::text AS source_id,
                artifact.acquisition_route::text AS acquisition_route,
                artifact.account_or_product_plan,
                artifact.acquisition_jurisdiction
           FROM fact_closure closure
           JOIN facts fact ON fact.id = closure.id
           JOIN fact_evidence evidence ON evidence.fact_id = fact.id
           LEFT JOIN source_records record ON record.id = evidence.source_record_id
           LEFT JOIN source_artifacts artifact ON artifact.id = evidence.artifact_id
       )
       SELECT fact_id, property, output_kind, input_fact_id, evidence_id,
              source_id, acquisition_route, account_or_product_plan,
              acquisition_jurisdiction
         FROM authorization_rows
        ORDER BY fact_id, input_fact_id, evidence_id`,
      [JSON.stringify(factIds)],
    );

    const mutable = new Map<
      string,
      {
        property: string;
        outputKind: string | null;
        dependencies: Set<string>;
        contributions: Map<string, ArtifactContribution>;
        invalidContribution: boolean;
      }
    >();
    for (const row of rows) {
      const current = mutable.get(row.fact_id) ?? {
        property: row.property,
        outputKind: row.output_kind,
        dependencies: new Set<string>(),
        contributions: new Map<string, ArtifactContribution>(),
        invalidContribution: false,
      };
      if (row.input_fact_id !== null) current.dependencies.add(row.input_fact_id);
      if (row.evidence_id !== null) {
        const contribution = contributionFromEntityRow({
          entity_id: row.fact_id,
          evidence_id: row.evidence_id,
          source_id: row.source_id,
          acquisition_route: row.acquisition_route,
          account_or_product_plan: row.account_or_product_plan,
          acquisition_jurisdiction: row.acquisition_jurisdiction,
        });
        if (contribution === null) current.invalidContribution = true;
        else current.contributions.set(contribution.contributionId, contribution);
      }
      mutable.set(row.fact_id, current);
    }

    return new Map([...mutable].map(([id, record]) => [
      id,
      {
        property: record.property,
        outputKind: record.outputKind,
        dependencies: [...record.dependencies],
        contributions: record.invalidContribution
          ? null
          : [...record.contributions.values()],
      },
    ]));
  }

  async authorizeCandidateExcerpt(candidate: FactCandidate): Promise<boolean> {
    const contributions = candidate.evidence.map(contributionFromEvidence);
    if (contributions.some((entry) => entry === null)) return false;
    return this.#authorizeAdditionalOperation(
      contributions as ArtifactContribution[],
      candidate.fact.property,
      'RAW_RECORD',
      'QUOTE_OR_EXCERPT',
    );
  }

  async #authorizeFactFromRecords(
    factId: string,
    records: ReadonlyMap<string, FactAuthorizationRecord>,
    ancestors: ReadonlySet<string>,
    tupleAuthorization: Map<string, Promise<boolean>>,
    contributionClosures: Map<string, readonly ArtifactContribution[] | null>,
  ): Promise<boolean> {
    if (ancestors.has(factId)) return false;
    const cached = tupleAuthorization.get(factId);
    if (cached !== undefined) return cached;
    const result = this.#authorizeFactFromRecordsUncached(
      factId,
      records,
      ancestors,
      tupleAuthorization,
      contributionClosures,
    );
    tupleAuthorization.set(factId, result);
    return result;
  }

  async #authorizeFactFromRecordsUncached(
    factId: string,
    records: ReadonlyMap<string, FactAuthorizationRecord>,
    ancestors: ReadonlySet<string>,
    tupleAuthorization: Map<string, Promise<boolean>>,
    contributionClosures: Map<string, readonly ArtifactContribution[] | null>,
  ): Promise<boolean> {
    const record = records.get(factId);
    if (
      record === undefined ||
      record.outputKind === null ||
      record.contributions === null ||
      record.contributions.length === 0
    ) {
      return false;
    }
    const derived = record.outputKind === 'DERIVED_METRIC';
    if (
      (derived && record.dependencies.length === 0) ||
      (!derived && record.dependencies.length > 0)
    ) {
      return false;
    }
    if (
      !(await this.#authorizeContributions(
        record.contributions,
        record.property,
        derived ? 'DERIVED_METRIC' : 'NORMALIZED_FACT',
      ))
    ) {
      return false;
    }

    if (!derived) return true;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(factId);
    // DERIVE is permission to create this exact output, so every contribution
    // behind it must authorize the target tuple. That includes both the
    // target fact's direct evidence and the complete recursive input closure.
    const derivationContributions = new Map<string, ArtifactContribution>(
      record.contributions.map((contribution) => [
        contribution.contributionId,
        contribution,
      ]),
    );
    for (const dependencyId of record.dependencies) {
      const subtree = this.#collectFactContributions(
        dependencyId,
        records,
        nextAncestors,
        contributionClosures,
      );
      if (subtree === null) return false;
      for (const contribution of subtree) {
        derivationContributions.set(contribution.contributionId, contribution);
      }
    }
    if (
      !(await this.#authorizeDerivationContribution(
        [...derivationContributions.values()],
        record.property,
      ))
    ) {
      return false;
    }
    // DERIVE on the ultimate target is separate from whether each input may be
    // distributed on this surface under its own field/output tuple.
    for (const dependencyId of record.dependencies) {
      if (!(await this.#authorizeFactFromRecords(
        dependencyId,
        records,
        nextAncestors,
        tupleAuthorization,
        contributionClosures,
      ))) {
        return false;
      }
    }
    return true;
  }

  #collectFactContributions(
    factId: string,
    records: ReadonlyMap<string, FactAuthorizationRecord>,
    ancestors: ReadonlySet<string>,
    memo: Map<string, readonly ArtifactContribution[] | null>,
  ): readonly ArtifactContribution[] | null {
    if (ancestors.has(factId)) return null;
    const cached = memo.get(factId);
    if (cached !== undefined) return cached;

    const visiting = new Set(ancestors);
    const stack: Array<{ readonly id: string; readonly exit: boolean }> = [
      { id: factId, exit: false },
    ];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;
      if (memo.has(frame.id)) continue;
      if (frame.exit) {
        visiting.delete(frame.id);
        const record = records.get(frame.id);
        if (
          record === undefined ||
          record.contributions === null ||
          record.contributions.length === 0
        ) {
          memo.set(frame.id, null);
          continue;
        }
        const contributions = new Map<string, ArtifactContribution>();
        for (const contribution of record.contributions) {
          contributions.set(contribution.contributionId, contribution);
        }
        let valid = true;
        for (const dependencyId of record.dependencies) {
          const nested = memo.get(dependencyId);
          if (nested === undefined || nested === null) {
            valid = false;
            break;
          }
          for (const contribution of nested) {
            contributions.set(contribution.contributionId, contribution);
          }
        }
        memo.set(frame.id, valid ? [...contributions.values()] : null);
        continue;
      }
      if (visiting.has(frame.id)) {
        for (const id of visiting) memo.set(id, null);
        return null;
      }

      const record = records.get(frame.id);
      if (
        record === undefined ||
        record.outputKind === null ||
        record.contributions === null ||
        record.contributions.length === 0
      ) {
        memo.set(frame.id, null);
        continue;
      }
      const derived = record.outputKind === 'DERIVED_METRIC';
      if (
        (derived && record.dependencies.length === 0) ||
        (!derived && record.dependencies.length > 0)
      ) {
        memo.set(frame.id, null);
        continue;
      }

      visiting.add(frame.id);
      stack.push({ id: frame.id, exit: true });
      for (let index = record.dependencies.length - 1; index >= 0; index -= 1) {
        const dependencyId = record.dependencies[index];
        if (dependencyId !== undefined) {
          stack.push({ id: dependencyId, exit: false });
        }
      }
    }
    return memo.get(factId) ?? null;
  }

  authorizeRelationship(relationship: Relationship): Promise<boolean> {
    const cached = this.#relationshipResults.get(relationship.id);
    if (cached !== undefined) return cached;
    const result = this.#authorizeRelationship(relationship);
    this.#relationshipResults.set(relationship.id, result);
    return result;
  }

  async #authorizeRelationship(relationship: Relationship): Promise<boolean> {
    if (
      !(await this.authorizeEntity(relationship.subject_entity_id)) ||
      !(await this.authorizeEntity(relationship.object_entity_id))
    ) {
      return false;
    }
    const rows = await this.#store.driver.query<EntityEvidenceRow>(
      `SELECT re.relationship_id AS entity_id, re.id AS evidence_id, sr.source_id,
              sa.acquisition_route, sa.account_or_product_plan,
              sa.acquisition_jurisdiction
         FROM relationship_evidence re
         JOIN source_records sr ON sr.id = re.source_record_id
         JOIN source_artifacts sa ON sa.id = re.artifact_id
        WHERE re.relationship_id = $1
          AND sr.is_current
          AND sr.revision_state = 'FINALIZED'
        ORDER BY re.id`,
      [relationship.id],
    );
    const contributions = rows.map(contributionFromEntityRow);
    if (contributions.some((entry) => entry === null)) return false;
    return this.#authorizeContributions(
      contributions as ArtifactContribution[],
      relationship.predicate,
      'METADATA',
    );
  }

  visibleEntityIds(verticalId: VerticalId): Promise<readonly EntityId[]> {
    const cached = this.#visibleEntities.get(verticalId);
    if (cached !== undefined) return cached;
    const loaded = this.#loadVisibleEntityIds(verticalId);
    this.#visibleEntities.set(verticalId, loaded);
    return loaded;
  }

  async #loadVisibleEntityIds(verticalId: VerticalId): Promise<readonly EntityId[]> {
    const rows = await this.#store.driver.query<{ id: string } & SqlRow>(
      `SELECT id FROM entities
        WHERE vertical_id = $1 AND status <> 'RETIRED'
        ORDER BY id`,
      [verticalId],
    );
    const ids = rows.map((row) => row.id as EntityId);
    const decisions = await this.#authorizeEntities(ids);
    return ids.filter((_, index) => decisions[index] === true);
  }

  visibleFactIds(verticalId: VerticalId): Promise<readonly string[]> {
    const cached = this.#visibleFacts.get(verticalId);
    if (cached !== undefined) return cached;
    const loaded = this.#loadVisibleFactIds(verticalId);
    this.#visibleFacts.set(verticalId, loaded);
    return loaded;
  }

  async #loadVisibleFactIds(verticalId: VerticalId): Promise<readonly string[]> {
    const rows = await this.#store.driver.query<{ id: string } & SqlRow>(
      `SELECT f.id
         FROM facts f
         JOIN entities e ON e.id = f.entity_id
        WHERE e.vertical_id = $1
           AND f.status <> 'RETRACTED'
          AND f.valid_from <= $2
          AND (f.valid_to IS NULL OR f.valid_to > $2)
          AND f.recorded_at <= $2
          AND EXISTS (
            SELECT 1
              FROM fact_evidence evidence
              JOIN source_records record ON record.id = evidence.source_record_id
             WHERE evidence.fact_id = f.id
               AND evidence.observed_at <= $2
               AND record.revision_state = 'FINALIZED'
               AND (
                 record.is_current OR
                 EXISTS (
                   SELECT 1
                     FROM source_record_reconciliations reconciliation
                    WHERE reconciliation.superseded_source_record_id = record.id
                      AND reconciliation.reconciled_at > $2
                 ) OR
                 EXISTS (
                   SELECT 1
                     FROM source_record_snapshot_retirements retirement
                    WHERE retirement.source_record_id = record.id
                      AND retirement.retired_at > $2
                 )
               )
          )
        ORDER BY f.id`,
      [verticalId, this.#asOf],
    );
    const ids = rows.map((row) => row.id);
    const decisions = await this.#authorizeFacts(ids);
    return ids.filter((_, index) => decisions[index] === true);
  }

  async listEntities(query: SurfaceEntityListQuery): Promise<SurfaceEntityListPage> {
    const statuses = query.statuses ?? (['ACTIVE'] as const);
    if (statuses.length === 0) return { entities: [], next_after_id: null };
    const limit = boundedEntityScanLimit(query.limit);
    const statusPlaceholders = statuses.map((_, index) => `$${index + 3}`).join(', ');
    const afterPlaceholder = `$${statuses.length + 3}`;
    const limitPlaceholder = `$${statuses.length + 4}`;
    const rows = await this.#store.driver.query(
      `SELECT ${ENTITY_COLUMNS}
         FROM entities
        WHERE vertical_id = $1
          AND ($2::text IS NULL OR entity_type = $2)
          AND status IN (${statusPlaceholders})
          AND (${afterPlaceholder}::uuid IS NULL OR id > ${afterPlaceholder}::uuid)
        ORDER BY id
        LIMIT ${limitPlaceholder}`,
      [
        query.vertical_id,
        query.entity_type ?? null,
        ...statuses,
        query.after_id ?? null,
        limit + 1,
      ],
    );
    const pageRows = rows.slice(0, limit);
    const entities = pageRows.map(mapEntity);
    const decisions = await this.#authorizeEntities(entities.map((entity) => entity.id));
    return {
      entities: entities.filter((_, index) => decisions[index] === true),
      next_after_id: rows.length > limit ? (entities.at(-1)?.id ?? null) : null,
    };
  }
}

const viewIsAuthorized = async (
  authorizer: SurfaceRightsAuthorizer,
  view: EntityView,
): Promise<boolean> => {
  const ids = new Set<EntityId>([view.entity.id]);
  for (const hop of view.redirected_from?.hops ?? []) {
    ids.add(hop.from_entity_id);
    ids.add(hop.to_entity_id);
  }
  for (const id of ids) if (!(await authorizer.authorizeEntity(id))) return false;
  return true;
};

function createSurfaceQueryModelCore(
  store: CanonicalStore,
  fields: FieldMetadataRegistry,
  surface: RightsSurface,
  options: SurfaceAccessOptions = {},
): SurfaceQueryModel {
  const authorizer = new SurfaceRightsAuthorizer(store, surface, options);

  const getAuthorizedEntity = async (id: EntityId): Promise<EntityView | null> => {
    const view = await getEntityById(store, id);
    return view !== null && (await viewIsAuthorized(authorizer, view)) ? view : null;
  };

  const getAuthorizedEntityBySlug = async (
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<EntityView | null> => {
    const view = await getEntityBySlug(store, verticalId, entityType, slug);
    return view !== null && (await viewIsAuthorized(authorizer, view)) ? view : null;
  };

  const resolveAuthorizedSelection = async (
    entityId: EntityId,
    property: Identifier,
    policy: Partial<FactSelectionPolicyInput> = {},
  ): Promise<{ readonly selection: FactSelection; readonly candidates: readonly FactCandidate[] }> => {
    const at = policy.at ?? nowIso();
    const candidates = await store.loadFactCandidates(entityId, property, at);
    const authorized: FactCandidate[] = [];
    for (const candidate of candidates) {
      // Candidate evidence is already restricted to source-record authority at
      // the caller's selection instant. Never reload immutable history first:
      // doing so would disclose a retired claim through explanations even
      // when canonical selection correctly withheld its value.
      if (candidate.evidence.length > 0 && await authorizer.authorizeFact(candidate.fact.id)) {
        authorized.push(candidate);
      }
    }
    return {
      selection: selectCanonicalFact(property, authorized, {
        ...policy,
        at,
        // The matrix supplies surface permission; the legacy classification
        // remains a coarse review-status brake during migration. The owner has
        // explicitly forbidden RED/UNREVIEWED publication, so both gates must
        // pass until that state is migrated away by a later accepted ADR.
        requirePublishableRights: true,
      }),
      candidates: authorized,
    };
  };

  const authorizedCanonicalFacts = async (
    entityId: EntityId,
    policy: Partial<FactSelectionPolicyInput> = {},
  ): Promise<CanonicalFactView[]> => {
    if (!(await authorizer.authorizeEntity(entityId))) return [];
    const at = policy.at ?? nowIso();
    const properties = await store.driver.query<{ property: string } & SqlRow>(
      `SELECT DISTINCT property FROM facts
        WHERE entity_id = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
        ORDER BY property`,
      [entityId, at],
    );
    const views: CanonicalFactView[] = [];
    for (const row of properties) {
      const { selection, candidates } = await resolveAuthorizedSelection(
        entityId,
        row.property as Identifier,
        { ...policy, at },
      );
      const view = canonicalFactView(selection);
      if (view !== null) {
        const lineage = view.fact_id === null ? null : await factLineage(store.driver, view.fact_id);
        const selectedCandidate = candidates.find((candidate) => candidate.fact.id === view.fact_id);
        const surfaceLineage = selectedCandidate === undefined
          ? []
          : surfaceLineageForCandidate(selectedCandidate, lineage?.chain ?? []);
        const publishers = new Set(view.sources);
        for (const link of surfaceLineage) publishers.add(link.source.publisher);
        views.push({ ...view, sources: [...publishers].sort(compareCodeUnits) });
      }
    }
    return views;
  };

  const explainAuthorizedFact = async (
    entityId: EntityId,
    property: Identifier,
    policy: Partial<FactSelectionPolicyInput> = {},
  ): Promise<SurfaceFactExplanation | null> => {
    const entity = await getAuthorizedEntity(entityId);
    if (entity === null) return null;
    const { selection, candidates } = await resolveAuthorizedSelection(
      entity.entity.id,
      property,
      policy,
    );

    // Reuse the canonical projection's reviewer-identity assertion. The value
    // is intentionally unused; this is the final refusal point before the
    // customer-safe correction reason enters an explanation.
    canonicalFactView(selection);

    const selectedId = selection.selected?.fact.id ?? null;
    const quoteDecisions = await Promise.all(
      candidates.map((candidate) => authorizer.authorizeCandidateExcerpt(candidate)),
    );
    const lineages = await Promise.all(
      candidates.map((candidate) => factLineage(store.driver, candidate.fact.id)),
    );
    const claims = candidates.map((candidate, index) =>
      summarizeSurfaceClaim(
        candidate,
        selectedId,
        quoteDecisions[index] ?? false,
        surfaceLineageForCandidate(candidate, lineages[index]?.chain ?? []),
      ),
    );
    return {
      entity: {
        id: entity.entity.id,
        entity_type: entity.entity.entity_type,
        canonical_name: entity.entity.canonical_name,
        canonical_slug: entity.entity.canonical_slug,
      },
      property,
      at: selection.at,
      selected: claims.find((claim) => claim.selected) ?? null,
      rule: selection.rule,
      reason: selection.reason,
      steps: selection.steps,
      claims,
      conflicts: selection.conflicts,
      unresolved_conflict: selection.unresolved_conflict,
      editorially_corrected: selection.editorially_corrected,
      editorial_correction_reason: selection.editorial_correction?.reason ?? null,
      selection_warnings: selection.selection_warnings,
      narrative: narrateSurfaceSelection(selection, claims),
    };
  };

  const surfaceModel: SurfaceQueryModel = {
    fields,
    surface,
    getEntity: getAuthorizedEntity,
    getEntityBySlug: getAuthorizedEntityBySlug,
    lookupIdentifier: async (lookup) => {
      const result = await lookupByIdentifier(store, lookup);
      const matches = [];
      for (const match of result.matches) {
        if (await authorizer.authorizeEntity(match.entity.id)) matches.push(match);
      }
      const entities = [];
      for (const view of result.entities) {
        if (await viewIsAuthorized(authorizer, view)) entities.push(view);
      }
      return { matches, entities };
    },
    listEntities: (query) => authorizer.listEntities(query),
    search: async (query) => {
      const [entityIds, factIds] = await Promise.all([
        authorizer.visibleEntityIds(query.vertical_id),
        authorizer.visibleFactIds(query.vertical_id),
      ]);
      return searchEntities(store.driver, fields, {
        ...query,
        authorized_entity_ids: intersect(entityIds, query.authorized_entity_ids),
        authorized_fact_ids: intersect(factIds, query.authorized_fact_ids),
      });
    },
    facets: async (query) => {
      const [entityIds, factIds] = await Promise.all([
        authorizer.visibleEntityIds(query.vertical_id),
        authorizer.visibleFactIds(query.vertical_id),
      ]);
      return computeFacets(store.driver, fields, {
        ...query,
        entity_ids: intersect(entityIds, query.entity_ids),
        authorized_fact_ids: intersect(factIds, query.authorized_fact_ids),
      });
    },
    canonicalFacts: authorizedCanonicalFacts,
    explainFact: explainAuthorizedFact,
    relationships: async (query) => {
      if (!(await authorizer.authorizeEntity(query.entity_id))) {
        return {
          root: query.entity_id,
          edges: [],
          depth: Math.max(1, Math.min(Math.trunc(query.depth ?? 1), 4)),
          truncated: false,
          unevidenced_edge_count: 0,
        };
      }
      return traverseRelationships(
        store,
        { ...query, require_publishable_rights: true },
        (relationship) => authorizer.authorizeRelationship(relationship),
      );
    },
    compare: (query) =>
      compareEntities(store, fields, query, {
        getEntity: async (id) => (await getAuthorizedEntity(id))?.entity ?? null,
        canonicalFacts: authorizedCanonicalFacts,
      }),
  };

  return surfaceModel;
}

/**
 * Every externally visible query operation receives a fresh repeatable-read
 * snapshot and a fresh request-local rights cache. Compound API, MCP and web
 * flows may reuse this model safely: a later operation cannot reuse an
 * authorization result computed before a newly committed contribution.
 */
export function createSurfaceQueryModel(
  store: CanonicalStore,
  fields: FieldMetadataRegistry,
  surface: RightsSurface,
  options: SurfaceAccessOptions = {},
): SurfaceQueryModel {
  const run = <T>(
    operation: (snapshot: SurfaceQueryModel) => Promise<T>,
  ): Promise<T> => withSurfaceSnapshot(
    store,
    async (snapshotStore) => operation(
      createSurfaceQueryModelCore(snapshotStore, fields, surface, options),
    ),
  );

  return {
    fields,
    surface,
    getEntity: (id) => run((snapshot) => snapshot.getEntity(id)),
    getEntityBySlug: (verticalId, entityType, slug) => run(
      (snapshot) => snapshot.getEntityBySlug(verticalId, entityType, slug),
    ),
    lookupIdentifier: (lookup) => run((snapshot) => snapshot.lookupIdentifier(lookup)),
    listEntities: (query) => run((snapshot) => snapshot.listEntities(query)),
    search: (query) => run((snapshot) => snapshot.search(query)),
    facets: (query) => run((snapshot) => snapshot.facets(query)),
    canonicalFacts: (entityId, policy) => run(
      (snapshot) => snapshot.canonicalFacts(entityId, policy),
    ),
    explainFact: (entityId, property, policy) => run(
      (snapshot) => snapshot.explainFact(entityId, property, policy),
    ),
    relationships: (query) => run((snapshot) => snapshot.relationships(query)),
    compare: (query) => run((snapshot) => snapshot.compare(query)),
  };
}
