import { describe, expect, it } from 'vitest';
import {
  NormalizationRuleSetError,
  mapVocabulary,
  normalizeRecord,
  parseNormalizationRuleSet,
  ruleSetAppliesTo,
  vocabularyKey,
  type VocabularyDefinition,
} from '../src/index.js';
import { HVAC_RULE_SET, hvacRecord, value } from './fixtures.js';

/**
 * Rule 4 in practice: a vertical adds a field, a vocabulary or a whole entity
 * type by editing configuration. These tests extend the HVAC rule set at runtime
 * with data alone — no new TypeScript, no change to `src/`.
 */
describe('vertical config extensibility', () => {
  it('adds a new property to an existing vertical with data alone', () => {
    const extended = parseNormalizationRuleSet({
      ...HVAC_RULE_SET,
      version: '1.1.0',
      properties: [
        ...HVAC_RULE_SET.properties,
        {
          property: 'refrigerant_charge_lb',
          source_field: 'charge',
          value_type: 'number',
          unit: 'lb',
          transforms: [
            { kind: 'quantity', target_unit: 'lb' },
            { kind: 'round', decimals: 2 },
          ],
        },
      ],
    });

    const result = normalizeRecord(hvacRecord([value('charge', '2.5 kg')]), extended);
    const charge = result.candidates.find((item) => item.property === 'refrigerant_charge_lb');
    expect(charge).toMatchObject({ normalized_value: 5.51, unit: 'lb', source_unit: 'kg' });
  });

  it('supports a second vertical from the same engine', () => {
    const marine = parseNormalizationRuleSet({
      id: 'marine.vessel.v1',
      version: '1.0.0',
      vertical: 'marine',
      entity_types: ['vessel'],
      vocabularies: {
        hull_material: {
          id: 'hull_material',
          terms: { fiberglass: ['GRP', 'Glass Reinforced Plastic', 'FRP'], aluminium: ['Aluminum'] },
        },
      },
      properties: [
        {
          property: 'length_overall_in',
          source_field: 'loa',
          value_type: 'number',
          unit: 'in',
          transforms: [{ kind: 'quantity', target_unit: 'in' }],
        },
        {
          property: 'hull_material',
          source_field: 'hull',
          value_type: 'string',
          transforms: [{ kind: 'vocabulary', vocabulary: 'hull_material' }],
        },
      ],
      identifiers: [{ alias_type: 'hull_id', source_field: 'hin', required: true }],
    });

    const result = normalizeRecord(
      {
        source_record_key: 'HIN-123',
        entity_type: 'vessel',
        extraction_confidence: hvacRecord().extraction_confidence,
        values: [
          value('loa', '32 ft'),
          value('hull', 'GRP'),
          value('hin', 'us-abc12345d404'),
        ],
      },
      marine,
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates.map((item) => [item.property, item.normalized_value])).toEqual([
      ['length_overall_in', 384],
      ['hull_material', 'fiberglass'],
    ]);
    expect(result.identifiers[0]).toMatchObject({
      alias_type: 'hull_id',
      alias_value: 'us-abc12345d404',
      normalized_value: 'USABC12345D404',
    });
  });

  it('scopes a rule set to the entity types it declares', () => {
    expect(ruleSetAppliesTo(HVAC_RULE_SET, 'equipment_model')).toBe(true);
    expect(ruleSetAppliesTo(HVAC_RULE_SET, 'manufacturer')).toBe(false);
  });
});

describe('parseNormalizationRuleSet', () => {
  it('accepts the shipped HVAC rule set', () => {
    expect(() => parseNormalizationRuleSet(HVAC_RULE_SET)).not.toThrow();
  });

  it('rejects a property whose name is not a canonical identifier', () => {
    expect(() =>
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [{ property: 'coolingCapacity', source_field: 'a', value_type: 'number' }],
        identifiers: [],
      }),
    ).toThrow(/lowercase snake_case/);
  });

  it('rejects an unknown value type and an unknown transform kind', () => {
    expect(() =>
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [{ property: 'a', source_field: 'a', value_type: 'quaternion' }],
        identifiers: [],
      }),
    ).toThrow(NormalizationRuleSetError);

    expect(() =>
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [
          { property: 'a', source_field: 'a', value_type: 'string', transforms: [{ kind: 'vibes' }] },
        ],
        identifiers: [],
      }),
    ).toThrow(/unknown transform kind vibes/);
  });

  it('rejects a transform pointing at a vocabulary that is not declared', () => {
    expect(() =>
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [
          {
            property: 'refrigerant',
            source_field: 'refrigerant',
            value_type: 'string',
            transforms: [{ kind: 'vocabulary', vocabulary: 'missing' }],
          },
        ],
        identifiers: [],
      }),
    ).toThrow(/vocabulary missing is not declared/);
  });

  it('rejects an invalid replace pattern at load time', () => {
    expect(() =>
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [
          {
            property: 'a',
            source_field: 'a',
            value_type: 'string',
            transforms: [{ kind: 'replace', pattern: '([', replacement: '' }],
          },
        ],
        identifiers: [],
      }),
    ).toThrow(/invalid regular expression/);
  });

  it('rejects duplicate properties and names the path', () => {
    try {
      parseNormalizationRuleSet({
        id: 'x',
        version: '1',
        vertical: 'hvac',
        entity_types: ['equipment_model'],
        properties: [
          { property: 'seer2', source_field: 'a', value_type: 'number' },
          { property: 'seer2', source_field: 'b', value_type: 'number' },
        ],
        identifiers: [],
      });
      throw new Error('expected a rule set error');
    } catch (error) {
      expect(error).toBeInstanceOf(NormalizationRuleSetError);
      expect((error as NormalizationRuleSetError).path).toBe('rule_set.properties[1]');
    }
  });

  it('orders a reverse-declared multi-level derived graph from inputs to outputs', () => {
    const parsed = parseNormalizationRuleSet({
      id: 'graph',
      version: '1',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [
        {
          property: 'grandchild', source_field: 'grandchild', value_type: 'number',
          output_kind: 'DERIVED_METRIC', derived_from_property: 'child',
          transformation_ref: 'graph.grandchild.v1',
        },
        {
          property: 'child', source_field: 'child', value_type: 'number',
          output_kind: 'DERIVED_METRIC', derived_from_property: 'root',
          transformation_ref: 'graph.child.v1',
        },
        { property: 'root', source_field: 'root', value_type: 'number' },
      ],
      identifiers: [],
    });
    expect(parsed.properties.map((rule) => rule.property)).toEqual(['root', 'child', 'grandchild']);
  });

  it('rejects a derived graph with a missing parent before ingestion can write a partial record', () => {
    expect(() => parseNormalizationRuleSet({
      id: 'missing-parent',
      version: '1',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [{
        property: 'child', source_field: 'child', value_type: 'number',
        output_kind: 'DERIVED_METRIC', derived_from_property: 'absent',
        transformation_ref: 'graph.child.v1',
      }],
      identifiers: [],
    })).toThrow(/derived input property absent is not declared/);
  });

  it('rejects a cyclic derived graph before ingestion can silently skip it', () => {
    expect(() => parseNormalizationRuleSet({
      id: 'cycle',
      version: '1',
      vertical: 'hvac',
      entity_types: ['equipment_model'],
      properties: [
        {
          property: 'first', source_field: 'first', value_type: 'number',
          output_kind: 'DERIVED_METRIC', derived_from_property: 'second',
          transformation_ref: 'graph.first.v1',
        },
        {
          property: 'second', source_field: 'second', value_type: 'number',
          output_kind: 'DERIVED_METRIC', derived_from_property: 'first',
          transformation_ref: 'graph.second.v1',
        },
      ],
      identifiers: [],
    })).toThrow(/derived property cycle/);
  });
});

describe('vocabulary mapping', () => {
  const refrigerants: VocabularyDefinition = {
    id: 'refrigerant',
    terms: { 'R-410A': ['R410A', 'Puron'], 'R-32': ['R32'] },
  };

  it('matches the canonical term, its variants, and neither case nor punctuation', () => {
    expect(mapVocabulary('R-410A', refrigerants)).toMatchObject({
      ok: true,
      value: { term: 'R-410A', via: 'canonical' },
    });
    expect(mapVocabulary('r410a', refrigerants)).toMatchObject({
      ok: true,
      value: { term: 'R-410A', via: 'alias' },
    });
    expect(mapVocabulary('  PURON  ', refrigerants)).toMatchObject({
      ok: true,
      value: { term: 'R-410A', via: 'alias' },
    });
  });

  it('normalizes comparison keys without changing the stored term', () => {
    expect(vocabularyKey('Split System Air Conditioner')).toBe('split_system_air_conditioner');
    expect(vocabularyKey('R-410A')).toBe('r_410a');
  });

  it('lets a vertical opt into passthrough, and flags it', () => {
    expect(mapVocabulary('R-BOGUS', { ...refrigerants, allow_unmapped: true })).toMatchObject({
      ok: true,
      value: { term: 'R-BOGUS', via: 'unmapped' },
    });
  });

  it('lowers confidence when passthrough is used', () => {
    const permissive = parseNormalizationRuleSet({
      ...HVAC_RULE_SET,
      vocabularies: {
        ...HVAC_RULE_SET.vocabularies,
        refrigerant: { id: 'refrigerant', terms: { 'R-410A': ['Puron'] }, allow_unmapped: true },
      },
    });
    const result = normalizeRecord(hvacRecord([value('refrigerant', 'R-BOGUS')]), permissive);
    const candidate = result.candidates.find((item) => item.property === 'refrigerant');
    expect(candidate?.normalized_value).toBe('R-BOGUS');
    expect(Number(candidate?.confidence)).toBeLessThan(1);
  });
});
