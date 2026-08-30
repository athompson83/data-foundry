import { extractionConfidence, type ExtractionConfidence } from '@data-foundry/canonical-schema';
import {
  parseNormalizationRuleSet,
  type EvidenceLocator,
  type NormalizationRuleSet,
  type SourceNativeRecord,
  type SourceNativeValue,
} from '../src/index.js';

/**
 * Fixtures for the HVAC vertical vocabulary that the vertical-config wave is
 * building against:
 *
 * - entity types: `manufacturer`, `equipment_model`, `certification`
 * - alias types:  `model_number`, `ahri_ref`, `manufacturer_sku`, `upc`, `series_name`
 * - properties:   `cooling_capacity_btu`, `nominal_tonnage`, `seer2`, `eer2`,
 *                 `hspf2`, `refrigerant`, `voltage`, `phase`, `stage_count`,
 *                 `sound_level_db`, `weight_lb`, `product_type`
 *
 * The rule set below is written the way a vertical would ship it: plain data,
 * validated by `parseNormalizationRuleSet`. Nothing in `src/` knows any of these
 * names.
 */

export const HVAC_RULE_SET: NormalizationRuleSet = parseNormalizationRuleSet({
  id: 'hvac.equipment_model.v1',
  version: '1.0.0',
  vertical: 'hvac',
  entity_types: ['equipment_model'],
  vocabularies: {
    refrigerant: {
      id: 'refrigerant',
      terms: {
        'R-410A': ['R410A', 'R 410A', 'r-410a', 'Puron', 'HFC-410A'],
        'R-32': ['R32', 'R 32', 'HFC-32'],
        'R-454B': ['R454B', 'R 454B', 'Puron Advance'],
        'R-22': ['R22', 'HCFC-22', 'Freon 22'],
      },
    },
    product_type: {
      id: 'product_type',
      terms: {
        air_conditioner: ['Air Conditioner', 'AC', 'Split System Air Conditioner', 'Condenser'],
        heat_pump: ['Heat Pump', 'HP', 'Split System Heat Pump'],
        furnace: ['Furnace', 'Gas Furnace'],
        air_handler: ['Air Handler', 'AHU', 'Fan Coil'],
      },
    },
  },
  properties: [
    {
      property: 'cooling_capacity_btu',
      source_field: 'cooling_capacity_btu',
      value_type: 'number',
      unit: 'BTU/h',
      required: true,
      transforms: [{ kind: 'quantity', target_unit: 'BTU/h', default_unit: 'BTU/h' }],
    },
    {
      property: 'nominal_tonnage',
      source_field: 'cooling_capacity_btu',
      value_type: 'number',
      output_kind: 'DERIVED_METRIC',
      derived_from_property: 'cooling_capacity_btu',
      transformation_ref: 'hvac.nominal_tonnage.from.cooling_capacity_btu.v1',
      unit: 'ton',
      transforms: [
        { kind: 'quantity', target_unit: 'ton', default_unit: 'BTU/h' },
        { kind: 'round', decimals: 2 },
      ],
    },
    { property: 'seer2', source_field: 'seer2', value_type: 'number' },
    { property: 'eer2', source_field: 'eer2', value_type: 'number' },
    { property: 'hspf2', source_field: 'hspf2', value_type: 'number' },
    {
      property: 'refrigerant',
      source_field: 'refrigerant',
      value_type: 'string',
      transforms: [{ kind: 'vocabulary', vocabulary: 'refrigerant' }],
    },
    {
      property: 'voltage',
      source_field: 'voltage',
      value_type: 'number',
      unit: 'V',
      transforms: [
        // `208/230` is a dual-voltage rating; the vertical publishes the nominal
        // upper figure and says so in config rather than in code.
        { kind: 'replace', pattern: '^\\s*\\d+\\s*/\\s*(\\d+)', replacement: '$1' },
        { kind: 'quantity', target_unit: 'V', default_unit: 'V' },
      ],
    },
    { property: 'phase', source_field: 'phase', value_type: 'integer' },
    { property: 'stage_count', source_field: 'stage_count', value_type: 'integer' },
    {
      property: 'sound_level_db',
      source_field: 'sound_level_db',
      value_type: 'number',
      unit: 'dB',
      transforms: [{ kind: 'quantity', target_unit: 'dB', default_unit: 'dB' }],
    },
    {
      property: 'weight_lb',
      source_field: 'weight_lb',
      value_type: 'number',
      unit: 'lb',
      transforms: [
        { kind: 'quantity', target_unit: 'lb', default_unit: 'lb' },
        { kind: 'round', decimals: 2 },
      ],
    },
    {
      property: 'product_type',
      source_field: 'product_type',
      value_type: 'string',
      transforms: [{ kind: 'vocabulary', vocabulary: 'product_type' }],
    },
  ],
  identifiers: [
    { alias_type: 'model_number', source_field: 'model_number', required: true },
    { alias_type: 'ahri_ref', source_field: 'ahri_ref' },
    { alias_type: 'manufacturer_sku', source_field: 'manufacturer_sku' },
    { alias_type: 'upc', source_field: 'upc' },
    { alias_type: 'series_name', source_field: 'series_name' },
  ],
});

export const CSS = (selector: string): EvidenceLocator => ({
  type: 'CSS_SELECTOR',
  value: selector,
});

export const POINTER = (pointer: string): EvidenceLocator => ({
  type: 'JSON_POINTER',
  value: pointer,
});

export const FIXTURE_EXTRACTION_CONFIDENCE: ExtractionConfidence = extractionConfidence(0.9157);

export const value = (
  field: string,
  raw: string | null,
  locator: EvidenceLocator = POINTER(`/${field}`),
): SourceNativeValue => ({ field, raw, locator });

/**
 * A record shaped exactly as `@data-foundry/extraction` emits one, written as a
 * literal here because normalization must not depend on any particular
 * extraction provider package.
 */
export const hvacRecord = (
  overrides: readonly SourceNativeValue[] = [],
): SourceNativeRecord => {
  const base: SourceNativeValue[] = [
    value('model_number', '24ACC6-36A003', CSS('article > h1')),
    value('series_name', 'Infinity 16'),
    value('manufacturer_sku', 'CAR-24ACC636A003'),
    value('ahri_ref', '00202584720'),
    value('upc', '0-12345-67890-5'),
    value('product_type', 'Split System Air Conditioner'),
    value('cooling_capacity_btu', '36,000 BTU/h', CSS('table > tbody > tr:nth-of-type(1) > td')),
    value('seer2', '15.2'),
    value('eer2', '12.5'),
    value('hspf2', null),
    value('refrigerant', 'Puron'),
    value('voltage', '208/230 V'),
    value('phase', '1'),
    value('stage_count', '1'),
    value('sound_level_db', '72 dB'),
    value('weight_lb', '189.5 lb'),
  ];

  const byField = new Map(base.map((item) => [item.field, item] as const));
  for (const override of overrides) byField.set(override.field, override);

  return {
    source_record_key: '24ACC6-36A003',
    entity_type: 'equipment_model',
    values: [...byField.values()],
    extraction_confidence: FIXTURE_EXTRACTION_CONFIDENCE,
  };
};
