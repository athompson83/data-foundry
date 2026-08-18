import { describe, expect, it } from 'vitest';
import {
  applyCase,
  collapseWhitespace,
  decodeHtmlEntities,
  isNullToken,
  normalizeBoolean,
  normalizeDate,
  normalizeDateTime,
  normalizePunctuation,
} from '../src/index.js';

describe('primitive cleanup', () => {
  it('collapses whitespace without touching interior meaning', () => {
    expect(collapseWhitespace('  Split   System \n Air Conditioner ')).toBe(
      'Split System Air Conditioner',
    );
  });

  it('folds typographic punctuation to ASCII', () => {
    expect(normalizePunctuation('24ACC6‑36A003')).toBe('24ACC6-36A003');
    expect(normalizePunctuation('“Infinity” — 16')).toBe('"Infinity" - 16');
  });

  it('decodes the entity set that appears in scraped spec tables', () => {
    expect(decodeHtmlEntities('R&#8209;410A')).toBe('R‑410A');
    // Decoded faithfully to U+00A0, then folded to a plain space by the next
    // cleanup step rather than silently during decoding.
    expect(decodeHtmlEntities('72&nbsp;dB')).toBe('72\u00A0dB');
    expect(normalizePunctuation(decodeHtmlEntities('72&nbsp;dB'))).toBe('72 dB');
    expect(decodeHtmlEntities('Carrier&reg; Infinity&trade;')).toBe('Carrier® Infinity™');
  });

  it('leaves an unknown entity verbatim rather than guessing', () => {
    expect(decodeHtmlEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('applies casing deterministically, without locale', () => {
    expect(applyCase('split system', 'title')).toBe('Split System');
    expect(applyCase('R-410a', 'upper')).toBe('R-410A');
    expect(applyCase('R-410A', 'lower')).toBe('r-410a');
  });

  it('recognises the ways sources spell absence', () => {
    for (const token of ['', '-', 'N/A', 'n.a.', 'None', 'TBD', 'unknown', 'Not Applicable']) {
      expect(isNullToken(token)).toBe(true);
    }
    expect(isNullToken('0')).toBe(false);
    expect(isNullToken('R-410A')).toBe(false);
  });
});

describe('normalizeBoolean', () => {
  it('maps the default vocabularies', () => {
    for (const raw of ['Yes', 'true', 'Y', '1', 'Standard', 'Included']) {
      expect(normalizeBoolean(raw)).toEqual({ ok: true, value: true });
    }
    for (const raw of ['No', 'FALSE', 'n', '0', 'Not Included']) {
      expect(normalizeBoolean(raw)).toEqual({ ok: true, value: false });
    }
  });

  it('fails on a token in neither vocabulary instead of defaulting to false', () => {
    const result = normalizeBoolean('Optional');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNPARSEABLE_BOOLEAN');
    expect(result.message).toContain('Optional');
  });

  it('accepts a vertical-supplied vocabulary', () => {
    expect(
      normalizeBoolean('Factory Installed', { true_values: ['factory installed'], false_values: ['field installed'] }),
    ).toEqual({ ok: true, value: true });
  });
});

describe('normalizeDate', () => {
  it('emits ISO dates for every declared format', () => {
    expect(normalizeDate('2026-01-15', ['YYYY-MM-DD'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
    expect(normalizeDate('01/15/2026', ['MM/DD/YYYY'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
    expect(normalizeDate('15/01/2026', ['DD/MM/YYYY'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
    expect(normalizeDate('Jan 15, 2026', ['MMM D, YYYY'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
    expect(normalizeDate('15 January 2026', ['D MMM YYYY'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
    expect(normalizeDate('20260115', ['YYYYMMDD'])).toMatchObject({
      ok: true,
      value: { iso: '2026-01-15' },
    });
  });

  it('resolves format order deterministically and flags the ambiguity', () => {
    const usFirst = normalizeDate('03/04/2026', ['MM/DD/YYYY', 'DD/MM/YYYY']);
    const euFirst = normalizeDate('03/04/2026', ['DD/MM/YYYY', 'MM/DD/YYYY']);
    expect(usFirst).toMatchObject({ ok: true, value: { iso: '2026-03-04', ambiguous: true } });
    expect(euFirst).toMatchObject({ ok: true, value: { iso: '2026-04-03', ambiguous: true } });
  });

  it('does not flag ambiguity when only one format can match', () => {
    expect(normalizeDate('03/22/2026', ['MM/DD/YYYY', 'DD/MM/YYYY'])).toMatchObject({
      ok: true,
      value: { iso: '2026-03-22', ambiguous: false },
    });
  });

  it('rejects impossible calendar dates', () => {
    expect(normalizeDate('2026-02-30', ['YYYY-MM-DD']).ok).toBe(false);
    expect(normalizeDate('2025-02-29', ['YYYY-MM-DD']).ok).toBe(false);
    expect(normalizeDate('2024-02-29', ['YYYY-MM-DD']).ok).toBe(true);
  });

  it('fails with a reason when nothing matches', () => {
    const result = normalizeDate('Q1 2026', ['YYYY-MM-DD']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNPARSEABLE_DATE');
    expect(result.message).toContain('YYYY-MM-DD');
  });
});

describe('normalizeDateTime', () => {
  it('accepts ISO-8601 with a UTC offset', () => {
    expect(normalizeDateTime('2026-01-15T09:30:00Z')).toEqual({
      ok: true,
      value: '2026-01-15T09:30:00Z',
    });
    expect(normalizeDateTime('2026-01-15T09:30:00-05:00')).toEqual({
      ok: true,
      value: '2026-01-15T09:30:00-05:00',
    });
    expect(normalizeDateTime('2026-01-15T09:30-0500')).toEqual({
      ok: true,
      value: '2026-01-15T09:30:00-05:00',
    });
  });

  it('refuses to invent a timezone for a bare date', () => {
    const result = normalizeDateTime('2026-01-15');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('MISSING_TIME_COMPONENT');
    expect(result.message).toContain('refusing to invent one');
  });

  it('rejects out-of-range times', () => {
    expect(normalizeDateTime('2026-01-15T25:00:00Z').ok).toBe(false);
    expect(normalizeDateTime('2026-01-15T09:75:00Z').ok).toBe(false);
  });
});
