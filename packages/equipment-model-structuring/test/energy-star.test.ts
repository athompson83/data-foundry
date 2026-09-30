import { describe, expect, it } from 'vitest';

import {
  CATEGORY_TRADE,
  EquipmentModelParseError,
  listingDate,
  readMarkets,
  readUpcs,
  structureEnergyStarModel,
  type EnergyStarModelRow,
} from '../src/index.js';

// Golden rows copied verbatim from data.energystar.gov dataset 8wj2-sec8 (retrieved 2026-09-30).
const griddle: EnergyStarModelRow = {
  pd_id: '1723365',
  energy_star_partner: 'Taylor Company',
  product_category: 'Commercial Griddles',
  product_type: 'Double-Sided',
  brand_name: 'Taylor Company',
  model_name: 'Gas/Electric Griddle',
  model_number: 'C835-23',
  additional_model_information: '',
  upc: '',
  date_available_on_market: '2010-01-19T00:00:00.000',
  date_certified: '2011-03-31T00:00:00.000',
  markets: 'United States, Canada',
  energy_star_model_identifier: 'ES_1084409_C835-23_05312012101933_1000066',
  meets_most_efficient_criteria: 'No',
};
const patterned: EnergyStarModelRow = {
  ...griddle,
  pd_id: '1728315',
  energy_star_partner: 'Accutemp Products, Inc.',
  product_type: 'Single-Sided',
  brand_name: 'AccuTemp',
  model_name: 'Accu-Steam',
  model_number: 'GGF*****24',
  date_available_on_market: '2002-01-01T00:00:00.000',
  date_certified: '2011-04-07T00:00:00.000',
  energy_star_model_identifier: 'ES_1105798_ACCUTEMP PRODUCTS INC (263239) | GGF*****24_06042012212558_5158876',
};
const downlight: EnergyStarModelRow = {
  pd_id: '4517922',
  energy_star_partner: 'Plusrite USA',
  product_category: 'Downlights',
  product_type: 'Downlight Surface Mount',
  brand_name: 'NaturaLED',
  model_name: 'LED7FMD-98L9CCT5',
  model_number: 'LED7FMD-98L9CCT5',
  additional_model_information: '',
  upc: '844366097492',
  date_available_on_market: '2025-10-15T00:00:00.000',
  date_certified: '2025-12-09T00:00:00.000',
  markets: 'United States, Canada',
  energy_star_model_identifier: 'ES_1126714_LED7FMD-98L9CCT5_120920250508608_1995525',
  meets_most_efficient_criteria: 'No',
};

describe('ENERGY STAR Model Index', () => {
  it('structures a listing with its keys, trade, markets and dates', () => {
    expect(structureEnergyStarModel(griddle)).toEqual({
      parser_version: 'equipment-model-structuring@1',
      source: 'ENERGY_STAR',
      source_id: '1723365',
      listing_id: 'ES_1084409_C835-23_05312012101933_1000066',
      filer: 'Taylor Company',
      brand: 'Taylor Company',
      brand_key: 'TAYLORCOMPANY',
      model_number: 'C835-23',
      model_key: 'C83523',
      model_is_pattern: false,
      model_name: 'Gas/Electric Griddle',
      additional_info: null,
      category: 'Commercial Griddles',
      product_type: 'Double-Sided',
      trade: 'commercial-food',
      gtins: [],
      rejected_upcs: [],
      markets: ['CA', 'US'],
      unknown_markets: [],
      date_available: '2010-01-19',
      date_certified: '2011-03-31',
      most_efficient: false,
    });
  });

  it('flags a model family filed as a pattern', () => {
    const model = structureEnergyStarModel(patterned);
    expect(model.model_is_pattern).toBe(true);
    expect(model.model_number).toBe('GGF*****24');
  });

  it('keeps only check-digit-valid GTINs, and keeps rejected codes for audit', () => {
    expect(structureEnergyStarModel(downlight).gtins).toEqual(['00844366097492']);
    expect(readUpcs('844366097493')).toEqual({ gtins: [], rejected: ['844366097493'] });
    expect(readUpcs('844366097492, 844366097492')).toEqual({ gtins: ['00844366097492'], rejected: [] });
    // An 11-digit code is not a GTIN as printed, even when a leading zero would make it valid: never a guess.
    expect(readUpcs('14817627848')).toEqual({ gtins: [], rejected: ['14817627848'] });
  });

  it('maps market names to ISO codes and keeps unknown names verbatim', () => {
    expect(readMarkets('United States, Switzerland, Taiwan, Japan, Canada').markets).toEqual(['CA', 'CH', 'JP', 'TW', 'US']);
    expect(readMarkets('United States, Atlantis')).toEqual({ markets: ['US'], unknown: ['Atlantis'] });
    expect(readMarkets('')).toEqual({ markets: [], unknown: [] });
  });

  it('reads Socrata floating timestamps as dates and refuses anything else', () => {
    expect(listingDate('2025-12-09T00:00:00.000')).toBe('2025-12-09');
    expect(listingDate('')).toBeNull();
    expect(() => listingDate('12/09/2025')).toThrow(EquipmentModelParseError);
    expect(() => listingDate('2025-02-30T00:00:00.000')).toThrow(EquipmentModelParseError);
  });

  it('fails closed on a missing identity field, an unknown category or an unexpected flag', () => {
    expect(() => structureEnergyStarModel({ ...griddle, model_number: ' ' })).toThrow(/model_number is empty/);
    expect(() => structureEnergyStarModel({ ...griddle, brand_name: '' })).toThrow(/brand_name is empty/);
    expect(() => structureEnergyStarModel({ ...griddle, pd_id: 'x1' })).toThrow(/not numeric/);
    expect(() => structureEnergyStarModel({ ...griddle, product_category: 'Hovercraft' })).toThrow(/unknown product_category/);
    expect(() => structureEnergyStarModel({ ...griddle, meets_most_efficient_criteria: 'Maybe' })).toThrow(EquipmentModelParseError);
  });

  it('assigns every category a trade', () => {
    expect(Object.keys(CATEGORY_TRADE)).toHaveLength(47);
  });
});
