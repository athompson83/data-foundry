/**
 * CSV escaping, which is where CSV exporters actually break.
 *
 * The failure is never "the writer crashed". It is that a value containing a
 * comma silently becomes two columns, a value containing a newline silently
 * becomes two rows, and the file still parses — so the corruption is invisible
 * until a customer's row counts disagree with the manifest's.
 *
 * These tests therefore do not assert on the emitted string alone. They parse
 * the output back with a conforming RFC 4180 reader written from the
 * specification in `csv-reader.ts`, and assert that what comes back is what went
 * in. A writer that only satisfies assertions about its own output format is
 * being marked by itself.
 */
import { describe, expect, it } from 'vitest';
import {
  CSV_FORMULA_ESCAPE,
  CSV_RECORD_SEPARATOR,
  csvDocument,
  csvField,
  csvRecord,
  type CsvValue,
} from '../src/csv.js';
import { parseCsv, type Cell } from './csv-reader.js';

describe('the RFC 4180 reader these tests check against', () => {
  it('reads a plain document', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('distinguishes a quoted empty field from an unquoted one', () => {
    expect(parseCsv('"",\r\n')).toEqual([['', null]]);
  });
});

describe('csvField quotes exactly what has to be quoted', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('R-454B')).toBe('R-454B');
  });

  it('quotes an embedded delimiter', () => {
    expect(csvField('Parts, labor')).toBe('"Parts, labor"');
  });

  it('doubles an embedded double quote, and quotes the field', () => {
    expect(csvField('labor "included"')).toBe('"labor ""included"""');
  });

  it('quotes an embedded LF and keeps the newline inside the field', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes an embedded CRLF without splitting the record', () => {
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  it('quotes edge whitespace, which a trimming reader would otherwise eat', () => {
    expect(csvField(' padded ')).toBe('" padded "');
  });

  it('writes null as an unquoted empty field and "" as a quoted one', () => {
    expect(csvField(null)).toBe('');
    expect(csvField('')).toBe('""');
  });

  it('writes booleans and numbers without locale involvement', () => {
    expect(csvField(true)).toBe('true');
    expect(csvField(false)).toBe('false');
    expect(csvField(16)).toBe('16');
    expect(csvField(15.2)).toBe('15.2');
    expect(csvField(-0.5)).toBe('-0.5');
  });

  it('refuses a non-finite number rather than writing "NaN" into a numeric column', () => {
    expect(() => csvField(Number.NaN)).toThrow(TypeError);
    expect(() => csvField(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('a whole document round-trips through a conforming reader', () => {
  const header = ['property', 'value', 'unit', 'flag'] as const;
  const records: readonly (readonly CsvValue[])[] = [
    ['warranty_terms', 'Parts, labor "included"\r\n10 years, registered', null, true],
    ['refrigerant', 'R-454B', null, false],
    ['note', '', ' padded ', false],
    ['weird', 'ends with a quote"', 'a,b', true],
    ['newline_only', 'first\nsecond', null, false],
  ];

  it('gives back every field exactly as it went in', () => {
    const text = csvDocument([...header], records);
    const parsed = parseCsv(text);

    expect(parsed[0]).toEqual([...header]);
    expect(parsed).toHaveLength(records.length + 1);

    records.forEach((record, index) => {
      const row = parsed[index + 1];
      expect(row, `record ${index} is present`).toBeDefined();
      const expected = record.map((value) =>
        value === null ? null : typeof value === 'boolean' ? String(value) : String(value),
      );
      expect(row).toEqual(expected);
    });
  });

  it('keeps one record per row even when a field contains newlines', () => {
    const text = csvDocument([...header], records);
    // Naively splitting on newlines finds more "lines" than there are records —
    // which is exactly why the reader, not a split, is the check.
    expect(text.split('\n').length).toBeGreaterThan(records.length + 2);
    expect(parseCsv(text)).toHaveLength(records.length + 1);
  });

  it('terminates every record with CRLF, including the last', () => {
    const text = csvDocument(['a'], [['1']]);
    expect(text).toBe(`a${CSV_RECORD_SEPARATOR}1${CSV_RECORD_SEPARATOR}`);
    expect(text.endsWith(CSV_RECORD_SEPARATOR)).toBe(true);
  });

  it('emits a header-only document for an empty record set', () => {
    expect(csvDocument(['a', 'b'], [])).toBe(`a,b${CSV_RECORD_SEPARATOR}`);
  });
});

describe('the failure a naive writer produces', () => {
  const value = 'Parts, labor';

  it('shows what dropping the quoting would cost: one field becomes two', () => {
    // A writer that just joined the values would emit this. It parses cleanly
    // and is wrong, which is the whole problem.
    expect(parseCsv(`${value}\r\n`)[0]).toEqual(['Parts', ' labor']);
  });

  it('and what the real writer emits instead: one field, unchanged', () => {
    expect(parseCsv(`${csvRecord([value])}\r\n`)[0]).toEqual([value]);
  });
});

/**
 * CWE-1236. A cell is not just text once a spreadsheet opens the file: a value
 * whose first character is `=`, `+`, `-`, `@`, a tab or a CR is compiled and
 * run. The strings in this export come from suppliers and forums, so the
 * attacker writes the cell.
 *
 * These tests read the escape back through the same conforming reader the rest
 * of this file uses, then strip the one documented prefix character, and assert
 * the ORIGINAL value comes back. An escape that made a cell inert but lost the
 * value would be a different bug wearing the fix's clothes.
 */
describe('a cell cannot smuggle a formula into a spreadsheet', () => {
  /** The rule a consumer applies: strip one leading escape character, once. */
  const recover = (cell: Cell): Cell =>
    cell !== null && cell.startsWith(CSV_FORMULA_ESCAPE) ? cell.slice(1) : cell;

  const FORMULAS = [
    '=HYPERLINK("http://evil.example","click")',
    '=1+1',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\t=1+1',
    '\r=1+1',
  ] as const;

  it('prefixes every leading character a spreadsheet would compile', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+1+1')).toBe("'+1+1");
    expect(csvField('-1+1')).toBe("'-1+1");
    expect(csvField('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
  });

  it('leaves a value that merely contains one alone', () => {
    // A model number is not a formula. An escape that fired on a `=` anywhere
    // in the value would rewrite ordinary catalogue data.
    expect(csvField('24ANB7=A')).toBe('24ANB7=A');
    expect(csvField('R-454B')).toBe('R-454B');
    expect(csvField('sales@example.com')).toBe('sales@example.com');
    expect(csvField('16')).toBe('16');
    expect(csvField('Parts, labor')).toBe('"Parts, labor"');
  });

  it('escapes its own escape character, so stripping it is reversible', () => {
    // Without this, `'96 vintage` and an escaped `96 vintage` are the same
    // bytes and a consumer cannot tell which value it was handed.
    expect(csvField("'96 vintage")).toBe("''96 vintage");
  });

  it('escapes inside the quotes rather than fighting the quoting rules', () => {
    // A formula that also needs quoting gets both, in the order a reader
    // expects: the quotes delimit the field, the escape is the first character
    // OF the field.
    expect(csvField('=1,2')).toBe(`"'=1,2"`);
    expect(csvField('=say "hi"')).toBe(`"'=say ""hi"""`);
    expect(csvField('\t=1+1')).toBe(`"'\t=1+1"`);
    expect(csvField('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('makes every formula inert and still gives the value back', () => {
    const text = csvDocument(
      ['property', 'value'],
      FORMULAS.map((formula) => ['model_alias', formula] as const),
    );
    const parsed = parseCsv(text);
    expect(parsed).toHaveLength(FORMULAS.length + 1);

    FORMULAS.forEach((formula, index) => {
      const cell = parsed[index + 1]?.[1];
      expect(cell, `record ${index} has a value cell`).toBeDefined();
      // Inert: whatever the spreadsheet reads first, it is not the operator.
      expect(/^[=+\-@\t\r]/.test(cell as string)).toBe(false);
      // Recoverable: one documented strip and the supplier's string is back.
      expect(recover(cell as Cell)).toBe(formula);
    });
  });

  it('applies to the header row too, which is written by the same writer', () => {
    // The column names are ours today. A header taken from vertical
    // configuration tomorrow must not be the one row that skips the escape.
    expect(csvDocument(['=danger', 'value'], [])).toBe(`'=danger,value${CSV_RECORD_SEPARATOR}`);
    expect(csvDocument(['property', 'value'], [])).toBe(
      `property,value${CSV_RECORD_SEPARATOR}`,
    );
  });
});
