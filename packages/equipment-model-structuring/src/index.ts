/**
 * Certified equipment-model listings structured into one equipment_model shape. First source: the EPA ENERGY STAR
 * Model Index (rights record docs/sources/equipment-energystar-model-index-rights-record-20260930.md). Identity links
 * only on declared keys: the source id and check-digit-valid GTINs. Brand and model keys only propose review links.
 */
export { EquipmentModelParseError, isModelPattern, listingDate, readMarkets, readUpcs, structureEnergyStarModel } from './energy-star.js';
export { CATEGORY_TRADE } from './taxonomy.js';
export { MARKETS, PARSER_VERSION, TRADES, type EnergyStarModelRow, type StructuredEquipmentModel, type Trade } from './types.js';
