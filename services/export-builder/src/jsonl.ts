/**
 * JSONL — one JSON object per line, LF-terminated.
 *
 * AGENTS.md lists JSONL as the AI-friendly bulk format and Parquet as the
 * analytical one. Parquet is deliberately out of scope here: it needs a
 * columnar encoder, and this service ships with no new dependencies.
 *
 * Keys are emitted in the declared column order rather than whatever order the
 * row object happens to carry, so the bytes are a function of the column
 * contract plus the data. That is the same determinism argument as
 * `stableJson`, expressed for a shape whose field order is part of its
 * published contract.
 */

export type JsonlValue = string | number | boolean | null;

/**
 * Serialize one record as a single JSON object line.
 *
 * A column missing from the record is an error, not an omitted key: a JSONL
 * reader building a dataframe from the first line would silently get a
 * different schema from the rest of the file.
 */
export function jsonlRecord(
  columns: readonly string[],
  record: Readonly<Record<string, JsonlValue>>,
): string {
  const parts: string[] = [];
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(record, column)) {
      throw new TypeError(`jsonlRecord: column "${column}" is missing from the record.`);
    }
    const value = record[column] as JsonlValue;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`jsonlRecord: column "${column}" is ${String(value)}, which JSON cannot carry.`);
    }
    parts.push(`${JSON.stringify(column)}:${JSON.stringify(value)}`);
  }
  return `{${parts.join(',')}}`;
}

export function jsonlDocument(
  columns: readonly string[],
  records: readonly Readonly<Record<string, JsonlValue>>[],
): string {
  return records.map((record) => `${jsonlRecord(columns, record)}\n`).join('');
}
