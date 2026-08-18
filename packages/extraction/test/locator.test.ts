import { describe, expect, it } from 'vitest';
import {
  cssSelectorLocator,
  escapeJsonPointerToken,
  formatLocatorValue,
  isResolvableLocator,
  joinJsonPointer,
  jsonPointerLocator,
  lineRangeLocator,
  pageLocator,
  parseJsonPointer,
  parseLocatorValue,
  resolveJsonPointer,
  tableCellLocator,
  wholeDocumentLocator,
} from '../src/index.js';

describe('locator value grammar', () => {
  it('round-trips structured parts', () => {
    const value = formatLocatorValue([
      ['row', 12],
      ['column', 'Cooling Capacity (BTU/h)'],
    ]);
    expect(parseLocatorValue(value)).toEqual({
      row: '12',
      column: 'Cooling Capacity (BTU/h)',
    });
  });

  it('escapes the delimiters so header names cannot corrupt a locator', () => {
    const value = tableCellLocator(3, 'a=b;c', 1).value;
    expect(value).not.toMatch(/a=b;c/);
    expect(parseLocatorValue(value)['column']).toBe('a=b;c');
  });

  it('marks WHOLE_DOCUMENT resolvable and empty typed locators unresolvable', () => {
    expect(isResolvableLocator(wholeDocumentLocator())).toBe(true);
    expect(isResolvableLocator(cssSelectorLocator(''))).toBe(false);
    expect(isResolvableLocator(cssSelectorLocator('main > h1'))).toBe(true);
    expect(isResolvableLocator(lineRangeLocator(4, 4))).toBe(true);
    expect(isResolvableLocator(pageLocator(2, { line: 7 }))).toBe(true);
  });

  it('encodes page locators with optional line and bounding box', () => {
    expect(pageLocator(3).value).toBe('page=3');
    expect(parseLocatorValue(pageLocator(3, { line: 9 }).value)).toEqual({ page: '3', line: '9' });
    expect(parseLocatorValue(pageLocator(3, { bbox: [10, 20, 30, 40] }).value)['bbox']).toBe(
      '10,20,30,40',
    );
  });
});

describe('RFC 6901 JSON pointers', () => {
  it('escapes ~ and / in tokens', () => {
    expect(escapeJsonPointerToken('a/b~c')).toBe('a~1b~0c');
    expect(joinJsonPointer('', 'a/b', 0)).toBe('/a~1b/0');
    expect(parseJsonPointer('/a~1b/0')).toEqual(['a/b', '0']);
  });

  it('resolves into nested objects and arrays', () => {
    const document = { data: { models: [{ specs: { seer2: 15.2 } }] } };
    expect(resolveJsonPointer(document, '/data/models/0/specs/seer2')).toEqual({
      found: true,
      value: 15.2,
    });
    expect(resolveJsonPointer(document, '/data/models/9')).toEqual({ found: false, value: undefined });
    expect(resolveJsonPointer(document, '')).toEqual({ found: true, value: document });
  });

  it('distinguishes a resolved null from a missing path', () => {
    const document = { specs: { hspf2: null } };
    expect(resolveJsonPointer(document, '/specs/hspf2')).toEqual({ found: true, value: null });
    expect(resolveJsonPointer(document, '/specs/absent')).toEqual({
      found: false,
      value: undefined,
    });
  });

  it('rejects a pointer that is neither empty nor rooted', () => {
    expect(() => parseJsonPointer('data/models')).toThrow(/must be empty or start with/);
  });

  it('produces a JSON_POINTER locator that is a valid pointer', () => {
    const locator = jsonPointerLocator(joinJsonPointer('/data/models', 2, 'specs'));
    expect(locator.type).toBe('JSON_POINTER');
    expect(() => parseJsonPointer(locator.value)).not.toThrow();
  });
});
