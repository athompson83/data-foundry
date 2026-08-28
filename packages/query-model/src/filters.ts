/**
 * Facet filters and facet counts, both derived from field metadata.
 *
 * Nothing in this file knows what an HVAC unit is. It knows that a vertical
 * declared `voltage` as a numeric, facet-counted, filterable field, and that is
 * enough to build the predicate and the counts. Adding a vertical adds field
 * descriptors; it never adds a branch here (AGENTS.md rule 4).
 */
import type { SqlDriver } from '@data-foundry/canonical-store';
import type { Identifier, VerticalId } from '@data-foundry/canonical-schema';
import {
  UnknownFieldError,
  isNumericValueType,
  type FacetFilter,
  type FacetResult,
  type FacetValueCount,
  type FieldMetadataRegistry,
} from './field-metadata.js';
import { CURRENT_FACT, NUMERIC_FACT_TYPES, Params, VALUE_TEXT } from './sql.js';

/**
 * `EXISTS (...)` predicate constraining `entityAlias` to entities holding a
 * matching current fact. Validated against the registry first, so an unknown or
 * non-filterable field is an error rather than a silently ignored filter.
 */
export function facetFilterPredicate(
  filter: FacetFilter,
  registry: FieldMetadataRegistry,
  entityAlias: string,
  params: Params,
  index: number,
  authorizedFactIds?: readonly string[],
): string {
  const metadata = registry.require(filter.property);
  if (authorizedFactIds !== undefined && authorizedFactIds.length === 0) return 'FALSE';
  const alias = `ff${index}`;
  const numeric = isNumericValueType(metadata.value_type);
  const clauses = [
    `${alias}.entity_id = ${entityAlias}.id`,
    `${alias}.property = ${params.add(filter.property)}`,
    CURRENT_FACT(alias),
  ];
  if (authorizedFactIds !== undefined) {
    clauses.push(`${alias}.id IN (${params.addAll([...authorizedFactIds]).join(', ')})`);
  }

  switch (filter.op) {
    case 'exists':
      break;
    case 'range': {
      if (!numeric) {
        throw new UnknownFieldError(
          filter.property,
          `range filters need a numeric value_type, not ${metadata.value_type}`,
        );
      }
      clauses.push(`${alias}.value_type IN ${NUMERIC_FACT_TYPES}`);
      if (filter.min !== null) {
        clauses.push(`${VALUE_TEXT(alias)}::numeric >= ${params.add(String(filter.min))}::numeric`);
      }
      if (filter.max !== null) {
        clauses.push(`${VALUE_TEXT(alias)}::numeric <= ${params.add(String(filter.max))}::numeric`);
      }
      break;
    }
    case 'in': {
      if (filter.values.length === 0) {
        throw new UnknownFieldError(filter.property, 'an "in" filter needs at least one value');
      }
      if (numeric) {
        clauses.push(`${alias}.value_type IN ${NUMERIC_FACT_TYPES}`);
        const list = filter.values.map((value) => `${params.add(String(value))}::numeric`).join(', ');
        clauses.push(`${VALUE_TEXT(alias)}::numeric IN (${list})`);
      } else if (metadata.value_type === 'boolean') {
        const list = filter.values.map((value) => `${params.add(String(value))}::boolean`).join(', ');
        clauses.push(`${VALUE_TEXT(alias)}::boolean IN (${list})`);
      } else {
        const list = filter.values.map((value) => params.add(String(value))).join(', ');
        clauses.push(`${VALUE_TEXT(alias)} IN (${list})`);
      }
      break;
    }
  }

  return `EXISTS (SELECT 1 FROM facts ${alias} WHERE ${clauses.join(' AND ')})`;
}

export function facetFilterPredicates(
  filters: readonly FacetFilter[],
  registry: FieldMetadataRegistry,
  entityAlias: string,
  params: Params,
  authorizedFactIds?: readonly string[],
): string[] {
  return filters.map((filter, index) =>
    facetFilterPredicate(filter, registry, entityAlias, params, index, authorizedFactIds),
  );
}

export interface FacetQuery {
  readonly vertical_id: VerticalId;
  readonly entity_type?: Identifier;
  /** Restrict counts to a candidate set, e.g. the current search result. */
  readonly entity_ids?: readonly string[];
  /** Subset of facetable fields to compute. Defaults to all of them. */
  readonly properties?: readonly Identifier[];
  /** Trusted surface-rights restriction; omission is internal/unbound use. */
  readonly authorized_fact_ids?: readonly string[];
}

/**
 * Facet counts for every field the vertical declared `facet_count: true`.
 * Multi/single-select fields get value counts; numeric range fields get bounds.
 */
export async function computeFacets(
  driver: SqlDriver,
  registry: FieldMetadataRegistry,
  query: FacetQuery,
): Promise<FacetResult[]> {
  const requested = query.properties;
  const fields = registry
    .facetable()
    .filter((field) => requested === undefined || requested.includes(field.field));
  if (fields.length === 0) return [];

  const params = new Params();
  const scope = [
    `e.vertical_id = ${params.add(query.vertical_id)}`,
    `e.status <> 'RETIRED'`,
    CURRENT_FACT('f'),
  ];
  if (query.entity_type !== undefined) {
    scope.push(`e.entity_type = ${params.add(query.entity_type)}`);
  }
  if (query.entity_ids !== undefined) {
    if (query.entity_ids.length === 0) return emptyFacets(fields);
    const list = params.addAll(query.entity_ids).join(', ');
    scope.push(`e.id IN (${list})`);
  }
  if (query.authorized_fact_ids !== undefined) {
    if (query.authorized_fact_ids.length === 0) return emptyFacets(fields);
    const list = params.addAll([...query.authorized_fact_ids]).join(', ');
    scope.push(`f.id IN (${list})`);
  }
  const propertyList = params.addAll(fields.map((field) => field.field)).join(', ');
  scope.push(`f.property IN (${propertyList})`);

  const rows = await driver.query(
    `SELECT f.property AS property, ${VALUE_TEXT('f')} AS value,
            count(DISTINCT f.entity_id)::text AS entity_count
       FROM facts f
       JOIN entities e ON e.id = f.entity_id
      WHERE ${scope.join(' AND ')}
      GROUP BY f.property, ${VALUE_TEXT('f')}
      ORDER BY f.property, count(DISTINCT f.entity_id) DESC, ${VALUE_TEXT('f')}`,
    params.values,
  );

  const grouped = new Map<string, FacetValueCount[]>();
  const entityCounts = new Map<string, Set<string>>();
  for (const row of rows) {
    const property = String(row['property']);
    const bucket = grouped.get(property) ?? [];
    bucket.push({ value: String(row['value']), count: Number(row['entity_count'] ?? 0) });
    grouped.set(property, bucket);
    entityCounts.set(property, entityCounts.get(property) ?? new Set());
  }

  return fields.map((field) => {
    const values = grouped.get(field.field) ?? [];
    const numeric = isNumericValueType(field.value_type);
    const numbers = numeric ? values.map((entry) => Number(entry.value)).filter((n) => !Number.isNaN(n)) : [];
    const control = field.filter?.type ?? 'none';
    const maxValues = field.filter?.max_values ?? 50;
    return {
      property: field.field,
      label: field.label ?? field.field,
      control,
      value_type: field.value_type,
      unit: field.unit,
      values: control === 'range' ? [] : values.slice(0, maxValues),
      range:
        numeric && numbers.length > 0
          ? { min: Math.min(...numbers), max: Math.max(...numbers) }
          : null,
      entity_count: values.reduce((sum, entry) => sum + entry.count, 0),
    };
  });
}

function emptyFacets(fields: ReturnType<FieldMetadataRegistry['facetable']>): FacetResult[] {
  return fields.map((field) => ({
    property: field.field,
    label: field.label ?? field.field,
    control: field.filter?.type ?? 'none',
    value_type: field.value_type,
    unit: field.unit,
    values: [],
    range: null,
    entity_count: 0,
  }));
}
