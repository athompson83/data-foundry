/**
 * Side-by-side entity comparison.
 *
 * Comparison is the canonical view of several entities aligned on properties,
 * and property order comes from field metadata rather than from whatever order
 * the database happened to return — the comparison table is a UI surface, and
 * the vertical's own field declaration order is the only vertical-agnostic way
 * to order it (AGENTS.md rule 4).
 */
import type { CanonicalStore, FactSelectionPolicyInput, FactSelectionRule } from '@data-foundry/canonical-store';
import type { CanonicalValue, Entity, EntityId, FactValueType, Identifier } from '@data-foundry/canonical-schema';
import type { FieldMetadataRegistry } from './field-metadata.js';
import { canonicalFacts, type CanonicalFactView } from './facts.js';

export interface ComparisonCell {
  readonly entity_id: EntityId;
  readonly present: boolean;
  readonly value: CanonicalValue | null;
  readonly value_type: FactValueType | null;
  readonly unit: string | null;
  readonly rule: FactSelectionRule | null;
  readonly sources: readonly string[];
  readonly unresolved_conflict: boolean;
}

export interface ComparisonRow {
  readonly property: Identifier;
  readonly label: string;
  readonly unit: string | null;
  readonly cells: readonly ComparisonCell[];
  /** True when the entities do not agree (missing values count as differing). */
  readonly differs: boolean;
}

export interface EntityComparison {
  readonly entities: readonly Entity[];
  readonly rows: readonly ComparisonRow[];
  readonly properties_compared: number;
  readonly properties_differing: number;
}

export interface CompareQuery {
  readonly entity_ids: readonly EntityId[];
  readonly properties?: readonly Identifier[];
  readonly policy?: Partial<FactSelectionPolicyInput>;
}

const sameValue = (left: CanonicalValue | null, right: CanonicalValue | null): boolean => {
  if (left === null || right === null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }
  return Object.is(left, right);
};

export async function compareEntities(
  store: CanonicalStore,
  registry: FieldMetadataRegistry,
  query: CompareQuery,
): Promise<EntityComparison> {
  const entities: Entity[] = [];
  const views = new Map<EntityId, Map<Identifier, CanonicalFactView>>();

  for (const entityId of query.entity_ids) {
    const entity = await store.getEntityById(entityId);
    if (entity === null) continue;
    entities.push(entity);
    const facts = await canonicalFacts(store, entityId, query.policy ?? {});
    views.set(entityId, new Map(facts.map((fact) => [fact.property, fact] as const)));
  }

  const declared = registry.all().map((field) => field.field);
  const seen = new Set<Identifier>();
  for (const view of views.values()) for (const property of view.keys()) seen.add(property);

  const requested = query.properties;
  const ordered = [
    ...declared.filter((property) => seen.has(property)),
    ...[...seen].filter((property) => !declared.includes(property)).sort(),
  ].filter((property) => requested === undefined || requested.includes(property));

  const rows: ComparisonRow[] = ordered.map((property) => {
    const metadata = registry.get(property);
    const cells: ComparisonCell[] = entities.map((entity) => {
      const fact = views.get(entity.id)?.get(property);
      return {
        entity_id: entity.id,
        present: fact !== undefined && fact.value !== null,
        value: fact?.value ?? null,
        value_type: fact?.value_type ?? null,
        unit: fact?.unit ?? null,
        rule: fact?.rule ?? null,
        sources: fact?.sources ?? [],
        unresolved_conflict: fact?.unresolved_conflict ?? false,
      };
    });
    const first = cells[0];
    const differs =
      first === undefined ? false : cells.some((cell) => !sameValue(cell.value, first.value));
    return {
      property,
      label: metadata?.label ?? property,
      unit: metadata?.unit ?? cells.find((cell) => cell.unit !== null)?.unit ?? null,
      cells,
      differs,
    };
  });

  return {
    entities,
    rows,
    properties_compared: rows.length,
    properties_differing: rows.filter((row) => row.differs).length,
  };
}
