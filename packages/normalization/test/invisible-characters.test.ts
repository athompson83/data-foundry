/**
 * Characters a source can carry that a reader cannot see.
 *
 * Scraped specification tables arrive full of them. A PDF-to-HTML converter
 * leaves soft hyphens where it had a line break. A CMS that once justified text
 * leaves zero-width spaces. A file that travelled through Windows carries a
 * byte-order mark on its first field. None of them render, so nobody reviewing
 * the source notices, and every one of them changes a string comparison.
 *
 * The package already handles the visible half of this problem well: NFKC folds
 * full-width forms, `normalizePunctuation` folds a PDF's non-breaking hyphen to
 * an ASCII one, and three separate comparison keys apply both before matching
 * anything. What none of them handled is the invisible half.
 *
 * The sharpest consequence is `isNullToken`, because it is not a comparison
 * among values — it is the gate that decides whether a source field means
 * anything at all. A `"N/A"` it fails to recognise does not become a missing
 * value; it becomes the published string `"N/A"`, asserted as a fact about a
 * real product.
 */
import { describe, expect, it } from 'vitest';
import { normalizeRecord } from '../src/pipeline.js';
import { HVAC_RULE_SET, hvacRecord, value } from './fixtures.js';
import { isNullToken, stripFormatCharacters } from '../src/text.js';
import { mapVocabulary } from '../src/vocabulary.js';
import { findUnit } from '../src/units.js';
import { normalizeBoolean } from '../src/scalars.js';
import { normalizeIdentifier } from '../src/identifier.js';

/** Written as escapes: a literal one is invisible in this file too. */
const SOFT_HYPHEN = '­';
const ZERO_WIDTH_SPACE = '​';
const BOM = '﻿';
const LEFT_TO_RIGHT_MARK = '‎';
const WORD_JOINER = '⁠';

const INVISIBLE = [
  ['soft hyphen', SOFT_HYPHEN],
  ['zero-width space', ZERO_WIDTH_SPACE],
  ['byte-order mark', BOM],
  ['left-to-right mark', LEFT_TO_RIGHT_MARK],
  ['word joiner', WORD_JOINER],
] as const;

describe('stripping format characters', () => {
  // The danger of a cleanup step is not that it does too little — that shows up
  // as a match that fails. It is that it does too much, which shows up as data
  // quietly changing shape with every test still green. So the removal set is
  // asserted from both sides, and the "removes nothing else" side is checked
  // against characters that are easy to sweep up by accident: punctuation a
  // regex-based implementation would eat, and non-ASCII letters that are real
  // content rather than debris.
  it.each(INVISIBLE)('removes a %s', (_name, character) => {
    expect(stripFormatCharacters(`24ACC6${character}36A003`)).toBe('24ACC636A003');
  });

  it('decomposes a joined emoji, which is the cost of the choice', () => {
    // Not a bug report waiting to happen: the zero-width joiner is on the
    // removal list because in Latin-script technical data it is scraping
    // debris, and the price of that is that a ZWJ-joined emoji sequence comes
    // apart into its components. Nothing in an HVAC specification table is an
    // emoji, so the trade is worth making today — but it IS a trade, and a
    // vertical that ingests text where the joiner is semantic (Indic and
    // Arabic scripts, not only emoji) has to revisit `FORMAT_CHARACTERS`.
    // Pinned here so that decision is found by reading the tests rather than
    // by someone's name rendering wrongly in production.
    expect(stripFormatCharacters('👩‍🔧')).toBe('👩🔧');
    expect(stripFormatCharacters('🔧'), 'an emoji with no joiner is untouched').toBe('🔧');
  });

  it('removes nothing else', () => {
    for (const value of [
      '24ACC6-36A003',
      'R-410A',
      'BTU/h',
      '19.5 SEER2',
      '3½ ton',
      '°C',
      'Trane®',
      'Süd-Klima',
      'エアコン',
      'a\tb\nc',
    ]) {
      expect(stripFormatCharacters(value), value).toBe(value);
    }
  });
});

describe('the null-token gate', () => {
  it.each(INVISIBLE)('sees through a %s', (_name, character) => {
    expect(isNullToken(`N/A${character}`)).toBe(true);
    expect(isNullToken(`N${character}/A`)).toBe(true);
  });

  it('folds the same way its sibling comparison keys do', () => {
    // `booleanKey`, `unitKey` and `vocabularyKey` all apply NFKC and
    // typographic punctuation folding before comparing. This gate did not, so
    // a full-width or en-dashed spelling of absence became a published value.
    expect(isNullToken('Ｎ／Ａ'), 'full-width, as a Japanese-locale export writes it').toBe(true);
    expect(isNullToken('–'), 'an en dash where the table meant a hyphen').toBe(true);
    expect(isNullToken('——'), 'two em dashes').toBe(true);
  });

  it('still refuses to call a real value absent', () => {
    // The whole risk of widening a null-token gate is that it starts eating
    // data. These are values, not absences, and must survive every widening.
    expect(isNullToken('0')).toBe(false);
    expect(isNullToken('R-410A')).toBe(false);
    expect(isNullToken('none-standard')).toBe(false);
    expect(isNullToken('N/A-1')).toBe(false);
    expect(isNullToken('nap')).toBe(false);
    expect(isNullToken(`R${SOFT_HYPHEN}410A`)).toBe(false);
  });
});

describe('the comparison keys', () => {
  const SYSTEM_TYPES = { id: 'system_type', terms: { split_system: ['split system'] } };

  it('matches a vocabulary term carrying an invisible character', () => {
    const clean = mapVocabulary('Split System', SYSTEM_TYPES);
    const dirty = mapVocabulary(`Split${SOFT_HYPHEN} System`, SYSTEM_TYPES);
    expect(clean.ok, 'the fixture must match when clean, or this proves nothing').toBe(true);
    expect(dirty.ok).toBe(true);
    expect(dirty.ok && dirty.value.term).toBe(clean.ok && clean.value.term);
  });

  it('matches a unit symbol carrying an invisible character', () => {
    expect(findUnit(`btu${ZERO_WIDTH_SPACE}/h`)?.symbol).toBe(findUnit('btu/h')?.symbol);
    expect(findUnit('btu/h'), 'the clean lookup must succeed, or this proves nothing').toBeDefined();
  });

  it('matches a boolean spelling carrying an invisible character', () => {
    expect(normalizeBoolean(`Yes${BOM}`).ok).toBe(true);
  });
});

describe('identifier matching, which did not need changing', () => {
  /**
   * Worth an assertion rather than an assumption, and worth saying why the fix
   * stops short of here. `normalizeIdentifier` filters the matching form down
   * to a character class — alphanumeric, digits or letters — and every
   * invisible character is outside all three, so the join key was never
   * exposed to this. Adding a second strip would be a redundant filter, and a
   * redundant filter is the thing that later disagrees with the first one.
   *
   * The display form is a different question, and the answer there is that it
   * is the source string untouched, deliberately.
   */
  it.each(INVISIBLE)('was already immune to a %s', (_name, character) => {
    const clean = normalizeIdentifier('24ACC6-36A003');
    const dirty = normalizeIdentifier(`24ACC6${character}-36A003`);
    expect(dirty.normalized).toBe(clean.normalized);
    expect(dirty.display, 'the display form keeps what the source sent').toBe(
      `24ACC6${character}-36A003`,
    );
  });
});

describe('the whole pipeline, on a record that spells absence invisibly', () => {
  /**
   * The consequence worth proving, and the reason this is a correctness bug
   * rather than a tidiness one. `isNullToken` is not a comparison among values;
   * it is the gate that decides whether a source field means anything at all. A
   * `"N/A"` it fails to recognise does not become a missing value. It becomes a
   * `"N/A"` string published as a fact about a real product, with real evidence
   * attached, indistinguishable to every downstream surface from a value the
   * manufacturer actually stated.
   *
   * Driven through `normalizeRecord` rather than through the helper, because
   * the helper agreeing with itself is not the property that matters.
   */
  const ABSENT = `N/A${SOFT_HYPHEN}`;

  it('records no value for the field, rather than publishing the word', () => {
    const result = normalizeRecord(hvacRecord([value('refrigerant', ABSENT)]), HVAC_RULE_SET);

    const refrigerant = result.candidates.find((item) => item.property === 'refrigerant');
    expect(refrigerant, 'an invisible character must not turn absence into a value').toBeUndefined();

    // …and nothing anywhere in the result carries the string either, which the
    // assertion above does not cover on its own: a candidate could be absent
    // while a failure or signal quotes it back as though it were data.
    expect(JSON.stringify(result)).not.toContain('N/A');
  });

  it('still records a real value from the same field, so the gate has not eaten the data', () => {
    // Without this the assertion above is satisfied by a pipeline that drops
    // `refrigerant` unconditionally.
    const result = normalizeRecord(hvacRecord([value('refrigerant', 'Puron')]), HVAC_RULE_SET);
    const refrigerant = result.candidates.find((item) => item.property === 'refrigerant');
    expect(refrigerant?.normalized_value).toBeDefined();
  });
});
