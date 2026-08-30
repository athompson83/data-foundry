import {
  ENTITY_COLUMNS,
  loadStoredRightsContext,
  mapEntity,
  selectCanonicalFact,
  type CandidateEvidence,
  type CanonicalStore,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicyInput,
  type SqlRow,
} from '@data-foundry/canonical-store';
import {
  compareCodeUnits,
  type Entity,
  type EntityId,
  type EntityStatus,
  type FactId,
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

const nowIso = (): IsoDateTime => new Date().toISOString() as IsoDateTime;

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

/**
 * A surface search enumerates every potentially visible entity and fact before
 * pagination so its rights-safe total remains exact. The two enumerations run
 * together, therefore their row-level authorization must share one budget: two
 * independent eight-worker maps would still spend sixteen connections from a
 * `pg` pool whose default maximum is ten.
 */
const SURFACE_AUTHORIZATION_CONCURRENCY = 8;
const SURFACE_ENTITY_SCAN_LIMIT = 200;

const boundedEntityScanLimit = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return SURFACE_ENTITY_SCAN_LIMIT;
  return Math.max(1, Math.min(Math.trunc(value), SURFACE_ENTITY_SCAN_LIMIT));
};

class SurfaceAuthorizationLimiter {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#limit) {
      this.#active += 1;
      return;
    }
    // The releasing worker transfers its permit directly to this waiter, so
    // a newly arriving operation cannot race between release and reacquire.
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  #release(): void {
    const next = this.#waiting.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.#active -= 1;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await operation();
    } finally {
      this.#release();
    }
  }
}

const locatorFor = (evidence: CandidateEvidence): string =>
  evidence.evidence.locator_type === 'WHOLE_DOCUMENT'
    ? 'whole document'
    : `${evidence.evidence.locator_type} ${evidence.evidence.locator_value}`;

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
  readonly #authorizationLimiter = new SurfaceAuthorizationLimiter(
    SURFACE_AUTHORIZATION_CONCURRENCY,
  );

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

  authorizeEntity(entityId: EntityId): Promise<boolean> {
    const cached = this.#entityResults.get(entityId);
    if (cached !== undefined) return cached;
    const result = this.#authorizeEntity(entityId);
    this.#entityResults.set(entityId, result);
    return result;
  }

  async #authorizeEntity(entityId: EntityId): Promise<boolean> {
    const rows = await this.#store.driver.query<EntityEvidenceRow>(
      `SELECT ee.entity_id, ee.id AS evidence_id, sr.source_id,
              sa.acquisition_route, sa.account_or_product_plan,
              sa.acquisition_jurisdiction
         FROM entity_evidence ee
         JOIN source_records sr ON sr.id = ee.source_record_id
         JOIN source_artifacts sa ON sa.id = ee.artifact_id
        WHERE ee.entity_id = $1
        ORDER BY ee.id`,
      [entityId],
    );
    const contributions = rows.map(contributionFromEntityRow);
    if (contributions.some((entry) => entry === null)) return false;
    return this.#authorizeContributions(
      contributions as ArtifactContribution[],
      null,
      'METADATA',
    );
  }

  authorizeFact(factId: string): Promise<boolean> {
    const cached = this.#factResults.get(factId);
    if (cached !== undefined) return cached;
    const result = this.#authorizeFact(factId, new Set());
    this.#factResults.set(factId, result);
    return result;
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

  async #authorizeFact(factId: string, ancestors: ReadonlySet<string>): Promise<boolean> {
    if (ancestors.has(factId)) return false;
    const candidate = await this.#store.loadFactCandidateById(factId as FactId);
    if (candidate === null || candidate.fact.output_kind === null || candidate.evidence.length === 0) {
      return false;
    }
    const { fact } = candidate;
    const contributions = candidate.evidence.map(contributionFromEvidence);
    if (contributions.some((entry) => entry === null)) return false;

    const dependencyRows = await this.#store.driver.query<{ input_fact_id: string } & SqlRow>(
      `SELECT input_fact_id
         FROM fact_dependencies
        WHERE derived_fact_id = $1
        ORDER BY input_fact_id`,
      [fact.id],
    );
    const derived = fact.output_kind === 'DERIVED_METRIC';
    if ((derived && dependencyRows.length === 0) || (!derived && dependencyRows.length > 0)) {
      return false;
    }
    if (
      !(await this.#authorizeContributions(
        contributions as ArtifactContribution[],
        fact.property,
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
      (contributions as ArtifactContribution[]).map((contribution) => [
        contribution.contributionId,
        contribution,
      ]),
    );
    for (const row of dependencyRows) {
      const subtree = await this.#collectFactContributions(row.input_fact_id, nextAncestors);
      if (subtree === null) return false;
      for (const contribution of subtree) {
        derivationContributions.set(contribution.contributionId, contribution);
      }
    }
    if (
      !(await this.#authorizeDerivationContribution(
        [...derivationContributions.values()],
        fact.property,
      ))
    ) {
      return false;
    }
    // DERIVE on the ultimate target is separate from whether each input may be
    // distributed on this surface under its own field/output tuple.
    for (const row of dependencyRows) {
      if (!(await this.#authorizeFact(row.input_fact_id, nextAncestors))) return false;
    }
    return true;
  }

  async #collectFactContributions(
    factId: string,
    ancestors: ReadonlySet<string>,
  ): Promise<readonly ArtifactContribution[] | null> {
    if (ancestors.has(factId)) return null;
    const candidate = await this.#store.loadFactCandidateById(factId as FactId);
    if (candidate === null || candidate.fact.output_kind === null || candidate.evidence.length === 0) {
      return null;
    }
    const { fact } = candidate;
    const direct = candidate.evidence.map(contributionFromEvidence);
    if (direct.some((entry) => entry === null)) return null;

    const dependencyRows = await this.#store.driver.query<{ input_fact_id: string } & SqlRow>(
      `SELECT input_fact_id
         FROM fact_dependencies
        WHERE derived_fact_id = $1
        ORDER BY input_fact_id`,
      [fact.id],
    );
    const derived = fact.output_kind === 'DERIVED_METRIC';
    if ((derived && dependencyRows.length === 0) || (!derived && dependencyRows.length > 0)) {
      return null;
    }
    const contributions = new Map<string, ArtifactContribution>();
    for (const contribution of direct as ArtifactContribution[]) {
      contributions.set(contribution.contributionId, contribution);
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(factId);
    for (const row of dependencyRows) {
      const nested = await this.#collectFactContributions(row.input_fact_id, nextAncestors);
      if (nested === null) return null;
      for (const contribution of nested) {
        contributions.set(contribution.contributionId, contribution);
      }
    }
    return [...contributions.values()];
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
    const decisions = await Promise.all(
      rows.map((row) =>
        this.#authorizationLimiter.run(async () => ({
          id: row.id as EntityId,
          allowed: await this.authorizeEntity(row.id as EntityId),
        })),
      ),
    );
    return decisions.filter((entry) => entry.allowed).map((entry) => entry.id);
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
        ORDER BY f.id`,
      [verticalId, this.#asOf],
    );
    const decisions = await Promise.all(
      rows.map((row) =>
        this.#authorizationLimiter.run(async () => ({
          id: row.id,
          allowed: await this.authorizeFact(row.id),
        })),
      ),
    );
    return decisions.filter((entry) => entry.allowed).map((entry) => entry.id);
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
        limit,
      ],
    );
    const entities = rows.map(mapEntity);
    const decisions = await Promise.all(
      entities.map((entity) =>
        this.#authorizationLimiter.run(async () => ({
          entity,
          allowed: await this.authorizeEntity(entity.id),
        })),
      ),
    );
    return {
      entities: decisions.filter((entry) => entry.allowed).map((entry) => entry.entity),
      next_after_id: rows.length === limit ? (entities.at(-1)?.id ?? null) : null,
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

export function createSurfaceQueryModel(
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
      if (await authorizer.authorizeFact(candidate.fact.id)) authorized.push(candidate);
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
      const { selection } = await resolveAuthorizedSelection(
        entityId,
        row.property as Identifier,
        { ...policy, at },
      );
      const view = canonicalFactView(selection);
      if (view !== null) {
        const lineage = view.fact_id === null ? null : await factLineage(store.driver, view.fact_id);
        const publishers = new Set(view.sources);
        for (const link of lineage?.chain ?? []) publishers.add(link.source.publisher);
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
        lineages[index]?.chain ?? [],
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
