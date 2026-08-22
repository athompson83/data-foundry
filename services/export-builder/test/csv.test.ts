/**
 * CSV escaping, which is where CSV exporters actually break.
 *
 * The failure is never "the writer crashed". It is that a value containing a
 * comma silently becomes two columns, a value containing a newline silently
 * becomes two rows, and the file still parses — so the corruption is invisible
 * until a customer's row counts disagree with the manifest's.
 *
 * These tests therefore do not assert on the emitted string alone. They parse
 * the output back with a conforming RFC 4180 reader written here from the
 * specification, and assert that what comes back is what went in. A writer that
 * only satisfies assertions about its own output format is being marked by
 * itself.
 */
import { describe, expect, it } from 'vitest';
import {
  CSV_RECORD_SEPARATOR,
  csvDocument,
  csvField,
  csvRecord,
  type CsvValue,
} from '../src/csv.js';

/**
 * A conforming RFC 4180 reader.
 *
 * Returns `null` for an UNQUOTED empty field and `''` for a quoted one, which
 * is the distinction the writer encodes and the only way to check it survived.
 */
type Cell = string | null;

function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let buffer = '';
  let quoted = false;
  let sawQuote = false;
  let index = 0;

  const endField = (): void => {
    row.push(!sawQuote && buffer === '' ? null : buffer);
    buffer = '';
    sawQuote = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"') {
        if (text.charAt(index + 1) === '"') {
          buffer += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      buffer += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      sawQuote = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r' && text.charAt(index + 1) === '\n') {
      endRow();
      index += 2;
      continue;
    }
    buffer += character;
    index += 1;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (buffer !== '' || sawQuote || row.length > 0) endRow();
  return rows;
}

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
