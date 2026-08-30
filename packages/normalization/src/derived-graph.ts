import type { Identifier } from '@data-foundry/canonical-schema';
import type { CanonicalCandidate } from './types.js';

/** A normalized record cannot be written without one complete acyclic input graph. */
export class DerivedCandidateGraphError extends Error {
  override readonly name = 'DerivedCandidateGraphError';
}

/**
 * Validate and topologically order one record's candidates before any fact is
 * written. Declared configuration can be valid while an optional source field
 * is absent at runtime; that missing parent is still a refusal, not permission
 * to persist a partial derived lineage.
 */
export function orderCanonicalCandidatesByDerivation(
  candidates: readonly CanonicalCandidate[],
): CanonicalCandidate[] {
  const byProperty = new Map<Identifier, CanonicalCandidate>();
  for (const candidate of candidates) {
    if (byProperty.has(candidate.property)) {
      throw new DerivedCandidateGraphError(
        `duplicate canonical candidate ${candidate.property} in one normalized record`,
      );
    }
    byProperty.set(candidate.property, candidate);
  }

  const ordered: CanonicalCandidate[] = [];
  const visiting = new Set<Identifier>();
  const visited = new Set<Identifier>();
  const visit = (candidate: CanonicalCandidate): void => {
    if (visited.has(candidate.property)) return;
    if (visiting.has(candidate.property)) {
      throw new DerivedCandidateGraphError(
        `derived candidate cycle includes ${candidate.property}`,
      );
    }
    visiting.add(candidate.property);
    if (candidate.output_kind === 'DERIVED_METRIC') {
      const parentProperty = candidate.derived_from_property;
      if (parentProperty === undefined) {
        throw new DerivedCandidateGraphError(
          `derived candidate ${candidate.property} has no declared input property`,
        );
      }
      const parent = byProperty.get(parentProperty);
      if (parent === undefined) {
        throw new DerivedCandidateGraphError(
          `derived candidate ${candidate.property} is missing input ${parentProperty}`,
        );
      }
      visit(parent);
    }
    visiting.delete(candidate.property);
    visited.add(candidate.property);
    ordered.push(candidate);
  };

  for (const candidate of candidates) visit(candidate);
  return ordered;
}
