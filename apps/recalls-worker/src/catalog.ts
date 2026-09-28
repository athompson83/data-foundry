/**
 * The public dataset catalog: what data.aroqon.com lists and how each product
 * page is filled. One typed entry per dataset; a dataset appears only while it
 * is published (its own gates), so a withdrawn source disappears from the
 * catalog, its product page and its structured data together.
 *
 * Samples are real API output captured on the stated date and abbreviated
 * only by omitting whole fields (never by editing values).
 */

import type { Env } from './env.js';

export type DatasetKey = 'recalls' | 'product-recalls';

export interface DatasetEndpoint {
  readonly method: 'GET';
  readonly path: string;
  readonly summary: string;
  /** Anchor in /docs. */
  readonly docs: string;
}

export interface DatasetField {
  readonly name: string;
  readonly meaning: string;
}

export interface DatasetEntry {
  readonly key: DatasetKey;
  readonly name: string;
  /** Canonical product-page path. */
  readonly path: string;
  /** One sentence: what the buyer gets. */
  readonly summary: string;
  /** Catalog classification, so a long list stays scannable: subject area, what one record is, and where it applies. */
  readonly domain: string;
  readonly recordType: string;
  readonly region: string;
  /** The buyer's problem, as the product-page headline. */
  readonly headline: string;
  readonly lede: string;
  readonly useCases: readonly string[];
  readonly sources: ReadonlyArray<{ readonly name: string; readonly short: string; readonly url: string; readonly terms: string }>;
  readonly limitations: readonly string[];
  /** The configured refresh, stated as an intention; the last successful refresh comes from sync records. */
  readonly refreshSchedule: string;
  readonly statsPath: string;
  readonly endpoints: readonly DatasetEndpoint[];
  readonly fields: readonly DatasetField[];
  readonly sample: {
    readonly request: string;
    readonly capturedOn: string;
    /** Where the sample came from: a response captured from the live API, or the production parser's output before the API was live. */
    readonly origin: 'live-api' | 'parser';
    readonly note: string;
    readonly response: string;
  };
  /** Non-endorsement and licence line shown with the data. */
  readonly attribution: string;
}

const FDA_SAMPLE = {
  data: {
    recall_number: 'H-1275-2026',
    category: 'food',
    event_id: '99493',
    classification: 'II',
    status: 'Ongoing',
    voluntary: true,
    firm: { name: 'Lidl US TRADING', city: 'Arlington', state: 'VA', postal_code: '22202', country: 'United States' },
    dates: { initiated: '2026-07-22', classified: '2026-08-26', reported: '2026-09-02', terminated: null },
    product_description:
      'ERIDANOUS GREEK STYLE Shortbread Cookies with apricot filling and cocoa topping with coconut sprinkles. Product is packed onto a plastic carton tray with outer paper sleeve, 330 g (weight), UPC: 4056489125846.',
    reason_for_recall:
      'The firm discovered that certain units shipped to the U.S. retail stores only has "foreign languages" on the label. Product has undeclared wheat, soy, milk, eggs and tree nut (coconut).',
    distribution: { nationwide_us: false, international: false, us_states: ['DC', 'DE', 'GA', 'MD', 'NC', 'NJ', 'NY', 'PA', 'SC', 'VA'], countries: [], us_military: false, internet_sales: false },
    quantity: { items: [{ value: 200, unit: 'units' }], total: 200, unit: 'units' },
    codes: { gtins: ['04056489125846'], ndcs: [], lots: ['260315'], serial_numbers: [], model_numbers: [], expiration_dates: ['2026-10-11'] },
    reason: { classes: ['UNDECLARED_ALLERGEN', 'LABELING'], allergens: ['milk', 'egg', 'tree_nuts', 'wheat', 'soy'], pathogens: [] },
    provenance: {
      source: 'openfda-enforcement',
      source_url: 'https://api.fda.gov/food/enforcement.json?search=recall_number:%22H-1275-2026%22',
      parser_version: 'recall-structuring@2',
      raw_sha256: 'a2c87714d00f28fee9fffa025f7828694c8b0bda97e296c55ad65eb4cc65919a',
      changed_at: '2026-09-26T22:03:38.945Z',
    },
  },
};

const PRODUCT_SAMPLE = {
  data: {
    id: 'cpsc-25203',
    agency: 'CPSC',
    jurisdiction: 'US',
    source_id: '25203',
    title: "Enerco Recalls DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters Due to Fire and Burn Hazards; Sold Exclusively at Lowe's",
    url: 'https://www.cpsc.gov/Recalls/2025/Enerco-Recalls-DEWALT-70000-BTU-Outdoor-Portable-Cordless-Forced-Air-Propane-Heaters-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-Lowes',
    published_on: '2025-04-03',
    title_firm: 'Enerco',
    firms: [{ name: 'Enerco Group Inc., of Cleveland, Ohio', role: 'importer' }],
    manufacturer_countries: ['China'],
    hazard: { classes: ['fire', 'burn'] },
    remedy: { classes: ['repair', 'new-instructions', 'stop-use'] },
    units: { us: 21250, canada: 500, mexico: null, text: 'About 21,250 (In addition, about 500 were sold in Canada)' },
    identifiers: { gtins: ['00089301008588'], model_numbers: ['DXH70CFAVX'], model_keys: ['DXH70CFAVX'] },
    trade_facets: ['hvac'],
    cross_references: [{ agency: 'HC', url: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire' }],
    linked_notices: [
      {
        id: 'hc-77184',
        agency: 'HC',
        title: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater recalled due to fire hazard',
        relation: 'cites',
        basis: 'declared_citation',
      },
    ],
    provenance: { source: 'cpsc-recalls', parser_version: 'product-recall-structuring@1' },
  },
};

export const DATASETS: Readonly<Record<DatasetKey, DatasetEntry>> = {
  recalls: {
    key: 'recalls',
    name: 'FDA Recall Intelligence',
    path: '/recalls',
    domain: 'Food, drugs and medical devices',
    recordType: 'Recall events',
    region: 'United States',
    summary:
      'FDA food, drug and medical-device enforcement reports with the lots, UPC/GTIN/UDI, NDC, expiry dates, distribution states, allergens and pathogens pulled out of the free text.',
    headline: 'Is this product recalled — and where?',
    lede: 'FDA publishes recalls as prose: “distributed to FL, GA, IL and the countries of Guatemala and Panama”, “Lot #: DJ23254, Exp. Date 11/30/2026”. This API turns that text into exact, queryable fields, so one call answers whether a UPC, UDI, NDC or lot is under recall, and in which states.',
    useCases: [
      'Check a scanned UPC, UDI-DI, NDC or lot number against every FDA recall in one request.',
      'Filter recalls by state, allergen, pathogen, reason class, classification or status for a store, region or product line.',
      'Sync changed recalls incrementally with changed_since and keep the verbatim FDA record for audit.',
      'Give an AI agent a deterministic recall answer with the FDA source URL to cite.',
    ],
    sources: [{ name: 'U.S. Food and Drug Administration enforcement reports via openFDA', short: 'FDA', url: 'https://open.fda.gov/apis/food/enforcement/', terms: 'CC0 1.0' }],
    limitations: [
      'Covers enforcement reports openFDA publishes (from June 2012); FDA decides what is published and when.',
      'Structured fields are produced by deterministic parsers from FDA text and can be incomplete; the verbatim record is available with include=raw.',
      'Not medical or legal advice, and not endorsed by FDA. Confirm against the FDA notice before acting.',
    ],
    refreshSchedule: 'We check openFDA every six hours.',
    statsPath: '/v1/recalls/stats',
    endpoints: [
      { method: 'GET', path: '/v1/recalls/lookup?code=…', summary: 'Every recall that names one code: GTIN/UPC/UDI (check-digit verified), NDC, lot, serial or model.', docs: '/docs#recalls-lookup' },
      { method: 'GET', path: '/v1/recalls', summary: 'Filter and page through recalls, newest report first.', docs: '/docs#recalls-search' },
      { method: 'GET', path: '/v1/recalls/{recall_number}', summary: 'One recall, optionally with the verbatim FDA record.', docs: '/docs#recalls-one' },
      { method: 'GET', path: '/v1/recalls/stats', summary: 'Public coverage counts and last successful sync (no key).', docs: '/docs#recalls-stats' },
    ],
    fields: [
      { name: 'codes', meaning: 'GTIN-14 (from UPC/EAN/UDI with a valid check digit), NDC, lots, serials, models and expiry dates found in the FDA text.' },
      { name: 'distribution', meaning: 'US states and ISO country codes named in the distribution pattern, with nationwide and international flags.' },
      { name: 'reason', meaning: 'Recall-reason classes, the nine major allergens and named pathogens.' },
      { name: 'quantity', meaning: 'Amounts and units parsed from the product quantity.' },
      { name: 'provenance', meaning: 'FDA source URL, parser version and the SHA-256 of the verbatim FDA record.' },
    ],
    sample: {
      request: 'curl "https://api.data.aroqon.com/v1/recalls/H-1275-2026" \\\n  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"',
      capturedOn: '2026-09-27',
      origin: 'live-api',
      note: 'Snapshot of a real response, not live. Abbreviated: the attribution object and provenance.derived_fields, first_seen_at, last_seen_at and raw_evidence are omitted.',
      response: JSON.stringify(FDA_SAMPLE, null, 2),
    },
    attribution: 'Data: U.S. Food and Drug Administration via openFDA (CC0). Not affiliated with or endorsed by FDA.',
  },
  'product-recalls': {
    key: 'product-recalls',
    name: 'North American Consumer Product Recalls',
    path: '/product-recalls',
    domain: 'Consumer products',
    recordType: 'Recall notices',
    region: 'United States and Canada',
    summary:
      'CPSC and Health Canada consumer-product recalls in one schema: model numbers, check-digit-verified UPC/GTIN, units sold in the US and Canada, hazard and remedy classes, trade facets, and linked joint recalls.',
    headline: 'Is this appliance, tool or toy recalled in the US or Canada?',
    lede: 'CPSC and Health Canada publish recalls as prose: “model number DXH70CFAVX”, “About 21,250 (In addition, about 500 were sold in Canada)”. This API turns both agencies’ notices into one set of exact, queryable fields and links a US recall to its Canadian counterpart wherever CPSC cites it.',
    useCases: [
      'Look up a model number or UPC across CPSC and Health Canada notices in one request.',
      'Find HVAC, appliance, plumbing or electrical recalls by hazard class (fire, shock, carbon monoxide…).',
      'See whether a US recall was also issued in Canada, through CPSC’s own citation of the Health Canada notice.',
      'Compare units recalled in the US and in Canada for the same notice.',
    ],
    sources: [
      { name: 'U.S. Consumer Product Safety Commission Recall API', short: 'CPSC', url: 'https://www.saferproducts.gov/RestWebServices/Recall', terms: 'US Government work' },
      { name: 'Health Canada Recalls and Safety Alerts (open data)', short: 'Health Canada', url: 'https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3', terms: 'Open Government Licence – Canada' },
    ],
    limitations: [
      'Model numbers are read only after an explicit “model” label, so notices that list models in tables or images may have none.',
      'Health Canada’s open-data index carries fewer fields than CPSC notices; its advice and contact text is not republished.',
      'A US and a Canadian notice are linked only where CPSC cites the Health Canada notice; similar titles never link notices.',
      'Not endorsed by CPSC, Health Canada or the Government of Canada. Confirm against the agency notice before acting.',
    ],
    refreshSchedule: 'We check both agencies every six hours, and re-read the full CPSC list once a day.',
    statsPath: '/v1/product-recalls/stats',
    endpoints: [
      { method: 'GET', path: '/v1/product-recalls/lookup?code=…', summary: 'Every notice that names one model number or UPC/GTIN.', docs: '/docs#product-recalls-lookup' },
      { method: 'GET', path: '/v1/product-recalls', summary: 'Filter notices by agency, hazard, remedy, trade facet, firm, dates or text.', docs: '/docs#product-recalls-search' },
      { method: 'GET', path: '/v1/product-recalls/{id}', summary: 'One notice (cpsc-… or hc-…) with its linked notices.', docs: '/docs#product-recalls-one' },
      { method: 'GET', path: '/v1/product-recalls/stats', summary: 'Public coverage counts and last successful sync per source (no key).', docs: '/docs#product-recalls-stats' },
    ],
    fields: [
      { name: 'identifiers', meaning: 'Model numbers as printed, their normalised keys, and GTIN-14s with a valid GS1 check digit.' },
      { name: 'units', meaning: 'Units recalled in the US, Canada and Mexico, parsed from the agency text.' },
      { name: 'hazard / remedy', meaning: 'Hazard and remedy classes from one taxonomy shared by both agencies.' },
      { name: 'trade_facets', meaning: 'appliance, hvac, plumbing-water-heating, electrical, building-products.' },
      { name: 'linked_notices', meaning: 'The other agency’s notice, when one notice cites it (declared citation).' },
    ],
    sample: {
      request: 'curl "https://api.data.aroqon.com/v1/product-recalls/cpsc-25203" \\\n  -H "Authorization: Bearer $DATA_FOUNDRY_KEY"',
      capturedOn: '2026-09-27',
      origin: 'parser',
      note: 'Snapshot of the production parser’s output for CPSC notice 25203, produced before this API went live; not a captured API response. Abbreviated: several fields (description, products, hazard and remedy text, injuries, sold_at, provenance details) and the attribution object are omitted.',
      response: JSON.stringify(PRODUCT_SAMPLE, null, 2),
    },
    attribution:
      'Data: U.S. Consumer Product Safety Commission (US Government work); Health Canada, containing information licensed under the Open Government Licence – Canada. Not affiliated with or endorsed by CPSC or Health Canada.',
  },
};

/** Whether a dataset is published: its data is served and its pages exist. */
export function isPublished(env: Env, key: DatasetKey): boolean {
  if (key === 'recalls') return env.SOURCE_KILL_SWITCH !== '1';
  return env.PRODUCT_RECALLS_OPEN === '1' && env.PRODUCT_RECALLS_KILL_SWITCH !== '1';
}

export function publishedDatasets(env: Env): DatasetEntry[] {
  return (Object.keys(DATASETS) as DatasetKey[]).filter((key) => isPublished(env, key)).map((key) => DATASETS[key]);
}

export function salesOpen(env: Env): boolean {
  return env.SALES_OPEN === '1';
}
