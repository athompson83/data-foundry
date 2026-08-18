/**
 * Facts as consumers see them: the canonical value plus why it is the canonical
 * value, and the evidence behind it.
 *
 * Web, REST and MCP all read through here (AGENTS.md rule 5). None of them
 * re-implements selection, and none of them is allowed to serve a value without
 * being able to serve its provenance alongside it.
 */
import type {
  CanonicalStore,
  FactSelectionPolicyInput,
  FactSelectionRule,
  RetainedConflict,
  SelectionWarning,
} from '@data-foundry/canonical-store';
import { factLineage, type FactLineage } from '@data-foundry/provenance';
import { compareCodeUnits } from '@data-foundry/canonical-schema';
import type {
  CanonicalValue,
  EntityId,
  Fact,
  FactEvidence,
  FactValueType,
  Identifier,
  IsoDateTime,
} from '@data-foundry/canonical-schema';

export interface FactWithEvidence {
  readonly fact: Fact;
  readonly evidence: readonly FactEvidence[];
  readonly lineage: FactLineage | null;
  readonly source_count: number;
}

export interface ListFactsQuery {
  readonly entity_id: EntityId;
  readonly property?: Identifier;
  readonly at?: IsoDateTime;
  readonly include_history?: boolean;
}

/** Facts with their evidence chains attached. */
export async function listFactsWithEvidence(
  store: CanonicalStore,
  query: ListFactsQuery,
): Promise<FactWithEvidence[]> {
  const facts = await store.listFacts(query.entity_id, {
    ...(query.property === undefined ? {} : { property: query.property }),
    ...(query.at === undefined ? {} : { at: query.at }),
    ...(query.include_history === undefined ? {} : { include_history: query.include_history }),
  });

  const out: FactWithEvidence[] = [];
  for (const fact of facts) {
    const lineage = await factLineage(store.driver, fact.id);
    out.push({
      fact,
      evidence: lineage?.chain.map((link) => link.evidence as FactEvidence) ?? [],
      lineage,
      source_count: lineage?.distinct_sources ?? 0,
    });
  }
  return out;
}

/** One property of the canonical view, with the rule that produced it. */
export interface CanonicalFactView {
  readonly property: Identifier;
  readonly value: CanonicalValue | null;
  readonly value_type: FactValueType | null;
  readonly unit: string | null;
  readonly confidence: number | null;
  readonly fact_id: Fact['id'] | null;
  readonly rule: FactSelectionRule;
  readonly reason: string;
  readonly sources: readonly string[];
  readonly conflicts: readonly RetainedConflict[];
  readonly unresolved_conflict: boolean;

  /**
   * True when an auditable editorial override replaced the source-selected
   * value (ADR-0002). Rule 5: the selection layer and `explainFact` both know
   * this, so the path that actually serves values must say it too — otherwise a
   * corrected value reaches a customer indistinguishable from an evidence-
   * selected one.
   */
  readonly editorially_corrected: boolean;
  /**
   * CUSTOMER-VISIBLE explanation of the correction, or null.
   *
   * Invariant, asserted in tests:
   *   editorially_corrected === true  => non-empty after trim
   *   editorially_corrected === false => null
   *
   * This is the override's declared `reason`, which is authored in
   * version-controlled vertical config and reviewed in a pull request — it is
   * a public explanation by contract, not a free-form internal note. The
   * REVIEWER IDENTITY is deliberately NOT projected here; it stays in
   * `explainFact` and the audit record.
   */
  readonly editorial_correction_reason: string | null;
  /**
   * Machine-readable trust warnings about HOW this value was selected.
   * Consumers must ignore codes they do not recognise rather than failing —
   * this list is designed to grow without breaking older readers.
   */
  readonly selection_warnings: readonly SelectionWarning[];
}

/**
 * The canonical view of an entity: one selected value per property, each
 * carrying the doc-04 rule that chose it and any conflict still outstanding.
 */
export async function canonicalFacts(
  store: CanonicalStore,
  entityId: EntityId,
  policy: Partial<FactSelectionPolicyInput> = {},
): Promise<CanonicalFactView[]> {
  const view = await store.canonicalView(entityId, policy);
  const rows: CanonicalFactView[] = [];

  for (const [property, selection] of view) {
    const selected = selection.selected;
    const publishers = new Set<string>();
    for (const link of selected?.evidence ?? []) publishers.add(link.source.publisher);
    rows.push({
      property,
      value: selected?.fact.normalized_value ?? null,
      value_type: selected?.fact.value_type ?? null,
      unit: selected?.fact.unit ?? null,
      confidence: selected?.fact.confidence ?? null,
      fact_id: selected?.fact.id ?? null,
      rule: selection.rule,
      reason: selection.reason,
      sources: [...publishers],
      conflicts: selection.conflicts,
      unresolved_conflict: selection.unresolved_conflict,
      // Derived from the SAME selection result explainFact reads. Never
      // recomputed here, so the two read paths cannot drift apart.
      editorially_corrected: selection.editorially_corrected,
      editorial_correction_reason: selection.editorial_correction?.reason ?? null,
      selection_warnings: selection.selection_warnings,
    });
  }

  return rows.sort((left, right) => compareCodeUnits(left.property, right.property));
}
