/**
 * One Health Canada recall from the Open Government Licence index
 * (HCRSAMOpenData.json) in, one structured notice out. Only the
 * "Consumer product safety" organisation is in scope. The "What you should
 * do" text is read for remedy classes and the joint-recall marker but is not
 * republished: it carries contact details, and the licence excludes personal
 * information.
 */

import { jointAgencies } from './links.js';
import { extractModelNumbers } from './models.js';
import { classifyHazards, classifyRemedies, tradeFacets } from './taxonomy.js';
import { cleanText } from './text.js';
import { PARSER_VERSION, type StructuredProductRecall } from './types.js';

export const HC_CONSUMER_ORGANIZATION = 'Consumer product safety';

/** The Health Canada open-data index record (its field names contain spaces). */
export interface HcRecallRecord {
  readonly NID?: string;
  readonly Title?: string | null;
  readonly URL?: string | null;
  readonly Organization?: string | null;
  readonly Product?: string | null;
  readonly Issue?: string | null;
  readonly 'What you should do'?: string | null;
  readonly Category?: string | null;
  readonly 'Recall class'?: string | null;
  readonly 'Last updated'?: string | null;
  readonly Archived?: string | null;
}

export function isConsumerProductRecord(record: HcRecallRecord): boolean {
  return record.Organization === HC_CONSUMER_ORGANIZATION && /^\d{1,8}$/.test(record.NID ?? '') && Boolean(cleanText(record.Title));
}

export function structureHcRecall(record: HcRecallRecord): StructuredProductRecall {
  const nid = (record.NID ?? '').trim();
  if (!/^\d{1,8}$/.test(nid)) throw new Error(`unusable Health Canada NID: ${JSON.stringify(record.NID)}`);
  const title = cleanText(record.Title);
  const product = cleanText(record.Product);
  const issue = cleanText(record.Issue) || null;
  const category = cleanText(record.Category) || null;
  const advice = cleanText(record['What you should do']);
  const recallClass = cleanText(record['Recall class']);
  const lastUpdated = /^\d{4}-\d{2}-\d{2}$/.test(record['Last updated'] ?? '') ? (record['Last updated'] as string) : null;
  const url = cleanText(record.URL) || `https://recalls-rappels.canada.ca/en/node/${nid}`;
  const models = extractModelNumbers(title, product);
  return {
    id: `hc-${nid}`,
    agency: 'HC',
    jurisdiction: 'CA',
    source_id: nid,
    title,
    url,
    published_on: null,
    updated_on: lastUpdated,
    archived: record.Archived === '1' ? true : record.Archived === '0' ? false : null,
    recall_class: recallClass && recallClass !== '--' ? recallClass : null,
    product_category: category,
    products: product ? [{ name: product, type: category, units: { us: null, canada: null, mexico: null, text: null } }] : [],
    title_firm: null,
    firms: [],
    sold_at: [],
    manufacturer_countries: [],
    description: null,
    hazard: { classes: classifyHazards(issue, title), text: issue },
    remedy: { classes: classifyRemedies(advice), text: null },
    injuries: null,
    units: { us: null, canada: null, mexico: null, text: null },
    identifiers: { gtins: [], model_numbers: models.printed, model_keys: models.keys },
    trade_facets: tradeFacets(`${title} ${product}`, category ? category.split(' - ') : [], `${issue ?? ''} ${title}`),
    cross_references: [],
    joint_with: jointAgencies(advice),
    provenance: {
      source: 'health-canada-consumer-product-recalls',
      source_url: url,
      parser_version: PARSER_VERSION,
      derived_fields: {
        'identifiers.model_numbers': ['Title', 'Product'],
        'hazard.classes': ['Issue', 'Title'],
        'remedy.classes': ['What you should do'],
        trade_facets: ['Title', 'Product', 'Category', 'Issue'],
        joint_with: ['What you should do'],
      },
    },
  };
}
