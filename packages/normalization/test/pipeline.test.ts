import { rawScore } from '@data-foundry/canonical-schema';
import { describe, expect, it } from 'vitest';
import {
  normalizeRecord,
  normalizeRecords,
  rawNormalizationConfidence,
  type CanonicalCandidate,
  type IdentifierCandidate,
  type NormalizationResult,
} from '../src/index.js';
import { CSS, FIXTURE_EXTRACTION_CONFIDENCE, HVAC_RULE_SET, hvacRecord, value } from './fixtures.js';

const candidate = (result: NormalizationResult, property: string): CanonicalCandidate => {
  const found = result.candidates.find((item) => item.property === property);
  if (found === undefined) throw new Error(`no candidate for ${property}`);
  return found;
};

const alias = (result: NormalizationResult, aliasType: string): IdentifierCandidate => {
  const found = result.identifiers.find((item) => item.alias_type === aliasType);
  if (found === undefined) throw new Error(`no identifier for ${aliasType}`);
  return found;
};

describe('normalizeRecord — golden HVAC record', () => {
  const result = normalizeRecord(hvacRecord(), HVAC_RULE_SET);

  it('emits typed canonical candidates for every mapped property', () => {
    expect(result.failures).toEqual([]);
    expect(result.candidates.map((item) => item.property).sort()).toEqual([
      'cooling_capacity_btu',
      'eer2',
      'nominal_tonnage',
      'phase',
      'product_type',
      'refrigerant',
      'seer2',
      'sound_level_db',
      'stage_count',
      'voltage',
      'weight_lb',
    ]);
  });

  it('carries property + value + type + unit + confidence + locator on each candidate', () => {
    const capacity = candidate(result, 'cooling_capacity_btu');
    expect(capacity).toMatchObject({
      property: 'cooling_capacity_btu',
      normalized_value: 36_000,
      value_type: 'number',
      unit: 'BTU/h',
      source_field: 'cooling_capacity_btu',
      source_value: '36,000 BTU/h',
      source_unit: 'BTU/h',
    });
    expect(capacity.locator).toEqual(CSS('table > tbody > tr:nth-of-type(1) > td'));
    expect(rawNormalizationConfidence(capacity.confidence)).toBe(1);
    // Extraction's score is carried, never merged into normalization's.
    expect(rawScore(capacity.extraction_confidence)).toBe(
      rawScore(FIXTURE_EXTRACTION_CONFIDENCE),
    );
    expect(capacity.transforms).toEqual(['primitive_cleanup', 'quantity']);
  });

  it('converts 36,000 BTU/h to 3 tons from the same source field', () => {
    expect(candidate(result, 'nominal_tonnage')).toMatchObject({
      normalized_value: 3,
      unit: 'ton',
      source_unit: 'BTU/h',
      source_value: '36,000 BTU/h',
    });
  });

  it('retains the source unit alongside the canonical one', () => {
    for (const property of ['cooling_capacity_btu', 'nominal_tonnage', 'sound_level_db', 'weight_lb', 'voltage']) {
      const item = candidate(result, property);
      expect(item.unit).not.toBeNull();
      expect(item.source_value.length).toBeGreaterThan(0);
    }
    expect(candidate(result, 'sound_level_db')).toMatchObject({
      normalized_value: 72,
      unit: 'dB',
      source_unit: 'dB',
    });
    expect(candidate(result, 'weight_lb')).toMatchObject({ normalized_value: 189.5, unit: 'lb' });
  });

  it('maps vocabulary terms to the canonical ontology', () => {
    expect(candidate(result, 'refrigerant')).toMatchObject({
      normalized_value: 'R-410A',
      value_type: 'string',
      source_value: 'Puron',
    });
    expect(candidate(result, 'product_type')).toMatchObject({
      normalized_value: 'air_conditioner',
      source_value: 'Split System Air Conditioner',
    });
  });

  it('applies vertical-configured transforms to dual-voltage notation', () => {
    expect(candidate(result, 'voltage')).toMatchObject({
      normalized_value: 230,
      unit: 'V',
      source_value: '208/230 V',
    });
  });

  it('emits identifiers with the display form preserved and a matching form beside it', () => {
    expect(alias(result, 'model_number')).toMatchObject({
      alias_value: '24ACC6-36A003',
      normalized_value: '24ACC636A003',
    });
    expect(alias(result, 'ahri_ref')).toMatchObject({
      alias_value: '00202584720',
      normalized_value: '202584720',
    });
    expect(alias(result, 'upc')).toMatchObject({
      alias_value: '0-12345-67890-5',
      normalized_value: '012345678905',
    });
    expect(alias(result, 'series_name')).toMatchObject({
      alias_value: 'Infinity 16',
      normalized_value: 'INFINITY16',
    });
  });

  it('gives every candidate and identifier the originating locator', () => {
    for (const item of [...result.candidates, ...result.identifiers]) {
      expect(item.locator).toBeDefined();
      expect(item.locator.type.length).toBeGreaterThan(0);
      expect(item.locator.value.length).toBeGreaterThan(0);
    }
  });

  it('builds a normalized_payload that keeps values, units and both identifier forms', () => {
    expect(result.normalized_payload).toEqual({
      properties: {
        cooling_capacity_btu: 36_000,
        nominal_tonnage: 3,
        seer2: 15.2,
        eer2: 12.5,
        refrigerant: 'R-410A',
        voltage: 230,
        phase: 1,
        stage_count: 1,
        sound_level_db: 72,
        weight_lb: 189.5,
        product_type: 'air_conditioner',
      },
      units: {
        cooling_capacity_btu: 'BTU/h',
        nominal_tonnage: 'ton',
        voltage: 'V',
        sound_level_db: 'dB',
        weight_lb: 'lb',
      },
      identifiers: {
        model_number: '24ACC636A003',
        ahri_ref: '202584720',
        manufacturer_sku: 'CAR24ACC636A003',
        upc: '012345678905',
        series_name: 'INFINITY16',
      },
      identifier_display: {
        model_number: '24ACC6-36A003',
        ahri_ref: '00202584720',
        manufacturer_sku: 'CAR-24ACC636A003',
        upc: '0-12345-67890-5',
        series_name: 'Infinity 16',
      },
    });
  });

  it('stamps the rule set that produced the result', () => {
    expect(result.rule_set_id).toBe('hvac.equipment_model.v1');
    expect(result.rule_set_version).toBe('1.0.0');
  });

  it('produces no canonical entity: nothing here resolves identity', () => {
    const asRecord = result as unknown as Record<string, unknown>;
    for (const forbidden of ['entity_id', 'canonical_name', 'identity_confidence', 'merged_into']) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });
});

describe('determinism', () => {
  it('produces byte-identical output for identical input', () => {
    const first = normalizeRecord(hvacRecord(), HVAC_RULE_SET);
    const second = normalizeRecord(hvacRecord(), HVAC_RULE_SET);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on the order records are processed in', () => {
    const records = [hvacRecord(), hvacRecord([value('seer2', '14.8')])];
    const forwards = normalizeRecords(records, HVAC_RULE_SET);
    const backwards = normalizeRecords([...records].reverse(), HVAC_RULE_SET);
    expect(JSON.stringify(backwards[1])).toBe(JSON.stringify(forwards[0]));
    expect(JSON.stringify(backwards[0])).toBe(JSON.stringify(forwards[1]));
  });

  it('refuses a rule set aimed at a different entity type', () => {
    const manufacturer = { ...hvacRecord(), entity_type: 'manufacturer' };
    expect(() => normalizeRecord(manufacturer, HVAC_RULE_SET)).toThrow(/cannot normalize/);
  });
});

describe('confidence', () => {
  it('is full for an exact deterministic mapping', () => {
    const result = normalizeRecord(hvacRecord(), HVAC_RULE_SET);
    for (const item of result.candidates) {
      expect(rawNormalizationConfidence(item.confidence)).toBe(1);
    }
  });

  it('drops when a unit had to be assumed', () => {
    // `36000` with no unit: the rule's `default_unit` supplies BTU/h, and that
    // assumption is recorded rather than hidden.
    const result = normalizeRecord(hvacRecord([value('cooling_capacity_btu', '36000')]), HVAC_RULE_SET);
    const capacity = candidate(result, 'cooling_capacity_btu');
    expect(capacity.normalized_value).toBe(36_000);
    expect(capacity.source_unit).toBeNull();
    expect(rawNormalizationConfidence(capacity.confidence)).toBeLessThan(1);
  });

  it('never mixes normalization confidence into extraction confidence', () => {
    const result = normalizeRecord(hvacRecord([value('cooling_capacity_btu', '36000')]), HVAC_RULE_SET);
    const capacity = candidate(result, 'cooling_capacity_btu');
    expect(rawScore(capacity.extraction_confidence)).toBe(rawScore(FIXTURE_EXTRACTION_CONFIDENCE));
    expect(rawNormalizationConfidence(capacity.confidence)).not.toBe(
      rawScore(capacity.extraction_confidence),
    );
  });
});
