/**
 * JSONL and the deterministic JSON encoder.
 *
 * JSONL is the easy format and still has two ways to go wrong: a key order that
 * varies between runs (which changes the checksum without changing the data),
 * and a column silently missing from some lines (which changes the schema a
 * reader infers from line one).
 */
import { describe, expect, it } from 'vitest';
import { jsonlDocument, jsonlRecord } from '../src/jsonl.js';
import { fromUtf8, sha256, stableJson, utf8 } from '../src/bytes.js';

const COLUMNS = ['b', 'a', 'c'] as const;

describe('jsonlRecord', () => {
  it('emits keys in the declared column order, not the object’s', () => {
    const record = { a: 1, c: null, b: 'x' };
    expect(jsonlRecord([...COLUMNS], record)).toBe('{"b":"x","a":1,"c":null}');
  });

  it('is insensitive to how the record object was built', () => {
    const first = { a: 1, b: 'x', c: null };
    const second: Record<string, string | number | null> = {};
    second['c'] = null;
    second['b'] = 'x';
    second['a'] = 1;
    expect(jsonlRecord([...COLUMNS], first)).toBe(jsonlRecord([...COLUMNS], second));
  });

  it('refuses a record missing a declared column instead of omitting the key', () => {
    expect(() => jsonlRecord([...COLUMNS], { a: 1, b: 'x' })).toThrow(/column "c" is missing/);
  });

  it('refuses a non-finite number, which JSON cannot carry', () => {
    expect(() => jsonlRecord(['a'], { a: Number.NaN })).toThrow(/JSON cannot carry/);
  });

  it('escapes control characters and quotes so each record stays one line', () => {
    const line = jsonlRecord(['v'], { v: 'a"b\nc\td' });
    expect(line.includes('\n')).toBe(false);
    expect(JSON.parse(line)).toEqual({ v: 'a"b\nc\td' });
  });
});

describe('jsonlDocument', () => {
  it('LF-terminates every record, including the last', () => {
    const text = jsonlDocument(['a'], [{ a: 1 }, { a: 2 }]);
    expect(text).toBe('{"a":1}\n{"a":2}\n');
  });

  it('round-trips: every line parses back to the record that produced it', () => {
    const records = [
      { a: 'Parts, labor "included"', b: null, c: true },
      { a: 'line\nbreak', b: 15.2, c: false },
    ];
    const text = jsonlDocument(['a', 'b', 'c'], records);
    const parsed = text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as unknown);
    expect(parsed).toEqual(records);
  });

  it('emits nothing at all for an empty record set', () => {
    expect(jsonlDocument(['a'], [])).toBe('');
  });
});

describe('stableJson', () => {
  it('sorts object keys at every depth', () => {
    expect(stableJson({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] })).toBe(
      '{"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}',
    );
  });

  it('gives two differently-built copies of the same value identical bytes', () => {
    const first = { vertical: 'hvac', files: [{ path: 'a', sha256: 'x' }], version: '1' };
    const second: Record<string, unknown> = {};
    second['version'] = '1';
    second['files'] = [{ sha256: 'x', path: 'a' }];
    second['vertical'] = 'hvac';
    expect(sha256(utf8(stableJson(first)))).toBe(sha256(utf8(stableJson(second))));
  });

  it('leaves array order alone, because an array’s order is data', () => {
    expect(stableJson(['b', 'a'])).toBe('["b","a"]');
  });

  it('refuses undefined rather than dropping the key', () => {
    expect(() => stableJson({ a: undefined })).toThrow(/undefined is not serializable/);
  });
});

describe('bytes', () => {
  it('round-trips utf-8, including characters outside the BMP', () => {
    const text = 'R-454B — café \u{1F9CA}';
    expect(fromUtf8(utf8(text))).toBe(text);
  });

  it('hashes bytes, not strings, and returns lowercase hex', () => {
    expect(sha256(utf8(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
