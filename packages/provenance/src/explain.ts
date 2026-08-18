/**
 * `explainFact()` — the trust surface.
 *
 * A published value on its own is a claim the reader has to take on faith. This
 * assembles what the UI, the API and MCP need to show instead: who claims what,
 * from which document and which position inside it, which claim won, under
 * which doc-04 rule and why, and what is still in dispute.
 *
 * Conflicting claims are *reported*, never collapsed. Doc 04 is explicit that
 * conflicting facts must not be overwritten prematurely; a trust surface that
 * hides the disagreement would defeat the point of retaining it.
 */
import {
  ENTITY_COLUMNS,
  mapEntity,
  type CandidateEvidence,
  type CanonicalStore,
  type EditorialCorrection,
  type ExcludedCandidate,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicyInput,
  type FactSelectionRule,
  type FactSelectionStep,
  type RetainedConflict,
  type SelectionWarning,
} from '@data-foundry/canonical-store';
import { canPublish } from '@data-foundry/canonical-schema';
import type {
  CanonicalValue,
  Entity,
  EntityId,
  FactId,
  FactStatus,
  FactValueType,
  Identifier,
  IsoDateTime,
  RightsClassification,
  SourceType,
} from '@data-foundry/canonical-schema';
import { factLineage, type FactLineage } from './lineage.js';

/** One source's assertion, flattened for display. */
export interface ClaimAttribution {
  readonly publisher: string;
  readonly domain: string;
  readonly source_type: SourceType;
  readonly authority_rank: number;
  readonly rights: RightsClassification;
  readonly publishable: boolean;
  /** The value exactly as the source wrote it. */
  readonly source_value: string;
  readonly locator: string;
  readonly artifact_url: string;
  readonly retrieved_at: IsoDateTime;
  readonly observed_at: IsoDateTime;
}

export interface ClaimSummary {
  readonly fact_id: FactId;
  readonly value: CanonicalValue;
  readonly value_type: FactValueType;
  readonly unit: string | null;
  readonly status: FactStatus;
  readonly confidence: number;
  readonly selected: boolean;
  readonly attributions: readonly ClaimAttribution[];
}

export interface FactExplanation {
  readonly entity: Pick<Entity, 'id' | 'entity_type' | 'canonical_name' | 'canonical_slug'>;
  readonly property: Identifier;
  readonly at: IsoDateTime;
  readonly selected: ClaimSummary | null;
  /** Full lineage of the winning claim, for "show me the document". */
  readonly lineage: FactLineage | null;
  readonly rule: FactSelectionRule;
  readonly reason: string;
  readonly steps: readonly FactSelectionStep[];
  /** Every claim considered, winner included. Nothing is dropped. */
  readonly claims: readonly ClaimSummary[];
  readonly conflicts: readonly RetainedConflict[];
  readonly unresolved_conflict: boolean;
  readonly excluded: readonly ExcludedCandidate[];
  /**
   * ADR-0002: the published value is a staff correction that outranked its
   * sources. A reader comparing our page against the manufacturer's is owed
   * that fact before they conclude we simply got it wrong.
   */
  readonly editorially_corrected: boolean;
  /**
   * Who corrected it and why. Non-null iff `editorially_corrected`.
   *
   * NOTE the asymmetry with `CanonicalFactView`: this carries the REVIEWER
   * IDENTITY and is the internal/audit surface. The customer-facing query view
   * projects only the reason.
   */
  readonly editorial_correction: EditorialCorrection | null;
  /**
   * Same first-class warning channel the query view exposes, so the two read
   * paths cannot disagree about how the value was selected.
   */
  readonly selection_warnings: readonly SelectionWarning[];
  /** Ready-to-render lines for a trust panel. */
  readonly narrative: readonly string[];
}

function attribution(link: CandidateEvidence): ClaimAttribution {
  const locator =
    link.evidence.locator_type === 'WHOLE_DOCUMENT'
      ? 'whole document'
      : `${link.evidence.locator_type} ${link.evidence.locator_value}`;
  return {
    publisher: link.source.publisher,
    domain: link.source.domain,
    source_type: link.source.source_type,
    authority_rank: link.source.authority_rank,
    rights: link.source.rights_classification,
    publishable: canPublish(link.source.rights_classification),
    source_value: link.evidence.source_value,
    locator,
    artifact_url: link.artifact.url,
    retrieved_at: link.artifact.retrieved_at,
    observed_at: link.evidence.observed_at,
  };
}

function summarize(candidate: FactCandidate, selectedId: FactId | null): ClaimSummary {
  return {
    fact_id: candidate.fact.id,
    value: candidate.fact.normalized_value,
    value_type: candidate.fact.value_type,
    unit: candidate.fact.unit,
    status: candidate.fact.status,
    confidence: candidate.fact.confidence,
    selected: candidate.fact.id === selectedId,
    attributions: candidate.evidence.map(attribution),
  };
}

const render = (value: CanonicalValue, unit: string | null): string => {
  const base = Array.isArray(value) ? value.join(', ') : String(value);
  return unit === null ? base : `${base} ${unit}`;
};

function narrate(
  property: Identifier,
  selection: FactSelection,
  claims: readonly ClaimSummary[],
): string[] {
  const lines: string[] = [];

  for (const claimSummary of claims) {
    for (const source of claimSummary.attributions) {
      lines.push(
        `${source.publisher} (${source.domain}, ${source.source_type}, authority ${source.authority_rank}) ` +
          `claims "${render(claimSummary.value, claimSummary.unit)}" for ${property}: read "${source.source_value}" ` +
          `at ${source.locator} in ${source.artifact_url}, retrieved ${source.retrieved_at}.`,
      );
    }
  }

  if (selection.selected === null) {
    lines.push(`No value is published for ${property}. ${selection.reason}`);
  } else {
    lines.push(
      `Published value for ${property}: ` +
        `"${render(selection.selected.fact.normalized_value, selection.selected.fact.unit)}" ` +
        `(rule ${selection.rule}). ${selection.reason}`,
    );
  }

  // Stated in its own line rather than folded into the rule text: "a human
  // overruled the sources here" is the single most load-bearing sentence on
  // the panel, and a reader skimming must not have to infer it.
  // Contradictory editorial intent is disclosed even though no correction was
  // applied: the reader is owed the fact that reviewers disagreed here, and
  // that the displayed value therefore came from the ordinary evidence policy.
  if (selection.selection_warnings.includes('AMBIGUOUS_EDITORIAL_INTENT')) {
    lines.push(
      'Editorial review conflict: multiple valid editorial declarations proposed different ' +
        'values. No editorial correction was applied; the displayed value was selected using ' +
        'the ordinary evidence policy.',
    );
  }

  const correction = selection.editorial_correction;
  if (correction !== null) {
    lines.push(
      `Editorially corrected: this value was set by editorial review rather than taken from the ` +
        `highest-ranked source. Reviewer: ${correction.reviewer}. Reason: ${correction.reason} ` +
        `Declared for source "${correction.source}". The source claims it overrode are retained below.`,
    );
  }

  for (const step of selection.steps) {
    if (step.rule === 'ELIGIBILITY' || step.applied) {
      lines.push(`Criterion ${step.rule}: ${step.detail}`);
    }
  }

  for (const conflict of selection.conflicts) {
    const claimants = conflict.claimed_by.map((source) => source.publisher).join(', ');
    lines.push(
      `Unresolved conflict retained: "${render(conflict.value, conflict.unit)}" is still claimed by ` +
        `${claimants}. The rival claim and its evidence are kept, not overwritten.`,
    );
  }

  for (const exclusion of selection.excluded) {
    lines.push(`Excluded claim ${exclusion.fact_id}: ${exclusion.detail}`);
  }

  return lines;
}

/**
 * Explain what the platform publishes for one field of one entity, and why.
 */
export async function explainFact(
  store: CanonicalStore,
  entityId: EntityId,
  property: Identifier,
  policy: Partial<FactSelectionPolicyInput> = {},
): Promise<FactExplanation | null> {
  const entityRows = await store.driver.query(
    `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = $1`,
    [entityId],
  );
  const entityRow = entityRows[0];
  if (entityRow === undefined) return null;
  const entity = mapEntity(entityRow);

  const at = policy.at ?? (new Date().toISOString() as IsoDateTime);
  const candidates = await store.loadFactCandidates(entityId, property, at);
  const selection = await store.selectFact(entityId, property, { ...policy, at });

  const selectedId = selection.selected?.fact.id ?? null;
  const claims = candidates.map((candidate) => summarize(candidate, selectedId));
  const lineage = selectedId === null ? null : await factLineage(store.driver, selectedId);

  return {
    entity: {
      id: entity.id,
      entity_type: entity.entity_type,
      canonical_name: entity.canonical_name,
      canonical_slug: entity.canonical_slug,
    },
    property,
    at,
    selected: claims.find((claim) => claim.selected) ?? null,
    lineage,
    rule: selection.rule,
    reason: selection.reason,
    steps: selection.steps,
    claims,
    conflicts: selection.conflicts,
    unresolved_conflict: selection.unresolved_conflict,
    excluded: selection.excluded,
    editorially_corrected: selection.editorially_corrected,
    editorial_correction: selection.editorial_correction,
    selection_warnings: selection.selection_warnings,
    narrative: narrate(property, selection, claims),
  };
}

/** `explainFact` for every property of an entity. */
export async function explainEntity(
  store: CanonicalStore,
  entityId: EntityId,
  policy: Partial<FactSelectionPolicyInput> = {},
): Promise<Map<Identifier, FactExplanation>> {
  const at = policy.at ?? (new Date().toISOString() as IsoDateTime);
  const rows = await store.driver.query<{ property: string }>(
    `SELECT DISTINCT property FROM facts
      WHERE entity_id = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
      ORDER BY property`,
    [entityId, at],
  );
  const explanations = new Map<Identifier, FactExplanation>();
  for (const { property } of rows) {
    const explanation = await explainFact(store, entityId, property as Identifier, { ...policy, at });
    if (explanation !== null) explanations.set(property as Identifier, explanation);
  }
  return explanations;
}
