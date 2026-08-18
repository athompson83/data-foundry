import { describe, expect, it } from 'vitest';
import {
  IDENTIFIER_PROFILES,
  identifierEquivalenceKey,
  identifierProfile,
  identifiersMatch,
  normalizeIdentifier,
  normalizeIdentifierForAlias,
} from '../src/index.js';

/**
 * AGENTS.md rule 7: exact identifiers beat semantic search.
 *
 * These are the equivalence classes the rule depends on. If any of them break,
 * entity resolution starts reaching for fuzzy matching to compensate — which is
 * precisely the failure mode rule 7 forbids.
 */
describe('normalizeIdentifier equivalence classes', () => {
  const MODEL_CLASS = [
    '24ACC636A003',
    '24acc6-36a003',
    '24ACC6 36A003',
    '24-ACC6/36A003',
    '  24acc6 36a003  ',
    '24.ACC6_36A003',
    '24ACC6‑36A003', // non-breaking hyphen, straight out of a PDF
    '２４ＡＣＣ６３６Ａ００３', // full-width, straight out of a badly encoded feed
  ] as const;

  it('collapses every written form of one model number to one key', () => {
    const keys = new Set(MODEL_CLASS.map((raw) => identifierEquivalenceKey(raw)));
    expect(keys).toEqual(new Set(['24ACC636A003']));
  });

  it('makes every pair in the class match', () => {
    for (const left of MODEL_CLASS) {
      for (const right of MODEL_CLASS) {
        expect(identifiersMatch(left, right)).toBe(true);
      }
    }
  });

  it('always preserves the display form', () => {
    for (const raw of MODEL_CLASS) {
      expect(normalizeIdentifier(raw).display).toBe(raw);
    }
  });

  it('does not match a genuinely different identifier', () => {
    expect(identifiersMatch('24ACC636A003', '24ACC648A003')).toBe(false);
    expect(identifiersMatch('24ACC636A003', '24ACC636A004')).toBe(false);
    // One transposed character must not match: this is exact matching, not fuzzy.
    expect(identifiersMatch('24ACC636A003', '24ACC363A003')).toBe(false);
  });

  it('treats two empty normalizations as non-matching', () => {
    // Both normalize to "", but "N/A" is not evidence that two records are the
    // same equipment — returning true here would merge the entire catalogue.
    expect(identifiersMatch('-', '--')).toBe(false);
    expect(identifiersMatch('N/A', '...')).toBe(false);
    expect(normalizeIdentifier('---').empty).toBe(true);
  });
});

describe('alias-type profiles', () => {
  it('strips leading zeros from AHRI reference numbers', () => {
    const options = identifierProfile('ahri_ref');
    expect(identifierEquivalenceKey('00202584720', options)).toBe('202584720');
    expect(identifierEquivalenceKey('202584720', options)).toBe('202584720');
    expect(identifiersMatch('AHRI 202584720', '00202584720', options)).toBe(true);
  });

  it('pads UPCs to twelve digits so a dropped leading zero still matches', () => {
    const options = identifierProfile('upc');
    expect(identifierEquivalenceKey('0-12345-67890-5', options)).toBe('012345678905');
    expect(identifierEquivalenceKey('12345678905', options)).toBe('012345678905');
    expect(identifiersMatch('0-12345-67890-5', '12345678905', options)).toBe(true);
  });

  it('never strips leading zeros for UPCs', () => {
    expect(IDENTIFIER_PROFILES['upc']?.strip_leading_zeros).toBeUndefined();
  });

  it('normalizes series names for matching without destroying the display form', () => {
    const options = identifierProfile('series_name');
    const normalized = normalizeIdentifier('Infinity® 16', options);
    expect(normalized.normalized).toBe('INFINITY16');
    expect(normalized.display).toBe('Infinity® 16');
    expect(identifiersMatch('Infinity 16', 'infinity-16', options)).toBe(true);
  });

  it('falls back to the alphanumeric/upper profile for an unknown alias type', () => {
    expect(identifierProfile('some_new_vertical_id')).toEqual({
      keep: 'alphanumeric',
      case: 'upper',
    });
  });
});

describe('normalizeIdentifierForAlias', () => {
  it('returns the display and matching forms together', () => {
    const result = normalizeIdentifierForAlias('model_number', '24acc6-36a003');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.display).toBe('24acc6-36a003');
    expect(result.value.normalized).toBe('24ACC636A003');
  });

  it('fails with a reason when nothing survives normalization', () => {
    const result = normalizeIdentifierForAlias('ahri_ref', 'pending');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('IDENTIFIER_EMPTY_AFTER_NORMALIZATION');
    expect(result.message).toContain('ahri_ref');
  });

  it('honours a rule-level override of the profile', () => {
    const preserved = normalizeIdentifierForAlias('model_number', '24acc6-36a003', {
      case: 'preserve',
    });
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(preserved.value.normalized).toBe('24acc636a003');
  });
});
