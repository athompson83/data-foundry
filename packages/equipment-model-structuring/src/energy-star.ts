/**
 * EPA ENERGY STAR Model Index rows to equipment_model records. Pure and deterministic: no network, no model, no
 * fuzzy matching. Required fields missing, an unknown category or an unparsable date throw, so a format change stops
 * the build instead of publishing guesses.
 */
import { cleanText, digitCodes, gtin14, modelKey } from '@data-foundry/product-recall-structuring';

import { CATEGORY_TRADE } from './taxonomy.js';
import { MARKETS, PARSER_VERSION, type EnergyStarModelRow, type StructuredEquipmentModel } from './types.js';

export class EquipmentModelParseError extends Error {}

const optional = (value: string | null | undefined): string | null => {
  const text = cleanText(value);
  return text === '' ? null : text;
};

const required = (row: EnergyStarModelRow, field: keyof EnergyStarModelRow): string => {
  const text = optional(row[field]);
  if (text === null) throw new EquipmentModelParseError(`${field} is empty`);
  return text;
};

/** `2010-01-19T00:00:00.000` (Socrata floating timestamp) or `2010-01-19` to `2010-01-19`; empty to null. */
export function listingDate(value: string | null | undefined): string | null {
  const text = optional(value);
  if (text === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?)?$/.exec(text);
  if (!match) throw new EquipmentModelParseError(`unparsable date ${JSON.stringify(text)}`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new EquipmentModelParseError(`invalid date ${date}`);
  }
  return date;
}

/** Model numbers ENERGY STAR files as a family use placeholder characters. */
export const isModelPattern = (model: string): boolean => /[*?#]/.test(model);

/** The UPC field may list several codes. Each code is kept as a GTIN-14 only if its GS1 check digit is valid. */
export function readUpcs(value: string | null | undefined): { gtins: string[]; rejected: string[] } {
  const gtins = new Set<string>();
  const rejected = new Set<string>();
  for (const code of digitCodes(value)) {
    const gtin = gtin14(code);
    if (gtin) gtins.add(gtin);
    else rejected.add(code);
  }
  return { gtins: [...gtins].sort(), rejected: [...rejected].sort() };
}

export function readMarkets(value: string | null | undefined): { markets: string[]; unknown: string[] } {
  const markets = new Set<string>();
  const unknown = new Set<string>();
  for (const name of (value ?? '').split(',').map((part) => cleanText(part)).filter(Boolean)) {
    const code = MARKETS[name];
    if (code) markets.add(code);
    else unknown.add(name);
  }
  return { markets: [...markets].sort(), unknown: [...unknown].sort() };
}

const mostEfficient = (value: string | null | undefined): boolean | null => {
  const text = optional(value);
  if (text === null) return null;
  if (text === 'Yes') return true;
  if (text === 'No') return false;
  throw new EquipmentModelParseError(`unexpected meets_most_efficient_criteria ${JSON.stringify(text)}`);
};

export function structureEnergyStarModel(row: EnergyStarModelRow): StructuredEquipmentModel {
  const sourceId = required(row, 'pd_id');
  if (!/^\d+$/.test(sourceId)) throw new EquipmentModelParseError(`pd_id ${JSON.stringify(sourceId)} is not numeric`);
  const category = required(row, 'product_category');
  const trade = CATEGORY_TRADE[category];
  if (!trade) throw new EquipmentModelParseError(`unknown product_category ${JSON.stringify(category)}`);
  const brand = required(row, 'brand_name');
  const modelNumber = required(row, 'model_number');
  const upcs = readUpcs(row.upc);
  const markets = readMarkets(row.markets);
  return {
    parser_version: PARSER_VERSION,
    source: 'ENERGY_STAR',
    source_id: sourceId,
    listing_id: required(row, 'energy_star_model_identifier'),
    filer: required(row, 'energy_star_partner'),
    brand,
    brand_key: modelKey(brand),
    model_number: modelNumber,
    model_key: modelKey(modelNumber),
    model_is_pattern: isModelPattern(modelNumber),
    model_name: optional(row.model_name),
    additional_info: optional(row.additional_model_information),
    category,
    product_type: optional(row.product_type),
    trade,
    gtins: upcs.gtins,
    rejected_upcs: upcs.rejected,
    markets: markets.markets,
    unknown_markets: markets.unknown,
    date_available: listingDate(row.date_available_on_market),
    date_certified: listingDate(row.date_certified),
    most_efficient: mostEfficient(row.meets_most_efficient_criteria),
  };
}
