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
 *
 * The other promise this module makes is that every line it hands back parses.
 * A record it cannot serialize is refused, loudly, rather than written out and
 * discovered by whoever tries to read the file — an unparseable line in a bulk
 * export is not a degraded row, it is a broken file.
 */

export type JsonlValue = string | number | boolean | null;

/** The four things a JSONL cell may be. `null` is one of them; nothing is not. */
const JSONL_SCALARS: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

/**
 * Serialize one record as a single JSON object line.
 *
 * A column missing from the record is an error, not an omitted key: a JSONL
 * reader building a dataframe from the first line would silently get a
 * different schema from the rest of the file.
 *
 * A column that is PRESENT and holds `undefined` is the same error wearing a
 * disguise, and it used to get through: `hasOwnProperty` is true for
 * `{ b: undefined }`, `JSON.stringify(undefined)` returns the JS value
 * `undefined` rather than a string, and the template literal below renders that
 * as the text "undefined". The line looks like a record — `{"a":1,"b":undefined}`
 * — and no JSON parser on earth will read it. A whole export file can be lost
 * to one such cell.
 *
 * It is refused rather than written as `null`, because in this contract `null`
 * is a VALUE. `manifest.files[].rows` explains why: a property whose every claim
 * was excluded still gets a row carrying a null, so that "we have nothing to say
 * about this" is stated rather than silently absent. Turning a hole in the
 * record into that statement would publish an assertion about the data on behalf
 * of a caller who never made one, which is the failure the null convention
 * exists to prevent. The caller has a defect; the export refuses (AGENTS.md
 * rule 1 — an export is publication, and a refusal is the only safe failure).
 *
 * The check is on the VALUE rather than on `undefined` alone because `JsonlValue`
 * arrives here through an `as` cast at every caller: a symbol or a function
 * serializes to the same non-value, and an object would serialize to a nested
 * document this flat row contract has no reader for.
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
    if (value !== null && !JSONL_SCALARS.has(typeof value)) {
      throw new TypeError(
        `jsonlRecord: column "${column}" is present but holds ${String(typeof value)}, which JSON ` +
          'has no representation for. Use null to publish "no value"; an absent value is a defect ' +
          'in the row, and writing it would emit a line no reader can parse.',
      );
    }
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
