import type { ExtractorVersion } from '@data-foundry/canonical-schema';
import { parse } from 'csv-parse/sync';
import {
  lineRangeLocator,
  tableCellLocator,
  tableCellsLocator,
  type EvidenceLocator,
} from '../locator.js';
import {
  applyExtractPattern,
  applyRecordKeyPolicy,
  buildRecord,
  type FieldOutcome,
} from '../record-builder.js';
import type { CsvRowFilter, ExtractionSchema, FieldRule } from '../schema.js';
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

    const columns = header === true ? true : header === false ? false : [...header];
    const text = artifactText(artifact);
    const parseOptions = {
      delimiter: options.delimiter ?? ',',
      skip_empty_lines: options.skip_empty_lines ?? true,
      from_line:
        options.skip_leading_lines_matching === undefined
          ? (options.from_line ?? 1)
          : Math.max(options.from_line ?? 1, firstUnmatchedLine(text, options.skip_leading_lines_matching)),
      quote: options.quote ?? '"',
      escape: options.escape ?? '"',
      trim: options.trim ?? false,
      bom: true,
      info: true,
      ...(artifact.maxRecords === undefined ? {} : { to: artifact.maxRecords + 1 }),
    };

    let rows: ParsedRow[];
    try {
      rows =
        columns === false
          ? // `csv-parse` types `info: true` only on its columns-enabled overload, so
            // positional parsing declares `string[][]`. The runtime still returns the
            // same `{ record, info }` envelope, which the headerless extraction tests
            // exercise end to end rather than leaving this cast unchecked.
            (parse(text, { ...parseOptions, columns }) as unknown as ParsedRow[])
          : parse<ParsedRow>(text, { ...parseOptions, columns });
    } catch (error) {
      throw new ExtractionError('artifact body is not parseable as delimited text', {
        artifactId: artifact.artifact.id,
        schemaId: schema.schema_id,
        cause: error,
      });
    }

    if (artifact.maxRecords !== undefined && rows.length > artifact.maxRecords) {
      throw new ExtractionError('INGESTION_RECORD_LIMIT');
    }
    const where = options.where;
    const records = rows.flatMap((row, ordinal) => {
      const line = typeof row.info.lines === 'number' ? row.info.lines : ordinal + 1;
      // `info.columns` is a descriptor array when a header is in play and a
      // plain count when the file is positional.
      const columnNames = Array.isArray(row.info.columns)
        ? row.info.columns.map((column) => column.name)
        : [];
      // The declared row filter runs before field extraction. The ordinal
      // stays the row's position in the file so excluding a row never
      // renumbers the records around it.
      if (where !== undefined && !rowMatches(row.record, columnNames, where)) {
        if (!columnNames.includes(where.column)) {
          throw new ExtractionError(
            `record filter column ${where.column} is not present in the header [${columnNames.join(', ')}]`,
            { artifactId: artifact.artifact.id, schemaId: schema.schema_id },
          );
        }
        return [];
      }
      return [buildRecord({
        schema,
        artifact: artifact.artifact,
        ordinal,
        record_locator: lineRangeLocator(line, line),
        outcomes: schema.fields.map((rule) => readField(row.record, columnNames, line, rule)),
      })];
    });

    return Promise.resolve(applyRecordKeyPolicy(schema, records));
  }
}

/** 1-based number of the first line that does not match `pattern` (a leading preamble filter). */
function firstUnmatchedLine(text: string, pattern: string): number {
  const regex = new RegExp(pattern);
  const breaks = /\r\n|\r|\n/g;
  let line = 1;
  let start = 0;
  for (;;) {
    const found = breaks.exec(text);
    const end = found === null ? text.length : found.index;
    if (!regex.test(text.slice(start, end))) return line;
    if (found === null) return line + 1;
    start = breaks.lastIndex;
    line += 1;
  }
}

export const createCsvExtractor = (version?: ExtractorVersion): ExtractionProvider =>
  version === undefined ? new CsvExtractor() : new CsvExtractor(version);

function rowMatches(
  record: Record<string, string> | readonly string[],
  columnNames: readonly string[],
  where: CsvRowFilter,
): boolean {
  const index = columnNames.indexOf(where.column);
  if (index < 0) return false;
  const raw = Array.isArray(record)
    ? (record as readonly string[])[index]
    : (record as Record<string, string>)[where.column];
  return raw !== undefined && where.in.includes(raw);
}

interface ParsedRow {
  readonly record: Record<string, string> | readonly string[];
  readonly info: {
    readonly lines?: number;
    /** Descriptors when `columns` is on; `false` or a column *count* when positional. */
    readonly columns?: ReadonlyArray<{ readonly name: string }> | number | false;
  };
}

function readField(
  record: Record<string, string> | readonly string[],
  columnNames: readonly string[],
  line: number,
  rule: FieldRule,
): FieldOutcome {
  const selector = rule.locate;

  if (selector.kind === 'csv_columns') return readCompositeField(record, columnNames, line, rule, selector);

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

/**
 * `csv_columns`: one value assembled from several cells of the same row.
 *
 * All-or-nothing. A composite identity missing one of its parts names a
 * different (and usually non-existent) thing, so any absent or empty part makes
 * the whole field absent rather than joining what remains. An unknown column is
 * a configuration failure, exactly as for `csv_column`. The declared `extract`
 * pattern, when present, applies to the joined value.
 */
function readCompositeField(
  record: Record<string, string> | readonly string[],
  columnNames: readonly string[],
  line: number,
  rule: FieldRule,
  selector: { readonly columns: readonly string[]; readonly separator: string },
): FieldOutcome {
  const indexes = selector.columns.map((column) => columnNames.indexOf(column));
  const locator = tableCellsLocator(line, selector.columns, indexes);
  const unknown = selector.columns.filter((_, position) => (indexes[position] ?? -1) < 0);
  if (unknown.length > 0) {
    return {
      field: rule.field,
      raw: null,
      locator,
      match_count: 0,
      failure: {
        code: 'UNKNOWN_COLUMN',
        message: `column(s) ${unknown.join(', ')} are not present in the header [${columnNames.join(', ')}]`,
      },
    };
  }

  const parts: string[] = [];
  for (const [position, column] of selector.columns.entries()) {
    const raw = Array.isArray(record)
      ? (record as readonly string[])[indexes[position] ?? -1]
      : (record as Record<string, string>)[column];
    const part = raw?.trim() ?? '';
    if (part === '') return { field: rule.field, raw: null, locator, match_count: 0 };
    parts.push(part);
  }
  const joined = parts.join(selector.separator);

  if (rule.extract !== undefined) {
    const extracted = applyExtractPattern(joined, rule.extract);
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
  return { field: rule.field, raw: joined, locator, match_count: 1 };
}
