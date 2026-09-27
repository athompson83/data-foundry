import { describe, expect, it } from 'vitest';

import {
  canonicalHcUrl,
  classifyHazards,
  classifyRemedies,
  crossReference,
  digitCodes,
  extractModelNumbers,
  gtin14,
  gtinReadings,
  isConsumerProductRecord,
  jointAgencies,
  parseUnits,
  structureCpscRecall,
  structureHcRecall,
  titleFirm,
  tradeFacets,
  type CpscRecallRecord,
  type HcRecallRecord,
} from '../src/index.js';

// Every input below is verbatim source text: CPSC Recall API and Health Canada open-data index, retrieved 2026-09-27.

const DEWALT_CPSC: CpscRecallRecord = {
  RecallID: 10220,
  RecallNumber: '25203',
  RecallDate: '2025-04-03T00:00:00',
  Description:
    'This recall involves DEWALT 70,000 BTU outdoor portable cordless forced air propane heaters model number DXH70CFAVX. The heaters are yellow and black. The model number is located on the hang tag. "DEWALT" is printed in black on the side of the bottom yellow portion of the units. ',
  URL: 'https://www.cpsc.gov/Recalls/2025/Enerco-Recalls-DEWALT-70000-BTU-Outdoor-Portable-Cordless-Forced-Air-Propane-Heaters-Due-to-Fire-and-Burn-Hazards-Sold-Exclusively-at-Lowes',
  Title: "Enerco Recalls DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters Due to Fire and Burn Hazards; Sold Exclusively at Lowe's",
  LastPublishDate: '2025-04-03T00:00:00',
  Products: [{ Name: 'DEWALT 70,000 BTU Outdoor Portable Cordless Forced Air Propane Heaters', Description: '', Model: '', Type: '', NumberOfUnits: 'About 21,250 (In addition, about 500 were sold in Canada)' }],
  Inconjunctions: [{ URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire' }],
  Injuries: [{ Name: 'The firm has received 11 reports of overheating. No injuries have been reported.' }],
  Manufacturers: [],
  Retailers: [{ Name: "Lowe's stores nationwide and online at Lowes.com from May 2024 through January 2025 for about $200." }],
  Importers: [{ Name: 'Enerco Group Inc., of Cleveland, Ohio' }],
  Distributors: [],
  ManufacturerCountries: [{ Country: 'China' }],
  ProductUPCs: [{ UPC: '089301008588' }],
  Hazards: [
    {
      Name: "The recalled portable heaters' operating instructions can cause consumers to incorrectly depress the start button too quickly and prevent the fan from starting, causing the heaters to overheat, posing fire and burn hazards.",
    },
  ],
  Remedies: [
    {
      Name: "Consumers should immediately stop using the recalled heaters and contact Enerco to request new instructions and a warning sticker describing how to start the heater using the power button. The new instructions and warning sticker are also available via Enerco's website at https://www.enercogroupinc.com/recall. Enerco and Lowe's are contacting all known purchasers directly.",
    },
  ],
  RemedyOptions: [{ Option: 'Repair' }],
};

const DEWALT_HC: HcRecallRecord = {
  NID: '77184',
  Title: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater recalled due to fire hazard ',
  URL: 'https://recalls-rappels.canada.ca/en/alert-recall/dewalt-70000-btu-outdoor-portable-cordless-forced-air-propane-heater-recalled-due-fire',
  Organization: 'Consumer product safety',
  Product: 'DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater',
  Issue: 'Fire hazard',
  'What you should do':
    'Consumers should immediately stop using the recalled product and contact Enerco to request new supplemental instructions and a free warning sticker describing how to properly start the heater using the power button, thus ensuring that the fan starts.For more information, consumers can contact Enerco Group by telephone at 1-800-964-4328, from 8 a.m. to 5 p.m. ET, Monday through Friday, or online at https://www.enercogroupinc.com/recall or at https://www.enercogroupinc.com and click on “Recalls” to view /download the supplemental instructions and to enter your contact information to automatically be sent a copy of the supplemental instructions and free warning sticker.Joint recall with Health Canada, the United States Consumer Product Safety Commission (US CPSC) and Enerco Group.Please note that the Canada Consumer Product Safety Act prohibits recalled products from being redistributed, sold or even given away in Canada.',
  Category: 'Outdoor living',
  'Recall class': '',
  'Last updated': '2025-04-03',
  Archived: '0',
};

describe('CPSC recall', () => {
  const recall = structureCpscRecall(DEWALT_CPSC);

  it('keeps identity, dates and the source URL', () => {
    expect(recall.id).toBe('cpsc-25203');
    expect(recall.agency).toBe('CPSC');
    expect(recall.jurisdiction).toBe('US');
    expect(recall.published_on).toBe('2025-04-03');
    expect(recall.provenance.source_url).toBe(DEWALT_CPSC.URL);
  });

  it('extracts check-digit-valid GTINs and anchored model numbers', () => {
    expect(recall.identifiers.gtins).toEqual(['00089301008588']);
    expect(recall.identifiers.model_numbers).toEqual(['DXH70CFAVX']);
  });

  it('reads models from product-level descriptions as prose', () => {
    const structured = structureCpscRecall({
      ...DEWALT_CPSC,
      Description: 'This recall involves outdoor propane heaters. The heaters are yellow and black.',
      Products: [{ ...DEWALT_CPSC.Products![0]!, Description: 'Outdoor heater, model number DXH70CFAVX, sold in yellow.' }],
    });
    expect(structured.identifiers.model_numbers).toEqual(['DXH70CFAVX']);
    expect(structured.provenance.derived_fields['identifiers.model_numbers']).toContain('Products[].Description');
  });

  it('indexes models given only in the structured Products[].Model field', () => {
    const structured = structureCpscRecall({
      ...DEWALT_CPSC,
      Description: 'This recall involves outdoor propane heaters. The heaters are yellow and black.',
      Products: [{ ...DEWALT_CPSC.Products![0]!, Model: 'DXH70CFAVX, DXH90CFAV' }],
    });
    expect(structured.identifiers.model_numbers).toEqual(['DXH70CFAVX', 'DXH90CFAV']);
    expect(structured.identifiers.model_keys).toEqual(['DXH70CFAVX', 'DXH90CFAV']);
  });

  it('splits US and Canadian units', () => {
    expect(recall.units).toMatchObject({ us: 21250, canada: 500, mexico: null });
  });

  it('classifies hazard, remedy and trade facet', () => {
    expect(recall.hazard.classes).toEqual(['fire', 'burn']);
    expect(recall.remedy.classes).toEqual(['repair', 'new-instructions', 'stop-use']);
    expect(recall.trade_facets).toEqual(['hvac']);
  });

  it('separates firms from sold-at statements', () => {
    expect(recall.title_firm).toBe('Enerco');
    expect(recall.firms).toEqual([{ name: 'Enerco Group Inc., of Cleveland, Ohio', role: 'importer' }]);
    expect(recall.sold_at).toEqual(["Lowe's stores nationwide and online at Lowes.com from May 2024 through January 2025 for about $200."]);
  });

  it('records the cited Health Canada notice as a declared cross-reference', () => {
    expect(recall.cross_references).toEqual([{ agency: 'HC', url: DEWALT_HC.URL }]);
  });

  it('never reads contact text or images', () => {
    const withContact = structureCpscRecall({ ...DEWALT_CPSC, ConsumerContact: 'Jane Doe at 555-0100', Images: [{ URL: 'https://example.test/a.jpg' }] } as CpscRecallRecord);
    expect(JSON.stringify(withContact)).not.toContain('Jane Doe');
    expect(JSON.stringify(withContact)).not.toContain('a.jpg');
  });

  it('rejects a record without a usable recall number', () => {
    expect(() => structureCpscRecall({ ...DEWALT_CPSC, RecallNumber: 'N/A' })).toThrow(/recall number/);
  });
});

describe('Health Canada recall', () => {
  const recall = structureHcRecall(DEWALT_HC);

  it('is in scope only for the consumer-product organisation', () => {
    expect(isConsumerProductRecord(DEWALT_HC)).toBe(true);
    expect(isConsumerProductRecord({ ...DEWALT_HC, Organization: 'Medical devices' })).toBe(false);
  });

  it('structures the open-data index fields', () => {
    expect(recall).toMatchObject({ id: 'hc-77184', agency: 'HC', jurisdiction: 'CA', updated_on: '2025-04-03', archived: false, recall_class: null, product_category: 'Outdoor living' });
    expect(recall.title).toBe('DeWalt 70,000-BTU Outdoor Portable Cordless Forced Air Propane Heater recalled due to fire hazard');
    expect(recall.hazard).toEqual({ classes: ['fire'], text: 'Fire hazard' });
    expect(recall.trade_facets).toEqual(['hvac']);
  });

  it('derives remedy classes and the joint marker without republishing the advice text', () => {
    expect(recall.remedy).toEqual({ classes: ['new-instructions', 'stop-use'], text: null });
    expect(recall.joint_with).toEqual(['CPSC']);
    expect(JSON.stringify(recall)).not.toContain('1-800-964-4328');
  });

  it('links to the CPSC notice only through the CPSC citation, never through the marker', () => {
    expect(recall.cross_references).toEqual([]);
    expect(canonicalHcUrl(structureCpscRecall(DEWALT_CPSC).cross_references[0]!.url)).toBe(canonicalHcUrl(recall.url));
  });
});

describe('model numbers', () => {
  it('reads lists after a model anchor and stops at other codes', () => {
    expect(extractModelNumbers('Only model numbers FL-600, FL-650, SL-600, SL-605, and SL-650 sold under the brand names SmartLite and RiteLite are involved in this recall.').printed).toEqual([
      'FL-600',
      'FL-650',
      'SL-600',
      'SL-605',
      'SL-650',
    ]);
    expect(extractModelNumbers('This program includes the following Life Fitness treadmills: Model 9000HR: Serial numbers CTB100000-CTB101618, Model 8500: Serial numbers MTB100000-MTB100646').printed).toEqual(['9000HR', '8500']);
    expect(extractModelNumbers('12-cup Kenmore coffee makers sold in black, white, and red with the following model numbers: 100.80006 (black), 100.81006 (white), and 100.82006 (red).').printed).toEqual([
      '100.80006',
      '100.81006',
      '100.82006',
    ]);
  });

  it('ignores model years, measurements and text without an anchor', () => {
    expect(extractModelNumbers('This recall involves nine model year 2021 Can-Am Outlander and Renegade models.').printed).toEqual([]);
    expect(extractModelNumbers('This recall involves Model Years 2019-2020 PRO XD 4000D UTVs.').printed).toEqual([]);
    expect(extractModelNumbers('The recalled hairdryers have the model number BAB2002BLX, are rated at 1875 watts, and are pistol-shaped.').printed).toEqual(['BAB2002BLX']);
    expect(extractModelNumbers('"Lot/Ref: YD-260320" and "Date 2026/03/20" are printed on a label.').printed).toEqual([]);
    expect(extractModelNumbers('The products currently under recall are: l-0301 Biological Modelsl-0332 Land Form').printed).toEqual([]);
  });

  it('normalises keys for exact lookup', () => {
    expect(extractModelNumbers('model number 640-52XX S, printed on top').keys).toEqual(['64052XX']);
  });
});

describe('units', () => {
  it('assigns each figure to the country named after it', () => {
    expect(parseUnits('About 30,000 in the U.S. and 2,100 in Canada')).toMatchObject({ us: 30000, canada: 2100, mexico: null });
    expect(parseUnits('About 5,000 (In addition, about 700 were sold in Canada and about 90 were sold in Mexico)')).toMatchObject({ us: 5000, canada: 700, mexico: 90 });
    expect(parseUnits('About 1.2 million')).toMatchObject({ us: 1200000 });
    expect(parseUnits('')).toEqual({ us: null, canada: null, mexico: null, text: null });
  });
});

describe('barcodes', () => {
  it('splits multi-code fields before joining grouped digits and validates the check digit', () => {
    expect(digitCodes('840059614922, 840059615370')).toEqual(['840059614922', '840059615370']);
    expect(digitCodes('5 012345 678900')).toEqual(['5012345678900']);
    expect(gtin14('089301008588')).toBe('00089301008588');
    expect(gtin14('089301008589')).toBeNull();
    // Eight digits: every reading the lookup endpoint tries, each on its own check digit.
    expect(gtinReadings('13826864')).toEqual(['00000013826864', '00138268000064']);
    expect(gtinReadings('24245159')).toEqual(['00000024245159']);
    expect(gtinReadings('12345678')).toEqual([]);
  });
});

describe('title firm', () => {
  it('reads the firm leading or closing the title', () => {
    expect(titleFirm('IKEA Recalls Dining Tables Due to Laceration Hazard')).toBe('IKEA');
    expect(titleFirm('CPSC, Lakewood Announce Recall of Fan-Forced Mini-Personal Heaters')).toBe('Lakewood');
    expect(titleFirm('Packaged Terminal Air Conditioners and Heat Pumps Recalled by Carrier Due to Fire Hazard')).toBe('Carrier');
    expect(titleFirm('Belivium Baby Loungers Recalled Due to Risk of Serious Injury or Death from Suffocation')).toBeNull();
    expect(titleFirm('Fire and Burn Hazards Prompt Recall of Gas Grills Sold at Lowe’s Stores')).toBeNull();
  });
});

describe('taxonomy', () => {
  it('classifies hazards from agency wording', () => {
    expect(classifyHazards('Burn hazard - Fire hazard')).toEqual(['fire', 'burn']);
    expect(classifyHazards('The recalled children’s bamboo plates have elevated levels of lead and formaldehyde.')).toEqual(['chemical', 'lead']);
    expect(classifyHazards('Physical hazard')).toEqual(['injury']);
  });

  it('classifies remedies', () => {
    expect(classifyRemedies('Refund', 'Consumers should stop using the recalled product and dispose of it.')).toEqual(['refund', 'dispose', 'stop-use']);
  });

  it('keeps hair dryers out of the appliance facet', () => {
    expect(tradeFacets('Conair Recalls Hair Dryers', [], 'shock')).toEqual([]);
    expect(tradeFacets('ZLINE Recalls Gas Ranges', [], 'carbon monoxide')).toEqual(['appliance']);
  });
});

describe('cross-references', () => {
  it('canonicalises Health Canada URLs and labels other agencies', () => {
    expect(crossReference('http://recalls-rappels.canada.ca/en/alert-recall/Some-Slug/')).toEqual({ agency: 'HC', url: 'https://recalls-rappels.canada.ca/en/alert-recall/some-slug' });
    expect(crossReference('https://recalls-rappels.canada.ca/en')).toBeNull();
    expect(crossReference('http://healthycanadians.gc.ca/recall-alert-rappel-avis/hc-sc/2015/53585r-eng.php')?.agency).toBe('HC-LEGACY');
    expect(crossReference('http://www.profeco.gob.mx/Verificacion/alertas_nvo.asp')?.agency).toBe('PROFECO');
  });

  it('reads the agencies named by a joint-recall marker', () => {
    expect(jointAgencies('Joint recall with Health Canada, the U.S. Consumer Product Safety Commission and PROFECO.Please note that')).toEqual(['CPSC', 'PROFECO']);
    expect(jointAgencies('Consumers should stop using the product.')).toEqual([]);
  });
});
