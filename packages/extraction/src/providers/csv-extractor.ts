import type { ExtractorVersion } from '@data-foundry/canonical-schema';
import { parse } from 'csv-parse/sync';
import { lineRangeLocator, tableCellLocator, type EvidenceLocator } from '../locator.js';
import {
  applyExtractPattern,
  applyRecordKeyPolicy,
  buildRecord,
  type FieldOutcome,
} from '../record-builder.js';
import type { ExtractionSchema, FieldRule } from '../schema.js';
import {
  ExtractionError,
  artifactText,
  type ExtractedRecord,
  type ExtractionArtifact,
  type ExtractionProvider,
} from '../types.js';

/**
 * Delimited-file extractor built on `csv-parse`.
 *
 * Locators are `TABLE_CELL` with the 1-based **physical line** of the row (not
 * the record ordinal — a quoted field can span lines, and provenance needs the
 * line a human would find in the file) plus the header name and column index.
 */
export class CsvExtractor implements ExtractionProvider {
  readonly name = 'csv-extractor';
  readonly format = 'csv' as const;
  readonly version: ExtractorVersion;

  constructor(version: ExtractorVersion = 'csv-extractor@1.0.0') {
    this.version = version;
  }

  supports(schema: ExtractionSchema): boolean {
    return schema.format === 'csv';
  }

  extract(artifact: ExtractionArtifact, schema: ExtractionSchema): Promise<ExtractedRecord[]> {
    if (!this.supports(schema)) {
      throw new ExtractionError(`CsvExtractor cannot handle format ${schema.format}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    const selector = schema.record;
    if (selector.kind !== 'csv_rows' && selector.kind !== 'whole_document') {
      throw new ExtractionError(`CsvExtractor cannot handle record selector ${selector.kind}`, {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
      });
    }

    const options = selector.kind === 'csv_rows' ? selector : { kind: 'csv_rows' as const };
    const header = options.header ?? true;

    let rows: ParsedRow[];
    try {
      rows = parse(artifactText(artifact), {
        columns: header === true ? true : header === false ? false : [...header],
        delimiter: options.delimiter ?? ',',
        skip_empty_lines: options.skip_empty_lines ?? true,
        from_line: options.from_line ?? 1,
        quote: options.quote ?? '"',
        escape: options.escape ?? '"',
        trim: options.trim ?? false,
        bom: true,
        info: true,
      }) as ParsedRow[];
    } catch (error) {
      throw new ExtractionError('artifact body is not parseable as delimited text', {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
        cause: error,
      });
    }

    const records = rows.map((row, ordinal) => {
      const line = typeof row.info.lines === 'number' ? row.info.lines : ordinal + 1;
      // `info.columns` is a descriptor array when a header is in play and a
      // plain count when the file is positional.
      const columnNames = Array.isArray(row.info.columns)
        ? row.info.columns.map((column) => column.name)
        : [];
      return buildRecord({
        schema,
        artifact: artifact.artifact,
        ordinal,
        record_locator: lineRangeLocator(line, line),
        outcomes: schema.fields.map((rule) => readField(row.record, columnNames, line, rule)),
      });
    });

    return Promise.resolve(applyRecordKeyPolicy(schema, records));
  }
}

export const createCsvExtractor = (version?: ExtractorVersion): ExtractionProvider =>
  version === undefined ? new CsvExtractor() : new CsvExtractor(version);

interface ParsedRow {
  readonly record: Record<string, string> | readonly string[];
  readonly info: {
    readonly lines?: number;
    /** Descriptors when `columns` is on; a column *count* when the file is positional. */
    readonly columns?: ReadonlyArray<{ readonly name: string }> | number;
  };
}

function readField(
  record: Record<string, string> | readonly string[],
  columnNames: readonly string[],
  line: number,
  rule: FieldRule,
): FieldOutcome {
  const selector = rule.locate;

  let columnName: string;
  let columnIndex: number;
  let raw: string | undefined;

  if (selector.kind === 'csv_column') {
    columnName = selector.column;
    columnIndex = columnNames.indexOf(selector.column);
    if (Array.isArray(record)) {
      raw = columnIndex >= 0 ? (record as readonly string[])[columnIndex] : undefined;
    } else {
      const asObject = record as Record<string, string>;
      raw = Object.prototype.hasOwnProperty.call(asObject, selector.column)
        ? asObject[selector.column]
        : undefined;
    }
    if (columnIndex < 0 && raw === undefined) {
      return {
        field: rule.field,
        raw: null,
        locator: tableCellLocator(line, columnName, -1),
        match_count: 0,
        failure: {
          code: 'UNKNOWN_COLUMN',
          message: `column ${selector.column} is not present in the header [${columnNames.join(', ')}]`,
        },
      };
    }
  } else if (selector.kind === 'csv_index') {
    columnIndex = selector.index;
    columnName = columnNames[selector.index] ?? `#${selector.index}`;
    if (Array.isArray(record)) {
      raw = (record as readonly string[])[selector.index];
    } else {
      const key = columnNames[selector.index];
      raw = key === undefined ? undefined : (record as Record<string, string>)[key];
    }
  } else {
    return {
      field: rule.field,
      raw: null,
      locator: lineRangeLocator(line, line),
      match_count: 0,
      failure: {
        code: 'FIELD_PARSE_FAILURE',
        message: `CsvExtractor cannot handle field selector ${selector.kind}`,
      },
    };
  }

  const locator: EvidenceLocator = tableCellLocator(line, columnName, columnIndex);

  // A CSV cell is a single cell: there is exactly one address per (row, column),
  // so `match_count` is 0 or 1 and CSV values are never ambiguous.
  if (raw === undefined || raw === '') {
    return { field: rule.field, raw: null, locator, match_count: 0 };
  }

  if (rule.extract !== undefined) {
    const extracted = applyExtractPattern(raw, rule.extract);
    if (!extracted.ok) {
      return {
        field: rule.field,
        raw: null,
        locator,
        match_count: 1,
        failure: { code: 'FIELD_PARSE_FAILURE', message: extracted.message },
      };
    }
    return { field: rule.field, raw: extracted.value, locator, match_count: 1 };
  }

  return { field: rule.field, raw, locator, match_count: 1 };
}
