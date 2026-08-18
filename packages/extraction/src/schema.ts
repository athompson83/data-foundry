import type { Identifier } from '@data-foundry/canonical-schema';
import type { ExtractionFormat } from './types.js';

/**
 * Extraction is schema-driven and declarative.
 *
 * Everything in this file is **data**. A source's extraction rules are a JSON /
 * YAML document that a vertical ships in its config package; onboarding a new
 * source of an already-supported format must require zero new TypeScript
 * (AGENTS.md rule 4, "no vertical-specific forks of the app"). If you find
 * yourself wanting to add a `case` to a provider for one source, add a
 * declarative selector kind instead — or accept that the source needs a genuinely
 * new *format* provider.
 */

/** How to find the repeating record scope inside an artifact. */
export type RecordSelector =
  /** The artifact is exactly one record. */
  | { readonly kind: 'whole_document' }
  /**
   * JSON only. Points at an array (one record per element) or an object (one
   * record). `''` is the document root.
   */
  | { readonly kind: 'json_pointer'; readonly pointer: string }
  /** CSV only. One record per data row. */
  | {
      readonly kind: 'csv_rows';
      readonly delimiter?: string;
      /** `true` reads names from row 1, an array supplies them, `false` means positional only. */
      readonly header?: boolean | readonly string[];
      readonly skip_empty_lines?: boolean;
      /** 1-based physical line to start reading from. */
      readonly from_line?: number;
      readonly quote?: string;
      readonly escape?: string;
      readonly trim?: boolean;
    }
  /** HTML only. One record per matched element. */
  | { readonly kind: 'css'; readonly selector: string }
  /** PDF only. One record per page. */
  | { readonly kind: 'pdf_pages' };

/** Text matching mode shared by the label-driven selectors. */
export const LABEL_MATCH_MODES = ['exact', 'contains', 'prefix'] as const;
export type LabelMatchMode = (typeof LABEL_MATCH_MODES)[number];

/** How to find one field inside a record scope. All variants are pure data. */
export type FieldSelector =
  | { readonly kind: 'json_pointer'; readonly pointer: string }
  /** Segment path with `*` wildcards, e.g. `['specs', '*', 'value']`. */
  | { readonly kind: 'json_path'; readonly path: readonly string[] }
  | { readonly kind: 'csv_column'; readonly column: string }
  | { readonly kind: 'csv_index'; readonly index: number }
  | { readonly kind: 'css'; readonly selector: string; readonly attribute?: string }
  /**
   * Table-aware: finds the row whose label cell matches, returns the value cell.
   * Handles the `<th>Cooling Capacity</th><td>36,000 BTU/h</td>` spec tables that
   * make up most manufacturer pages.
   */
  | {
      readonly kind: 'html_table_label';
      readonly label: string;
      readonly match?: LabelMatchMode;
      readonly row_selector?: string;
      readonly label_selector?: string;
      readonly value_selector?: string;
    }
  /** Definition-list aware: `<dt>Refrigerant</dt><dd>R-410A</dd>`. */
  | {
      readonly kind: 'html_definition_list';
      readonly term: string;
      readonly match?: LabelMatchMode;
      readonly list_selector?: string;
    }
  /** PDF: `SEER2: 15.2` style label/value lines in the text layer. */
  | {
      readonly kind: 'pdf_label';
      readonly label: string;
      readonly match?: LabelMatchMode;
      /** Characters allowed between label and value. Default `:` `-` `–` `=` and whitespace. */
      readonly separator?: string;
    }
  | {
      readonly kind: 'pdf_regex';
      readonly pattern: string;
      readonly flags?: string;
      readonly group?: number;
    };

export const ON_MULTIPLE_POLICIES = ['first', 'last', 'join', 'fail'] as const;
export type OnMultiplePolicy = (typeof ON_MULTIPLE_POLICIES)[number];

/** A regex applied to the selected raw text to carve a substring out of it. */
export interface ExtractPattern {
  readonly pattern: string;
  readonly flags?: string;
  readonly group?: number;
}

export interface FieldRule {
  readonly field: Identifier;
  readonly locate: FieldSelector;
  /** Missing required fields cap `extraction_confidence` and raise an issue. */
  readonly required?: boolean;
  /** Default `first`; the value is still flagged `ambiguous` when >1 matched. */
  readonly on_multiple?: OnMultiplePolicy;
  readonly join_separator?: string;
  readonly extract?: ExtractPattern;
}

export interface RecordKeyRule {
  /** Fields whose raw values compose the source-native business key. */
  readonly fields: readonly Identifier[];
  readonly separator?: string;
  /**
   * `ordinal` falls back to the record's position in the artifact when a key
   * field is missing (and raises `RECORD_KEY_INCOMPLETE`); `fail` drops the
   * record instead. Never silently emits a partial key.
   */
  readonly fallback?: 'ordinal' | 'fail';
}

/** Tunables for `computeExtractionConfidence`. Every default is documented there. */
export interface ConfidencePolicy {
  readonly required_weight?: number;
  readonly optional_weight?: number;
  readonly parse_failure_penalty?: number;
  readonly ambiguity_penalty?: number;
  readonly missing_required_ceiling?: number;
  readonly floor?: number;
  readonly ceiling?: number;
}

export interface ExtractionSchema {
  readonly schema_id: string;
  readonly format: ExtractionFormat;
  /** Source-native entity type, e.g. `equipment_model`. Not a canonical entity. */
  readonly entity_type: Identifier;
  readonly record: RecordSelector;
  readonly record_key: RecordKeyRule;
  readonly fields: readonly FieldRule[];
  readonly confidence?: ConfidencePolicy;
}

/** Raised when a mapping config is structurally invalid. */
export class ExtractionSchemaError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'ExtractionSchemaError';
    this.path = path;
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const RECORD_SELECTOR_FORMATS: Readonly<Record<RecordSelector['kind'], readonly ExtractionFormat[]>> =
  {
    whole_document: ['json', 'csv', 'html', 'pdf'],
    json_pointer: ['json'],
    csv_rows: ['csv'],
    css: ['html'],
    pdf_pages: ['pdf'],
  };

const FIELD_SELECTOR_FORMATS: Readonly<Record<FieldSelector['kind'], ExtractionFormat>> = {
  json_pointer: 'json',
  json_path: 'json',
  csv_column: 'csv',
  csv_index: 'csv',
  css: 'html',
  html_table_label: 'html',
  html_definition_list: 'html',
  pdf_label: 'pdf',
  pdf_regex: 'pdf',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates a mapping config loaded from vertical configuration.
 *
 * Deliberately hand-rolled rather than zod-in-this-package: extraction depends on
 * `canonical-schema` for the object model and nothing else, and a config error
 * should name the exact path a human must fix.
 */
export function parseExtractionSchema(input: unknown, path = 'schema'): ExtractionSchema {
  if (!isRecord(input)) throw new ExtractionSchemaError('must be an object', path);

  const schemaId = input['schema_id'];
  if (typeof schemaId !== 'string' || schemaId.length === 0) {
    throw new ExtractionSchemaError('schema_id must be a non-empty string', path);
  }

  const format = input['format'];
  if (
    typeof format !== 'string' ||
    !(['json', 'csv', 'html', 'pdf'] as readonly string[]).includes(format)
  ) {
    throw new ExtractionSchemaError('format must be one of json|csv|html|pdf', `${path}.format`);
  }
  const extractionFormat = format as ExtractionFormat;

  const entityType = input['entity_type'];
  if (typeof entityType !== 'string' || !IDENTIFIER_PATTERN.test(entityType)) {
    throw new ExtractionSchemaError(
      'entity_type must be a lowercase snake_case identifier',
      `${path}.entity_type`,
    );
  }

  const record = input['record'];
  if (!isRecord(record) || typeof record['kind'] !== 'string') {
    throw new ExtractionSchemaError('record must be an object with a kind', `${path}.record`);
  }
  const recordKind = record['kind'] as RecordSelector['kind'];
  const allowedFormats = RECORD_SELECTOR_FORMATS[recordKind];
  if (allowedFormats === undefined) {
    throw new ExtractionSchemaError(`unknown record selector kind ${recordKind}`, `${path}.record`);
  }
  if (!allowedFormats.includes(extractionFormat)) {
    throw new ExtractionSchemaError(
      `record selector ${recordKind} is not valid for format ${extractionFormat}`,
      `${path}.record`,
    );
  }

  const recordKey = input['record_key'];
  if (!isRecord(recordKey) || !Array.isArray(recordKey['fields'])) {
    throw new ExtractionSchemaError(
      'record_key.fields must be an array of field names',
      `${path}.record_key`,
    );
  }

  const fields = input['fields'];
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new ExtractionSchemaError('fields must be a non-empty array', `${path}.fields`);
  }

  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const fieldPath = `${path}.fields[${index}]`;
    if (!isRecord(field)) throw new ExtractionSchemaError('must be an object', fieldPath);
    const name = field['field'];
    if (typeof name !== 'string' || !IDENTIFIER_PATTERN.test(name)) {
      throw new ExtractionSchemaError(
        'field must be a lowercase snake_case identifier',
        `${fieldPath}.field`,
      );
    }
    if (seen.has(name)) throw new ExtractionSchemaError(`duplicate field ${name}`, fieldPath);
    seen.add(name);

    const locate = field['locate'];
    if (!isRecord(locate) || typeof locate['kind'] !== 'string') {
      throw new ExtractionSchemaError('locate must be an object with a kind', `${fieldPath}.locate`);
    }
    const selectorFormat = FIELD_SELECTOR_FORMATS[locate['kind'] as FieldSelector['kind']];
    if (selectorFormat === undefined) {
      throw new ExtractionSchemaError(
        `unknown field selector kind ${String(locate['kind'])}`,
        `${fieldPath}.locate`,
      );
    }
    if (selectorFormat !== extractionFormat) {
      throw new ExtractionSchemaError(
        `field selector ${String(locate['kind'])} is not valid for format ${extractionFormat}`,
        `${fieldPath}.locate`,
      );
    }
  });

  for (const keyField of recordKey['fields'] as readonly unknown[]) {
    if (typeof keyField !== 'string' || !seen.has(keyField)) {
      throw new ExtractionSchemaError(
        `record_key field ${String(keyField)} is not declared in fields`,
        `${path}.record_key`,
      );
    }
  }

  return input as unknown as ExtractionSchema;
}
