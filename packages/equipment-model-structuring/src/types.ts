export const PARSER_VERSION = 'equipment-model-structuring@1';

/** One row of the EPA ENERGY STAR Certified Products Model Index (`data.energystar.gov` dataset 8wj2-sec8), as published. */
export interface EnergyStarModelRow {
  readonly pd_id: string;
  readonly energy_star_partner: string;
  readonly product_category: string;
  readonly product_type: string;
  readonly brand_name: string;
  readonly model_name: string;
  readonly model_number: string;
  readonly additional_model_information: string;
  readonly upc: string;
  readonly date_available_on_market: string;
  readonly date_certified: string;
  readonly markets: string;
  readonly energy_star_model_identifier: string;
  readonly meets_most_efficient_criteria: string;
}

export const TRADES = ['hvac', 'plumbing', 'electrical', 'appliance', 'electronics', 'commercial-food', 'building-envelope', 'lab'] as const;
export type Trade = (typeof TRADES)[number];

/** Market names as ENERGY STAR prints them, and the ISO 3166-1 code each maps to. */
export const MARKETS: Readonly<Record<string, string>> = {
  'United States': 'US',
  Canada: 'CA',
  Japan: 'JP',
  Taiwan: 'TW',
  Switzerland: 'CH',
};

export interface StructuredEquipmentModel {
  readonly parser_version: typeof PARSER_VERSION;
  readonly source: 'ENERGY_STAR';
  /** `pd_id`: ENERGY STAR's record id, stable across snapshots. */
  readonly source_id: string;
  /** `energy_star_model_identifier`. */
  readonly listing_id: string;
  /** `energy_star_partner`: the company that filed the certification. */
  readonly filer: string;
  readonly brand: string;
  readonly brand_key: string;
  /** `model_number` as printed, which may be a family pattern (`*`, `?`, `#` placeholders). */
  readonly model_number: string;
  readonly model_key: string;
  readonly model_is_pattern: boolean;
  readonly model_name: string | null;
  readonly additional_info: string | null;
  readonly category: string;
  readonly product_type: string | null;
  readonly trade: Trade;
  /** Check-digit-valid GTIN-14s read from `upc`; only these may link automatically. */
  readonly gtins: readonly string[];
  /** Codes in `upc` that failed the GS1 check digit: kept for audit, never linked. */
  readonly rejected_upcs: readonly string[];
  /** ISO 3166-1 alpha-2 codes, sorted. */
  readonly markets: readonly string[];
  /** Market names that are not in MARKETS, kept verbatim. */
  readonly unknown_markets: readonly string[];
  readonly date_available: string | null;
  readonly date_certified: string | null;
  readonly most_efficient: boolean | null;
}
