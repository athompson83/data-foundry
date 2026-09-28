import type { HazardClass, RemedyClass, TradeFacet } from './taxonomy.js';
import type { UnitCounts } from './units.js';

/**
 * Bumped whenever stored output can change, so the sync rewrites every record.
 * @2: 8-digit UPCs are indexed as EAN-8 and as UPC-E expanded to UPC-A (each on its own check digit),
 * CPSC Products[].Model values are read as models and Products[].Description as prose, and provenance names both
 * (3 of 10,027 CPSC notices gain identifiers; every CPSC notice's derived_fields changes).
 */
export const PARSER_VERSION = 'product-recall-structuring@2';

export type Agency = 'CPSC' | 'HC';

/** An agency named by a declared citation or a joint-recall marker. */
export type CounterpartAgency = 'CPSC' | 'HC' | 'HC-LEGACY' | 'TC' | 'PROFECO' | 'ACCC' | 'OTHER';

export interface CrossReference {
  readonly agency: CounterpartAgency;
  /** The cited URL, canonicalised (https, no trailing slash, English path for Health Canada). */
  readonly url: string;
}

export interface RecallProduct {
  readonly name: string;
  readonly type: string | null;
  readonly units: UnitCounts;
}

export interface FirmMention {
  readonly name: string;
  readonly role: 'manufacturer' | 'importer' | 'distributor' | 'retailer';
}

/** One agency notice, structured. Every derived field names its source fields in provenance.derived_fields. */
export interface StructuredProductRecall {
  /** Stable Data Foundry id: `cpsc-<RecallNumber>` or `hc-<NID>`. */
  readonly id: string;
  readonly agency: Agency;
  readonly jurisdiction: 'US' | 'CA';
  readonly source_id: string;
  readonly title: string;
  readonly url: string;
  readonly published_on: string | null;
  readonly updated_on: string | null;
  readonly archived: boolean | null;
  readonly recall_class: string | null;
  readonly product_category: string | null;
  readonly products: RecallProduct[];
  /** The firm or brand that leads the notice title ("5Color Recalls …"); null when the title does not name one. */
  readonly title_firm: string | null;
  readonly firms: FirmMention[];
  readonly sold_at: string[];
  readonly manufacturer_countries: string[];
  readonly description: string | null;
  readonly hazard: { readonly classes: HazardClass[]; readonly text: string | null };
  readonly remedy: { readonly classes: RemedyClass[]; readonly text: string | null };
  readonly injuries: string | null;
  readonly units: UnitCounts;
  readonly identifiers: { readonly gtins: string[]; readonly model_numbers: string[]; readonly model_keys: string[] };
  readonly trade_facets: TradeFacet[];
  /** Declared citations of another agency's notice (CPSC "In conjunction with" links). */
  readonly cross_references: CrossReference[];
  /** Agencies named by a joint-recall marker in the notice text: evidence for a reviewed link, never a link by itself. */
  readonly joint_with: CounterpartAgency[];
  readonly provenance: {
    readonly source: 'cpsc-recalls' | 'health-canada-consumer-product-recalls';
    readonly source_url: string;
    readonly parser_version: string;
    readonly derived_fields: Readonly<Record<string, readonly string[]>>;
  };
}
