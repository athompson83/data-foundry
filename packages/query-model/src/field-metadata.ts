/**
 * Doc 04 — "Filter metadata".
 *
 * ```yaml
 * field: voltage
 * value_type: number
 * unit: V
 * filter:
 *   type: multi_select
 *   facet_count: true
 * sort: true
 * search_boost: 0.4
 * indexable: true
 * ```
 *
 * Facets, filters, sorting and search boosts are *derived from this metadata*,
 * never hard-coded per vertical. That is AGENTS.md rule 4 at the query layer: a
 * new vertical adds field descriptors, it does not add a branch to the search
 * code. A filter on a property with no metadata, or with `filter.type: none`,
 * is rejected rather than silently ignored — a filter the user set and the
 * system quietly dropped is worse than an error.
 */
import { z } from 'zod';
import {
  FactValueTypeSchema,
  IdentifierSchema,
  type FactValueType,
  type Identifier,
} from '@data-foundry/canonical-schema';

export const FILTER_CONTROL_TYPES = [
  'multi_select',
  'single_select',
  'range',
  'boolean',
  'text',
  'none',
] as const;
export const FilterControlTypeSchema = z.enum(FILTER_CONTROL_TYPES);
export type FilterControlType = z.infer<typeof FilterControlTypeSchema>;

export const FieldFilterSchema = z.object({
  type: FilterControlTypeSchema,
  /** Emit facet counts for this field on search responses. */
  facet_count: z.boolean().default(false),
  /** Cap on distinct facet values returned. */
  max_values: z.number().int().min(1).max(1000).default(50),
});
export type FieldFilter = z.infer<typeof FieldFilterSchema>;

export const FieldMetadataSchema = z.object({
  field: IdentifierSchema,
  value_type: FactValueTypeSchema,
  unit: z.string().min(1).max(40).nullable().default(null),
  filter: FieldFilterSchema.nullable().default(null),
  sort: z.boolean().default(false),
  /** Relative weight when this field's values match a text query. 0 disables. */
  search_boost: z.number().min(0).max(1).default(0),
  /** Whether the field may appear on indexable public surfaces. */
  indexable: z.boolean().default(true),
  label: z.string().min(1).max(200).nullable().default(null),
});
export type FieldMetadata = z.infer<typeof FieldMetadataSchema>;
export type FieldMetadataInput = z.input<typeof FieldMetadataSchema>;

export class UnknownFieldError extends Error {
  override readonly name = 'UnknownFieldError';
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`Unknown or non-filterable field "${field}": ${detail}`);
    this.field = field;
  }
}

const NUMERIC_VALUE_TYPES: readonly FactValueType[] = ['number', 'integer', 'quantity'];

/**
 * The set of field descriptors for one vertical. Everything the query layer
 * knows about filtering, faceting, sorting and boosting comes from here.
 */
export class FieldMetadataRegistry {
  private readonly byField: ReadonlyMap<Identifier, FieldMetadata>;

  constructor(fields: readonly FieldMetadataInput[]) {
    const parsed = fields.map((field) => FieldMetadataSchema.parse(field));
    this.byField = new Map(parsed.map((field) => [field.field, field] as const));
  }

  static empty(): FieldMetadataRegistry {
    return new FieldMetadataRegistry([]);
  }

  get size(): number {
    return this.byField.size;
  }

  all(): FieldMetadata[] {
    return [...this.byField.values()];
  }

  get(field: Identifier): FieldMetadata | null {
    return this.byField.get(field) ?? null;
  }

  /** Throws rather than silently dropping a filter the caller asked for. */
  require(field: Identifier): FieldMetadata {
    const metadata = this.byField.get(field);
    if (metadata === undefined) {
      throw new UnknownFieldError(field, 'no field metadata is declared for this vertical');
    }
    if (metadata.filter === null || metadata.filter.type === 'none') {
      throw new UnknownFieldError(field, 'the field declares no filter behaviour');
    }
    return metadata;
  }

  /** Fields that should produce facet counts, in declaration order. */
  facetable(): FieldMetadata[] {
    return this.all().filter(
      (field) => field.filter !== null && field.filter.type !== 'none' && field.filter.facet_count,
    );
  }

  sortable(): FieldMetadata[] {
    return this.all().filter((field) => field.sort);
  }

  /** Fields whose values contribute to text ranking, strongest first. */
  boosted(): FieldMetadata[] {
    return this.all()
      .filter((field) => field.search_boost > 0 && field.indexable)
      .sort((left, right) => right.search_boost - left.search_boost);
  }

  isNumeric(field: Identifier): boolean {
    const metadata = this.byField.get(field);
    return metadata !== undefined && NUMERIC_VALUE_TYPES.includes(metadata.value_type);
  }
}

/** Facet filters accepted by search. Validated against the registry. */
export type FacetFilter =
  | { readonly property: Identifier; readonly op: 'in'; readonly values: readonly (string | number | boolean)[] }
  | { readonly property: Identifier; readonly op: 'range'; readonly min: number | null; readonly max: number | null }
  | { readonly property: Identifier; readonly op: 'exists' };

export interface FacetValueCount {
  readonly value: string;
  readonly count: number;
}

export interface FacetResult {
  readonly property: Identifier;
  readonly label: string;
  readonly control: FilterControlType;
  readonly value_type: FactValueType;
  readonly unit: string | null;
  readonly values: readonly FacetValueCount[];
  readonly range: { readonly min: number; readonly max: number } | null;
  readonly entity_count: number;
}

export const isNumericValueType = (valueType: FactValueType): boolean =>
  NUMERIC_VALUE_TYPES.includes(valueType);
