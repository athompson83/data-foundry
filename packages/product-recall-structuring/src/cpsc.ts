/**
 * One CPSC recall (saferproducts.gov Recall API, JSON) in, one structured
 * notice out. ConsumerContact and Images are never read: contact text can
 * name people, and recall photographs are not republished (AGENTS.md rule 9).
 */

import { parseCodes } from '@data-foundry/recall-structuring';

import { crossReference } from './links.js';
import { extractModelNumbersWithFields } from './models.js';
import { classifyHazards, classifyRemedies, tradeFacets } from './taxonomy.js';
import { cleanText, digitCodes, gtinReadings, uniqueSorted } from './text.js';
import { PARSER_VERSION, type CrossReference, type FirmMention, type RecallProduct, type StructuredProductRecall } from './types.js';
import { parseUnits, type UnitCounts } from './units.js';

interface Named {
  readonly Name?: string | null;
}

/** The subset of the CPSC Recall API record this parser reads. */
export interface CpscRecallRecord {
  readonly RecallID?: number;
  readonly RecallNumber?: string;
  readonly RecallDate?: string | null;
  readonly LastPublishDate?: string | null;
  readonly Title?: string | null;
  readonly Description?: string | null;
  readonly URL?: string | null;
  readonly Products?: ReadonlyArray<{ readonly Name?: string | null; readonly Description?: string | null; readonly Model?: string | null; readonly Type?: string | null; readonly NumberOfUnits?: string | null }> | null;
  readonly Inconjunctions?: ReadonlyArray<{ readonly URL?: string | null }> | null;
  readonly Injuries?: readonly Named[] | null;
  readonly Manufacturers?: readonly Named[] | null;
  readonly Retailers?: readonly Named[] | null;
  readonly Importers?: readonly Named[] | null;
  readonly Distributors?: readonly Named[] | null;
  readonly ManufacturerCountries?: ReadonlyArray<{ readonly Country?: string | null }> | null;
  readonly ProductUPCs?: ReadonlyArray<{ readonly UPC?: string | null } | string> | null;
  readonly Hazards?: readonly Named[] | null;
  readonly Remedies?: readonly Named[] | null;
  readonly RemedyOptions?: ReadonlyArray<{ readonly Option?: string | null }> | null;
}

export const CPSC_RECALL_NUMBER = /^\d{5}[A-Za-z]?$/;

export function isUsableCpscRecord(record: CpscRecallRecord): boolean {
  return typeof record.RecallNumber === 'string' && CPSC_RECALL_NUMBER.test(record.RecallNumber.trim()) && Boolean(cleanText(record.Title));
}

function isoDate(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? '');
  return match ? (match[1] as string) : null;
}

function names(list: readonly Named[] | null | undefined): string[] {
  return (list ?? []).map((item) => cleanText(item.Name)).filter(Boolean);
}

/**
 * The firm or brand leading a CPSC title: "5Color Recalls …" gives "5Color",
 * "CPSC, Lakewood Announce Recall …" gives "Lakewood" and "Teddy Bear Recalled
 * by Dan-Dee International" gives "Dan-Dee International".
 */
export function titleFirm(title: string): string | null {
  const by = /\bRecalled (?:for (?:Repair|Replacement|Refund) )?by (.{2,80}?)\s*(?:$|;|,| Due\b| Because\b| for\b)/.exec(title);
  const lead = /^(.{2,80}?)\s+(?:Recalls?|Announces?|Expands?|Reannounces?|to Recall)\b/.exec(title);
  const match = by ?? lead;
  if (!match) return null;
  const firm = (match[1] as string).replace(/^(?:CPSC|U\.S\. CPSC|Consumer Product Safety Commission)\s*(?:,|and)\s*/i, '').trim();
  // "Fire Hazard Prompts Recall of …" and similar leads name a hazard, not a firm.
  if (!firm || /^(?:CPSC|FDA)$/i.test(firm) || /\b(?:hazards?|prompts?|risk|due to)\b/i.test(firm)) return null;
  return firm;
}

export function sumUnits(products: readonly RecallProduct[]): UnitCounts {
  const total = (pick: (units: UnitCounts) => number | null): number | null => {
    const values = products.map((product) => pick(product.units)).filter((value): value is number => value !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const texts = products.map((product) => product.units.text).filter((text): text is string => Boolean(text));
  return { us: total((u) => u.us), canada: total((u) => u.canada), mexico: total((u) => u.mexico), text: texts.length ? texts.join(' | ') : null };
}

export function structureCpscRecall(record: CpscRecallRecord): StructuredProductRecall {
  const recallNumber = (record.RecallNumber ?? '').trim();
  if (!CPSC_RECALL_NUMBER.test(recallNumber)) throw new Error(`unusable CPSC recall number: ${JSON.stringify(record.RecallNumber)}`);
  const title = cleanText(record.Title);
  const description = cleanText(record.Description) || null;
  const products: RecallProduct[] = (record.Products ?? []).map((product) => ({
    name: cleanText(product.Name),
    type: cleanText(product.Type) || null,
    units: parseUnits(cleanText(product.NumberOfUnits)),
  }));
  const productNames = products.map((product) => product.name).filter(Boolean);
  const types = uniqueSorted(products.map((product) => product.type).filter((type): type is string => Boolean(type)));

  const firms: FirmMention[] = [
    ...names(record.Manufacturers).map((name) => ({ name, role: 'manufacturer' as const })),
    ...names(record.Importers).map((name) => ({ name, role: 'importer' as const })),
    ...names(record.Distributors).map((name) => ({ name, role: 'distributor' as const })),
  ];
  const soldAt: string[] = [];
  for (const name of names(record.Retailers)) {
    // CPSC's Retailers list mixes "Sold at …" statements ("Lowe's stores nationwide … for about $200.") with firm names.
    if (/^sold\b|\$\s?\d|\bnationwide\b|\bonline\b|\b(?:from|between|since)\s+(?:[A-Z][a-z]+\s+)?(?:19|20)\d\d/i.test(name)) soldAt.push(name);
    else firms.push({ name, role: 'retailer' });
  }

  const hazardText = names(record.Hazards).join(' ') || null;
  const remedyText = names(record.Remedies).join(' ') || null;
  const remedyOptions = (record.RemedyOptions ?? []).map((option) => cleanText(option.Option)).filter((option) => option.length > 0 && option.length < 40);

  const gtins = new Set<string>();
  for (const upc of record.ProductUPCs ?? []) {
    for (const code of digitCodes(typeof upc === 'string' ? upc : (upc.UPC ?? ''))) {
      for (const gtin of gtinReadings(code)) gtins.add(gtin);
    }
  }
  for (const gtin of parseCodes(description).gtins) gtins.add(gtin);

  const models = extractModelNumbersWithFields([description], (record.Products ?? []).map((product) => cleanText(product.Model)));

  const references = new Map<string, CrossReference>();
  for (const item of record.Inconjunctions ?? []) {
    const reference = crossReference(item.URL ?? '');
    if (reference) references.set(reference.url, reference);
  }

  const url = cleanText(record.URL) || `https://www.cpsc.gov/Recalls?recall=${recallNumber}`;
  return {
    id: `cpsc-${recallNumber.toLowerCase()}`,
    agency: 'CPSC',
    jurisdiction: 'US',
    source_id: recallNumber,
    title,
    url,
    published_on: isoDate(record.RecallDate),
    updated_on: isoDate(record.LastPublishDate),
    archived: null,
    recall_class: null,
    product_category: types[0] ?? null,
    products,
    title_firm: titleFirm(title),
    firms,
    sold_at: soldAt,
    manufacturer_countries: uniqueSorted((record.ManufacturerCountries ?? []).map((item) => cleanText(item.Country)).filter(Boolean)),
    description,
    hazard: { classes: classifyHazards(title, hazardText), text: hazardText },
    remedy: { classes: classifyRemedies(...remedyOptions, remedyText), text: remedyText },
    injuries: names(record.Injuries).join(' ') || null,
    units: sumUnits(products),
    identifiers: { gtins: [...gtins].sort(), model_numbers: models.printed, model_keys: models.keys },
    trade_facets: tradeFacets([title, ...productNames].join(' '), types, `${hazardText ?? ''} ${description ?? ''}`),
    cross_references: [...references.values()].sort((a, b) => a.url.localeCompare(b.url)),
    joint_with: [],
    provenance: {
      source: 'cpsc-recalls',
      source_url: url,
      parser_version: PARSER_VERSION,
      derived_fields: {
        title_firm: ['Title'],
        units: ['Products[].NumberOfUnits'],
        'identifiers.gtins': ['ProductUPCs[].UPC', 'Description'],
        'identifiers.model_numbers': ['Description', 'Products[].Model'],
        'hazard.classes': ['Title', 'Hazards[].Name'],
        'remedy.classes': ['RemedyOptions[].Option', 'Remedies[].Name'],
        trade_facets: ['Title', 'Products[].Name', 'Products[].Type', 'Hazards[].Name', 'Description'],
        cross_references: ['Inconjunctions[].URL'],
      },
    },
  };
}
