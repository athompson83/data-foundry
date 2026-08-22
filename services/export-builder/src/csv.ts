/**
 * RFC 4180 CSV, by hand and on purpose.
 *
 * The hard constraint for this service is no new dependencies, so this is Node
 * built-ins only — but a hand-rolled CSV writer is also where CSV exporters
 * actually break, so the rules are written down rather than assumed:
 *
 *   - A field is quoted when it contains `"`, the delimiter, CR or LF, when it
 *     has leading or trailing whitespace (a reader that trims would otherwise
 *     change the value), or when it is the empty string.
 *   - Inside a quoted field, `"` is doubled. That is the ONLY escape; there is
 *     no backslash escaping in CSV, and inventing one produces a file that
 *     every conforming reader misparses.
 *   - Embedded newlines stay embedded, inside the quotes. Stripping them
 *     silently edits the data; replacing them with a space silently edits it
 *     more politely.
 *   - Records end with CRLF, which is what RFC 4180 specifies. Readers that
 *     accept LF accept CRLF too; the reverse is not reliably true.
 *
 * A CSV FILE IS ALSO A PROGRAM, which RFC 4180 has nothing to say about. Excel,
 * LibreOffice and Sheets compile any cell whose first character is `=`, `+`,
 * `-`, `@`, a tab or a CR, and run it when the file is opened — so a supplier
 * or forum string like `=HYPERLINK("http://evil","click")`, arriving in a model
 * number we did not write, becomes a live formula in a customer's spreadsheet
 * (CWE-1236). Every such value is therefore prefixed with `CSV_FORMULA_ESCAPE`
 * so the cell is read as text. Three properties are load-bearing:
 *
 *   - Only a LEADING character counts. `24ANB7=A` is a model number, not a
 *     formula, and an escape that fired on a `=` anywhere in the value would
 *     rewrite ordinary catalogue data to guard against nothing.
 *   - The escape character escapes itself, the way RFC 4180 doubles `"`. Without
 *     that, `'96 vintage` and an escaped `96 vintage` are the same bytes and a
 *     consumer cannot tell which value it was handed; with it, "strip one
 *     leading `'`" recovers the original exactly, always.
 *   - The quoting decision is still made from the ORIGINAL value, so a value
 *     that needed no quotes does not acquire any. The prefix goes inside the
 *     quotes when there are quotes, which is where a field's first character
 *     lives as far as a reader is concerned.
 *
 * This is the one place where the CSV file deliberately does not carry the same
 * string as the JSONL file. A negative number rendered as text (`-13`) is
 * prefixed too: `-1+1+cmd|' /C calc'!A0` is also a formula that starts with a
 * minus, and no rule that tries to tell those apart can be safer than the
 * spreadsheet's own parser. `value_type` still says the column is numeric and
 * `facts.jsonl` still carries the unescaped value, which is what the lossless
 * form is for. `EXPORT_CONTRACT_VERSION` names the encoding a consumer pins.
 *
 * NULL vs EMPTY STRING is a real distinction in this dataset — a fact with no
 * unit and a fact whose unit is the empty string are different states — and CSV
 * has no null. The encoding chosen here is the conventional one: `null` is an
 * *unquoted empty* field, the empty string is a *quoted empty* field (`""`).
 * That round-trips through a conforming reader that distinguishes them, and
 * degrades to "both look empty" in one that does not, which is the failure
 * everyone already expects from CSV. `manifest.files[].format` records that
 * this file is CSV so a consumer knows to expect it; JSONL is the lossless
 * form and exists alongside for consumers that need it.
 */

export const CSV_DELIMITER = ',';
/** RFC 4180 §2.1: records are separated by CRLF. */
export const CSV_RECORD_SEPARATOR = '\r\n';

/** Scalars only — the export row contract is flat by construction. */
export type CsvValue = string | number | boolean | null;

const NEEDS_QUOTING = /["\r\n,]/;
const EDGE_WHITESPACE = /^\s|\s$/;

/**
 * The prefix that tells a spreadsheet the cell is text.
 *
 * Exported because it is part of the published encoding: a consumer strips one
 * of these from the front of a cell to recover the value, and a consumer that
 * has to guess the character has not been told the contract.
 */
export const CSV_FORMULA_ESCAPE = "'";

/**
 * Leading characters that make a cell executable, plus the escape itself.
 *
 * `=` and `@` open a formula, `+` and `-` open one in the numeric forms Excel
 * accepts, and a leading tab or CR is stripped by the spreadsheet before it
 * decides — so `\t=1+1` is `=1+1` by the time anything looks at it. The escape
 * character is in the set so that escaping is reversible rather than merely
 * safe.
 */
const NEEDS_FORMULA_ESCAPE = /^['=+\-@\t\r]/;

/** Render one scalar as one CSV field. */
export function csvField(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `csvField: ${String(value)} has no CSV representation. A non-finite number in an export ` +
          'is a data defect, and writing "NaN" into a numeric column hides it.',
      );
    }
    return String(value);
  }
  // Quoting is decided from the value as it arrived: the escape is not a
  // quoting trigger, and asking the escaped text would be asking about a
  // character this writer just added.
  const quote = value === '' || NEEDS_QUOTING.test(value) || EDGE_WHITESPACE.test(value);
  const text = NEEDS_FORMULA_ESCAPE.test(value) ? `${CSV_FORMULA_ESCAPE}${value}` : value;
  return quote ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRecord(values: readonly CsvValue[]): string {
  return values.map(csvField).join(CSV_DELIMITER);
}

/**
 * A whole CSV document, header first, every record CRLF-terminated (including
 * the last — a trailing separator is permitted by RFC 4180 §2.2 and makes
 * `wc -l` agree with the row count).
 */
export function csvDocument(
  header: readonly string[],
  records: readonly (readonly CsvValue[])[],
): string {
  const lines = [csvRecord(header), ...records.map(csvRecord)];
  return lines.map((line) => `${line}${CSV_RECORD_SEPARATOR}`).join('');
}
