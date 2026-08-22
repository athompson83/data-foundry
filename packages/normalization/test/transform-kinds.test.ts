/**
 * The exported transform vocabulary has to be the one the pipeline dispatches.
 *
 * `TRANSFORM_KINDS` is what `parseNormalizationRuleSet` rejects unknown kinds
 * against, and what `pnpm verticals:validate` imports so a vertical cannot
 * declare a transform the platform does not implement. Both uses are only as
 * honest as the list. It used to be a hand-written `readonly string[]` sitting
 * beside the `TransformSpec` union with nothing checking that the two agreed;
 * the drift that invites is the same defect the vocabulary exists to prevent.
 *
 * The list is now derived from a total `Record<TransformKind, true>`, so both
 * directions of drift are compile errors. These cases hold the *runtime* end of
 * that chain: every advertised kind reaches a branch of `applyTransform`.
 */
import { describe, expect, it } from 'vitest';
import { applyTransforms } from '../src/pipeline.js';
import {
  isTransformKind,
  parseNormalizationRuleSet,
  TRANSFORM_KINDS,
  type NormalizationRuleSet,
  type TransformKind,
  type TransformSpec,
} from '../src/rules.js';

const RULE_SET: NormalizationRuleSet = {
  id: 'probe',
  version: '1.0.0',
  vertical: 'probe',
  entity_types: ['probe'],
  properties: [],
  identifiers: [],
  vocabularies: { probe: { id: 'probe', terms: { known: ['seen'] } } },
};

/**
 * One minimal spec per kind. Typed as a *total* record so that adding a variant
 * to `TransformSpec` without probing it here is a compile error — the coverage
 * cannot silently fall behind the union.
 */
const PROBES: Readonly<Record<TransformKind, TransformSpec>> = {
  trim: { kind: 'trim' },
  collapse_whitespace: { kind: 'collapse_whitespace' },
  unicode_nfkc: { kind: 'unicode_nfkc' },
  normalize_punctuation: { kind: 'normalize_punctuation' },
  decode_html_entities: { kind: 'decode_html_entities' },
  case: { kind: 'case', to: 'upper' },
  strip_characters: { kind: 'strip_characters', characters: '-' },
  replace: { kind: 'replace', pattern: 'x', replacement: 'y' },
  number: { kind: 'number' },
  quantity: { kind: 'quantity', target_unit: 'ton', allow_unitless: true },
  boolean: { kind: 'boolean' },
  date: { kind: 'date' },
  datetime: { kind: 'datetime' },
  integer: { kind: 'integer' },
  round: { kind: 'round', decimals: 2 },
  range: { kind: 'range', min: 0 },
  vocabulary: { kind: 'vocabulary', vocabulary: 'probe' },
};

describe('the exported transform vocabulary is the dispatch, not a copy of it', () => {
  it('reaches a branch of applyTransform for every kind it advertises', () => {
    expect(TRANSFORM_KINDS.length).toBeGreaterThan(0);

    for (const kind of TRANSFORM_KINDS) {
      const outcome = applyTransforms('3', [PROBES[kind]], RULE_SET);
      // A kind with no branch behind it falls off the end of the switch and
      // yields `undefined`. Whether the branch succeeds or returns a typed
      // failure is beside the point here — either proves it was dispatched.
      expect(outcome, `${kind} is exported but not dispatched`).toBeDefined();
      expect(typeof outcome.ok, `${kind} did not return a normalization outcome`).toBe('boolean');
    }
  });

  it('accepts every advertised kind in a rule set, and rejects one it does not advertise', () => {
    for (const kind of TRANSFORM_KINDS) {
      const parse = (): NormalizationRuleSet =>
        parseNormalizationRuleSet({
          ...RULE_SET,
          properties: [
            {
              property: 'probe',
              source_field: 'probe',
              value_type: 'string',
              transforms: [PROBES[kind]],
            },
          ],
        });
      expect(parse, `${kind} is exported but rejected by the rule-set parser`).not.toThrow();
    }

    expect(() =>
      parseNormalizationRuleSet({
        ...RULE_SET,
        properties: [
          {
            property: 'probe',
            source_field: 'probe',
            value_type: 'string',
            transforms: [{ kind: 'unicode_normalise' }],
          },
        ],
      }),
    ).toThrow(/unknown transform kind unicode_normalise/);
  });

  it('agrees with its own membership test in both directions', () => {
    for (const kind of TRANSFORM_KINDS) {
      expect(isTransformKind(kind), `${kind} is listed but not recognised`).toBe(true);
    }
    for (const notAKind of ['unicode_normalise', 'left_pad', '', 'toString', 'constructor']) {
      expect(isTransformKind(notAKind), `${notAKind} is recognised but not listed`).toBe(
        (TRANSFORM_KINDS as readonly string[]).includes(notAKind),
      );
    }
  });

  /**
   * The reason the platform keeps two vocabularies rather than one pooled set.
   * They overlap (`collapse_whitespace`, `strip_characters`) without being the
   * same, so a checker that merged them would accept an identifier op here and
   * a value transform there — a typo that lands in the wrong pipeline stage and
   * is not caught until the run it was supposed to prevent.
   */
  it('is not interchangeable with the identifier-op vocabulary', () => {
    for (const identifierOnly of ['left_pad', 'strip_non_digits', 'strip_prefix', 'title_case']) {
      expect(isTransformKind(identifierOnly)).toBe(false);
    }
    for (const valueOnly of ['round', 'quantity', 'vocabulary', 'unicode_nfkc']) {
      expect(isTransformKind(valueOnly)).toBe(true);
    }
  });
});
