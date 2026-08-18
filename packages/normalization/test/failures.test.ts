import { describe, expect, it } from 'vitest';
import {
  NORMALIZATION_FAILURE_REASONS,
  normalizeRecord,
  parseNormalizationRuleSet,
  type NormalizationFailure,
  type NormalizationResult,
} from '../src/index.js';
import { HVAC_RULE_SET, hvacRecord, value } from './fixtures.js';

/**
 * The rule these tests exist to enforce: **an unmappable value surfaces as a
 * failure with a reason, and never as a coerced value or a silent drop.**
 *
 * Every case below is a real thing a manufacturer feed does. The assertion in
 * each is the same in spirit: the candidate list does *not* contain a made-up
 * value, and the failure list *does* contain an explanation someone can act on.
 */

const failureFor = (result: NormalizationResult, property: string): NormalizationFailure => {
  const found = result.failures.find(
    (failure) => failure.property === property || failure.alias_type === property,
  );
  if (found === undefined) {
    throw new Error(
      `expected a failure for ${property}, got [${result.failures.map((f) => `${f.property ?? f.alias_type}:${f.reason}`).join(', ')}]`,
    );
  }
  return found;
};

const hasCandidate = (result: NormalizationResult, property: string): boolean =>
  result.candidates.some((candidate) => candidate.property === property);

describe('unparseable values fail with a reason', () => {
  it('does not turn "call for pricing" into a number', () => {
    const result = normalizeRecord(hvacRecord([value('seer2', 'call for pricing')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'seer2')).toBe(false);
    const failure = failureFor(result, 'seer2');
    expect(failure.reason).toBe('UNPARSEABLE_NUMBER');
    expect(failure.source_value).toBe('call for pricing');
    expect(failure.message).toContain('seer2');
  });

  it('does not turn a non-integer into an integer by rounding', () => {
    const result = normalizeRecord(hvacRecord([value('phase', '1.5')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'phase')).toBe(false);
    const failure = failureFor(result, 'phase');
    expect(failure.reason).toBe('VALUE_TYPE_MISMATCH');
    expect(failure.message).toContain('change the source');
  });

  it('does not turn an unknown boolean token into false', () => {
    const ruleSet = parseNormalizationRuleSet({
      id: 'hvac.flags.v1',
      version: '1.0.0',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [
        { property: 'communicating', source_field: 'communicating', value_type: 'boolean' },
      ],
      identifiers: [],
    });
    const result = normalizeRecord(
      hvacRecord([value('communicating', 'Optional')]),
      ruleSet,
    );
    expect(hasCandidate(result, 'communicating')).toBe(false);
    expect(failureFor(result, 'communicating').reason).toBe('UNPARSEABLE_BOOLEAN');
  });
});

describe('units are never dropped', () => {
  it('refuses to read a value that still carries a unit as a bare number', () => {
    // `seer2` is a unitless ratio; a source that writes "15.2 SEER" is telling us
    // something the rule does not model, and 15.2 with "SEER" discarded is a
    // guess dressed up as a fact.
    const result = normalizeRecord(hvacRecord([value('seer2', '15.2 dB')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'seer2')).toBe(false);
    const failure = failureFor(result, 'seer2');
    expect(failure.reason).toBe('UNIT_IN_NUMERIC_VALUE');
    expect(failure.message).toContain('dropped');
  });

  it('refuses trailing text that is not a known unit', () => {
    const result = normalizeRecord(hvacRecord([value('eer2', '12.5 (rated)')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'eer2')).toBe(false);
    expect(failureFor(result, 'eer2').reason).toBe('UNIT_IN_NUMERIC_VALUE');
  });

  it('refuses a unit from the wrong dimension instead of converting anyway', () => {
    const result = normalizeRecord(
      hvacRecord([value('cooling_capacity_btu', '36,000 lb')]),
      HVAC_RULE_SET,
    );
    expect(hasCandidate(result, 'cooling_capacity_btu')).toBe(false);
    const failure = failureFor(result, 'cooling_capacity_btu');
    expect(failure.reason).toBe('INCOMPATIBLE_UNIT_DIMENSION');
    expect(failure.message).toContain('mass');
  });

  it('refuses an unknown unit rather than stripping it', () => {
    const result = normalizeRecord(
      hvacRecord([value('cooling_capacity_btu', '36,000 flurbs')]),
      HVAC_RULE_SET,
    );
    expect(hasCandidate(result, 'cooling_capacity_btu')).toBe(false);
    expect(failureFor(result, 'cooling_capacity_btu').reason).toBe('UNKNOWN_UNIT');
  });

  it('refuses a bare number when the rule declares a unit and no default', () => {
    const strict = parseNormalizationRuleSet({
      id: 'hvac.strict.v1',
      version: '1.0.0',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [
        {
          property: 'cooling_capacity_btu',
          source_field: 'cooling_capacity_btu',
          value_type: 'number',
          unit: 'BTU/h',
          transforms: [{ kind: 'quantity', target_unit: 'BTU/h' }],
        },
      ],
      identifiers: [],
    });
    const result = normalizeRecord(hvacRecord([value('cooling_capacity_btu', '36000')]), strict);
    expect(hasCandidate(result, 'cooling_capacity_btu')).toBe(false);
    const failure = failureFor(result, 'cooling_capacity_btu');
    expect(failure.reason).toBe('MISSING_UNIT');
    expect(failure.message).toContain('rather than guessing');
  });
});

describe('vocabulary terms are never coerced', () => {
  it('fails on a refrigerant the ontology has never seen', () => {
    const result = normalizeRecord(hvacRecord([value('refrigerant', 'R-BOGUS')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'refrigerant')).toBe(false);
    const failure = failureFor(result, 'refrigerant');
    expect(failure.reason).toBe('UNMAPPED_VOCABULARY_TERM');
    expect(failure.message).toContain("add it to the vertical's vocabulary config");
  });

  it('fails when a rule references a vocabulary the rule set does not declare', () => {
    // `parseNormalizationRuleSet` catches this at load time; the runtime guard is
    // the second line of defence for rule sets assembled programmatically.
    const ruleSet = {
      ...HVAC_RULE_SET,
      vocabularies: {},
    };
    const result = normalizeRecord(hvacRecord(), ruleSet);
    expect(failureFor(result, 'refrigerant').reason).toBe('UNKNOWN_VOCABULARY');
  });
});

describe('missing values', () => {
  it('reports a missing required property, and stays quiet about optional absence', () => {
    const required = parseNormalizationRuleSet({
      id: 'hvac.required.v1',
      version: '1.0.0',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [
        {
          property: 'cooling_capacity_btu',
          source_field: 'cooling_capacity_btu',
          value_type: 'number',
          unit: 'BTU/h',
          required: true,
          transforms: [{ kind: 'quantity', target_unit: 'BTU/h', default_unit: 'BTU/h' }],
        },
        { property: 'hspf2', source_field: 'hspf2', value_type: 'number' },
      ],
      identifiers: [],
    });

    const result = normalizeRecord(
      hvacRecord([value('cooling_capacity_btu', null)]),
      required,
    );
    expect(failureFor(result, 'cooling_capacity_btu').reason).toBe('MISSING_REQUIRED_FIELD');
    // `hspf2` is absent in the fixture and optional: an absent optional field is
    // no claim at all, not a failure.
    expect(result.failures.some((failure) => failure.property === 'hspf2')).toBe(false);
  });

  it('treats the ways sources spell "nothing" as absence, not as a value', () => {
    const result = normalizeRecord(hvacRecord([value('refrigerant', 'N/A')]), HVAC_RULE_SET);
    expect(hasCandidate(result, 'refrigerant')).toBe(false);
    expect(result.failures.some((failure) => failure.property === 'refrigerant')).toBe(false);
  });

  it('reports a required identifier that normalizes away to nothing', () => {
    const result = normalizeRecord(hvacRecord([value('model_number', '---')]), HVAC_RULE_SET);
    expect(result.identifiers.some((item) => item.alias_type === 'model_number')).toBe(false);
    expect(failureFor(result, 'model_number').reason).toBe('MISSING_REQUIRED_FIELD');
  });

  it('reports an identifier with no matchable characters', () => {
    const result = normalizeRecord(hvacRecord([value('ahri_ref', 'pending')]), HVAC_RULE_SET);
    expect(result.identifiers.some((item) => item.alias_type === 'ahri_ref')).toBe(false);
    expect(failureFor(result, 'ahri_ref').reason).toBe('IDENTIFIER_EMPTY_AFTER_NORMALIZATION');
  });
});

describe('failure shape', () => {
  it('always carries a reason, a message and the offending locator', () => {
    const result = normalizeRecord(
      hvacRecord([
        value('seer2', 'call for pricing'),
        value('refrigerant', 'R-BOGUS'),
        value('cooling_capacity_btu', '36,000 lb'),
      ]),
      HVAC_RULE_SET,
    );

    expect(result.failures.length).toBeGreaterThanOrEqual(3);
    for (const failure of result.failures) {
      expect(NORMALIZATION_FAILURE_REASONS).toContain(failure.reason);
      expect(failure.message.length).toBeGreaterThan(0);
      expect(failure.source_field).not.toBeNull();
      expect(failure.locator).not.toBeNull();
      expect(failure.source_value).not.toBeNull();
    }
  });

  it('keeps normalizing the rest of the record after a failure', () => {
    const result = normalizeRecord(hvacRecord([value('seer2', 'call for pricing')]), HVAC_RULE_SET);
    expect(result.failures).toHaveLength(1);
    expect(hasCandidate(result, 'cooling_capacity_btu')).toBe(true);
    expect(result.identifiers.length).toBeGreaterThan(0);
  });
});
