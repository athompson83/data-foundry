/**
 * `@data-foundry/provenance`
 *
 * Evidence is only worth storing if it can be walked back to. This package
 * turns the stored chain into three things the rest of the platform needs:
 *
 *   * `factLineage` / `relationshipLineage` — the full chain from a canonical
 *     claim to the exact position in the exact artifact that supports it,
 *     including when those bytes were retrieved.
 *   * `provenanceCoverage` — the measurable gate. AGENTS.md requires every
 *     change to preserve provenance coverage; this is the number that claim is
 *     checked against, per entity and per vertical.
 *   * `explainFact` — the human-readable trust surface: who claims what, which
 *     claim won and under which doc-04 rule, and which conflicts are still
 *     unresolved. Rivals are reported, never silently collapsed.
 */

export {
  citation,
  entityLineage,
  factLineage,
  relationshipLineage,
  type EvidenceChainLink,
  type EvidenceLocator,
  type FactDependencyLineage,
  type FactLineage,
  type RelationshipLineage,
} from './lineage.js';

export {
  ProvenanceCoverageError,
  assertProvenanceCoverage,
  provenanceCoverage,
  type CoverageTotals,
  type EntityCoverage,
  type ProvenanceCoverageOptions,
  type ProvenanceCoverageReport,
  type VerticalCoverage,
} from './coverage.js';

export {
  explainEntity,
  explainFact,
  type ClaimAttribution,
  type ClaimSummary,
  type FactExplanation,
} from './explain.js';

export {
  AUTHORITATIVE_SOURCE_TYPES,
  SOURCE_VERIFIED_DEFINITION,
  VERIFICATION_BLOCKERS,
  VERIFICATION_POLICY_VERSION,
  VERIFIED_DECIDERS,
  isVerified,
  verificationSignals,
  verifyFact,
  type VerificationBlocker,
  type VerificationSignals,
  type VerificationVerdict,
} from './verification-policy.js';
