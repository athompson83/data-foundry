/**
 * `@data-foundry/canonical-store`
 *
 * Canonical storage for entities, aliases, facts, relationships and evidence,
 * over portable Postgres. The same SQL runs on PGlite (dev/test) and real
 * Postgres (prod) behind one `SqlDriver`; there is no ORM and no dialect
 * branching.
 *
 * The two invariants this package exists to make unbreakable:
 *
 *   * AGENTS.md rule 2 — a fact or relationship cannot be persisted without
 *     evidence. The write API takes evidence as a required, statically
 *     non-empty argument and commits both in one transaction.
 *   * ADR-0001 / doc 04 — facts are append-only. A new value is a new row and
 *     the previous version is closed; `normalized_value` is never rewritten.
 *
 * It also implements doc 04's fact-selection cascade, which is what turns a
 * pile of competing claims into a canonical view — with the rule that fired
 * attached, because the UI has to show a trust surface.
 */

export {
  CanonicalStoreError,
  DestructiveWriteError,
  DriverCapabilityError,
  MissingEvidenceError,
  NotFoundError,
} from './errors.js';

export {
  createDriverFromEnv,
  createPgliteDriver,
  createPostgresDriver,
  placeholders,
  supportsTrigram,
  type PgliteDriverOptions,
  type SqlDriver,
  type SqlExecutor,
  type SqlParam,
  type SqlRow,
} from './sql-driver.js';

export {
  ALIAS_COLUMNS,
  ARTIFACT_COLUMNS,
  ENTITY_COLUMNS,
  FACT_COLUMNS,
  FACT_EVIDENCE_COLUMNS,
  REDIRECT_COLUMNS,
  RELATIONSHIP_COLUMNS,
  RELATIONSHIP_EVIDENCE_COLUMNS,
  SNAPSHOT_COLUMNS,
  SOURCE_COLUMNS,
  SOURCE_RECORD_COLUMNS,
  mapDatasetSnapshot,
  mapEntity,
  mapEntityAlias,
  mapEntityRedirect,
  mapFact,
  mapFactEvidence,
  mapRelationship,
  mapRelationshipEvidence,
  mapSource,
  mapSourceArtifact,
  mapSourceRecord,
  mapVertical,
  toIso,
  toIsoOrNull,
  toJson,
  toNumber,
  toText,
  toTextOrNull,
} from './rows.js';

export {
  CANDIDATE_EXCLUSION_REASONS,
  DEFAULT_AUTHORITATIVE_SOURCE_TYPES,
  DEFAULT_CONSISTENCY_CHECKS,
  DEFAULT_REQUIRE_PUBLISHABLE_RIGHTS,
  DOC04_SELECTION_PRECEDENCE,
  FACT_SELECTION_RULES,
  NON_EMPTY_VALUE_CHECK,
  QUANTITY_REQUIRES_UNIT_CHECK,
  VALUE_TYPE_AGREEMENT_CHECK,
  enumMembershipCheck,
  isAuditableEditorialOverride,
  numericRangeCheck,
  resolveFactSelectionPolicy,
  selectCanonicalFact,
  type CandidateArtifactInfo,
  type CandidateEvidence,
  type CandidateExclusionReason,
  type CandidateSourceInfo,
  type ConsistencyCheck,
  type ConsistencyCheckResult,
  type EditorialCorrection,
  type EditorialOverride,
  type ExcludedCandidate,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicy,
  type FactSelectionPolicyInput,
  type FactSelectionRule,
  type FactSelectionStep,
  type RetainedConflict,
  SELECTION_WARNINGS,
  type SelectionWarning,
} from './fact-selection.js';

export {
  createCanonicalStore,
  prefixColumns,
  unprefixRow,
  type AliasLookupQuery,
  type AliasMatch,
  type CanonicalStore,
  type EntityEvidenceInput,
  type FactEvidenceInput,
  type FactVersionDraft,
  type FactWriteOutcome,
  type FactWriteResult,
  type ListFactsOptions,
  type MergeEntitiesInput,
  type NonEmptyArray,
  type RedirectResolution,
  type RelationshipClaimInput,
  type RelationshipEvidenceInput,
  type RelationshipWriteOutcome,
  type RelationshipWriteResult,
} from './store.js';

export {
  loadStoredRightsContext,
  type StoredRightsContext,
} from './rights-store.js';
