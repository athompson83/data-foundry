import { describe, expect, it } from 'vitest';

import {
  gs1CheckDigitValid,
  isUsableRecallNumber,
  normaliseNdc,
  parseCodes,
  parseDistribution,
  parseLooseDate,
  parseQuantity,
  parseReason,
  structureRecall,
} from '../src/index.js';

// Every input below is verbatim openFDA enforcement text retrieved 2026-09-26.

describe('distribution geography', () => {
  it('reads state lists, countries and worldwide phrasing', () => {
    const geo = parseDistribution(
      'Worldwide - US Nationwide distribution in the states of FL, GA, IL, MD, MI, NC, NJ, NV, OH, PA, and the countries of Guatemala and Panama.',
    );
    expect(geo.nationwide_us).toBe(true);
    expect(geo.international).toBe(true);
    expect(geo.us_states).toEqual(['FL', 'GA', 'IL', 'MD', 'MI', 'NC', 'NJ', 'NV', 'OH', 'PA']);
    expect(geo.countries).toEqual(['GT', 'PA']);
  });

  it('accepts ambiguous codes only in list context', () => {
    expect(parseDistribution('The adulterated product was distributed to the following states: VA, NY, NJ, MI').us_states).toEqual(['MI', 'NJ', 'NY', 'VA']);
    // "IN" and "OR" as English words are not states.
    expect(parseDistribution('PRODUCT DISTRIBUTED IN TEXAS OR NEARBY').us_states).toEqual(['TX']);
  });

  it('honours negated international distribution', () => {
    const geo = parseDistribution('National: AZ, CA, CT, FL, IN, ME, MI, MO, MS, NC, NH, NY, OH, OR, RI, TX, VA & WY  International: None reported');
    expect(geo.international).toBe(false);
    expect(geo.us_states).toContain('IN');
    expect(geo.us_states).toContain('OR');
    expect(geo.us_states).toHaveLength(18);
  });

  it('honours negated nationwide distribution', () => {
    const geo = parseDistribution('Distributed in Texas only. Not distributed nationwide.');
    expect(geo.nationwide_us).toBe(false);
    expect(geo.us_states).toEqual(['TX']);
  });

  it('rejects ambiguous codes separated only by spaces', () => {
    expect(parseDistribution('SHIPPED TO DISTRIBUTORS IN OR AROUND CHICAGO').us_states).toEqual([]);
    expect(parseDistribution('Distributed to IN, OR and ME').us_states).toEqual(['IN', 'ME', 'OR']);
  });

  it('keeps West Virginia distinct from Virginia', () => {
    expect(parseDistribution('Distributed in West Virginia and Ohio').us_states).toEqual(['OH', 'WV']);
  });
});

describe('product codes', () => {
  it('verifies GS1 check digits', () => {
    expect(gs1CheckDigitValid('00801741121067')).toBe(true);
    expect(gs1CheckDigitValid('00801741121068')).toBe(false);
  });

  it('normalises NDC layouts to 5-4-2', () => {
    expect(normaliseNdc('1234-5678-90')).toBe('01234-5678-90');
    expect(normaliseNdc('12345-678-90')).toBe('12345-0678-90');
    expect(normaliseNdc('12345-6789-0')).toBe('12345-6789-00');
    expect(normaliseNdc('123-45-6')).toBeNull();
  });

  it('parses dates in FDA formats and rejects impossible ones', () => {
    expect(parseLooseDate('09/07/2026')).toBe('2026-09-07');
    expect(parseLooseDate('July 31, 2027')).toBe('2027-07-31');
    expect(parseLooseDate('2/30/2027')).toBeNull();
    expect(parseLooseDate('11/2026')).toBe('2026-11');
  });

  it('extracts every lot across expiry clauses', () => {
    const codes = parseCodes('Lot #: DJ23254, Exp. Date 11/30/2026; DJ10205, Exp. Date 04/30/2027.');
    expect(codes.lots).toEqual(['DJ10205', 'DJ23254']);
    expect(codes.expiration_dates).toEqual(['2026-11-30', '2027-04-30']);
  });

  it('does not let dates swallow lots or serials', () => {
    expect(parseCodes('Lot numbers 20131, 20363, 20500 and 20641.').lots).toEqual(['20131', '20363', '20500', '20641']);
    expect(parseCodes('Lot #: 26JAN035, BUD 09/07/2026').lots).toEqual(['26JAN035']);
    expect(parseCodes('Serial Numbers: BLX611513S, BLX610983S').serial_numbers).toEqual(['BLX610983S', 'BLX611513S']);
  });

  it('keeps every serial in a very long list', () => {
    const serials = Array.from({ length: 2000 }, (_, index) => `SN${100000 + index}`);
    const codes = parseCodes(`Serial Numbers: ${serials.join(', ')}`);
    expect(codes.serial_numbers).toHaveLength(2000);
    expect(codes.serial_numbers).toContain('SN101999');
  });

  it('pairs UDI-DI with lots and catalog numbers', () => {
    const codes = parseCodes('UDI/DI 05708932072526, Lot Numbers: 8849570, 8904168, 8939114');
    expect(codes.gtins).toEqual(['05708932072526']);
    expect(codes.lots).toEqual(['8849570', '8904168', '8939114']);
    const catalog = parseCodes('Catalog Number: SRB24AC, Lot Numbers: H1068590S1, H1078177; Catalog Number: SRB24MED, Lot Numbers: H1068587S1');
    expect(catalog.model_numbers).toEqual(['SRB24AC', 'SRB24MED']);
    expect(catalog.lots).toEqual(['H1068587S1', 'H1068590S1', 'H1078177']);
  });

  it('normalises a 12-digit UPC to GTIN-14', () => {
    expect(parseCodes('EAN: 616612785503; SKU: 1000').gtins).toEqual(['00616612785503']);
  });
});

describe('quantity', () => {
  it('parses a single amount with thousands separators', () => {
    expect(parseQuantity('403,200 tablets')).toEqual({ items: [{ value: 403200, unit: 'tablets' }], total: 403200, unit: 'tablets' });
  });

  it('claims no total for multiple amounts', () => {
    expect(parseQuantity('40000 - 50000 units').total).toBeNull();
    expect(parseQuantity('N/A').items).toEqual([]);
  });
});

describe('reason classes', () => {
  it('scopes allergens to declaration context', () => {
    expect(parseReason('Product contains undeclared milk and soy.')).toEqual({ classes: ['UNDECLARED_ALLERGEN'], allergens: ['milk', 'soy'], pathogens: [] });
    expect(parseReason('Milk chocolate potentially contaminated with Salmonella').allergens).toEqual([]);
  });

  it('does not read "may lead to" as lead contamination', () => {
    expect(parseReason('Exposure may lead to serious infections.').classes).not.toContain('CHEMICAL_CONTAMINATION');
  });
});

describe('structureRecall', () => {
  it('structures a full record with provenance', () => {
    const recall = structureRecall('food', {
      recall_number: 'H-1331-2026',
      event_id: '99684',
      status: 'Ongoing',
      classification: 'Class I',
      recalling_firm: 'EURO FOODS GROUP USA NJ INC',
      city: 'Totowa',
      state: 'NJ',
      country: 'United States',
      voluntary_mandated: 'Voluntary: Firm initiated',
      distribution_pattern: 'The adulterated product was distributed to the following states: VA, NY, NJ, MI',
      product_description: 'Crown Farms Dried Suri Cut, 200 gm, in plastic pack, 25 packages per box, keep frozen',
      product_quantity: '53 boxes',
      reason_for_recall: 'The firm imported and distributed dried ribbon fish that was not properly eviscerated prior to drying.',
      recall_initiation_date: '20260801',
      report_date: '20260916',
      code_info: 'BATCH NO: 130 EF, 146 EF SERIAL NUMBER: 5055192640140 PRODUCT CODE: 28DSUM',
    });
    expect(recall.classification).toBe('I');
    expect(recall.voluntary).toBe(true);
    expect(recall.dates).toEqual({ initiated: '2026-08-01', classified: null, reported: '2026-09-16', terminated: null });
    expect(recall.distribution.us_states).toEqual(['MI', 'NJ', 'NY', 'VA']);
    expect(recall.quantity.total).toBe(53);
    expect(recall.codes.gtins).toEqual(['05055192640140']);
    expect(recall.provenance.source_url).toContain('H-1331-2026');
  });

  it('keeps openFDA product NDCs as 5-4 alongside package NDCs', () => {
    const recall = structureRecall('drug', {
      recall_number: 'D-0001-2026',
      openfda: { product_ndc: ['1234-5678'], package_ndc: ['12345-678-90'] },
    });
    expect(recall.codes.ndcs).toEqual(['01234-5678', '12345-0678-90']);
  });

  it('rejects a record without a usable recall number', () => {
    expect(() => structureRecall('drug', {})).toThrow(/recall_number/);
    expect(() => structureRecall('drug', { recall_number: 'N/A' })).toThrow(/recall_number/);
    expect(isUsableRecallNumber('D-036-2013')).toBe(true);
    expect(isUsableRecallNumber(' n/a ')).toBe(false);
  });
});
