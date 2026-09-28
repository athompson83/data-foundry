import { HAZARD_CLASSES, REMEDY_CLASSES, TRADE_FACETS } from '@data-foundry/product-recall-structuring';
import { ALLERGENS, PATHOGENS, REASON_CLASSES } from '@data-foundry/recall-structuring';

import type { PageContext } from './pages.js';

const stringParam = (name: string, description: string, extra: Record<string, unknown> = {}) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'string', ...extra },
});

/** Paths of the CPSC/Health Canada product-recall dataset, listed only while it is served. */
function productPaths(errors: Record<string, unknown>): Record<string, unknown> {
  const noticeRef = { $ref: '#/components/schemas/ProductRecall' };
  const raw = stringParam('include', 'Set to "raw" to include the verbatim source record (contact text and images removed).', { enum: ['raw'] });
  return {
    '/v1/product-recalls/lookup': {
      get: {
        operationId: 'lookupProductRecall',
        summary: 'Find CPSC and Health Canada recall notices for one model number or UPC/EAN/GTIN',
        parameters: [{ ...stringParam('code', 'Model number or barcode as printed.'), required: true }, raw],
        responses: {
          '200': { description: 'Matches', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: { matched_on: { type: 'array', items: { type: 'object' } }, recall: noticeRef } } }, total_matches: { type: 'integer' }, truncated: { type: 'boolean' }, interpreted_as: { type: 'array', items: { type: 'object' } } } } } } },
          ...errors,
        },
      },
    },
    '/v1/product-recalls': {
      get: {
        operationId: 'searchProductRecalls',
        summary: 'Filter CPSC and Health Canada notices, newest first',
        parameters: [
          stringParam('gtin', 'UPC/EAN/GTIN with a valid check digit.'),
          stringParam('model', 'Model number (matched on letters and digits only).'),
          stringParam('agency', 'Issuing agency.', { enum: ['CPSC', 'HC'] }),
          stringParam('hazard', 'Hazard class.', { enum: [...HAZARD_CLASSES] }),
          stringParam('remedy', 'Remedy class.', { enum: [...REMEDY_CLASSES] }),
          stringParam('facet', 'Trade facet.', { enum: [...TRADE_FACETS] }),
          stringParam('category', "The agency's product type or category (case-insensitive, exact)."),
          stringParam('manufacturer_country', 'Country of manufacture as CPSC names it.'),
          stringParam('firm', 'Full-text match on firm names.'),
          stringParam('q', 'Full-text search over title, firms, products and description.'),
          stringParam('linked', 'true: only notices with a declared cross-agency link.', { enum: ['true', 'false'] }),
          stringParam('from', 'YYYY-MM-DD (publication date, or last-updated date for Health Canada)', { format: 'date' }),
          stringParam('to', 'YYYY-MM-DD', { format: 'date' }),
          stringParam('changed_since', 'ISO timestamp for incremental sync.', { format: 'date-time' }),
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
          stringParam('cursor', 'next_cursor from the previous page.'),
          raw,
        ],
        responses: { '200': { description: 'A page of notices', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: noticeRef }, next_cursor: { type: ['string', 'null'] } } } } } }, ...errors },
      },
    },
    '/v1/product-recalls/{id}': {
      get: {
        operationId: 'getProductRecall',
        summary: 'One notice by id (cpsc-<recall number> or hc-<notice id>)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^(cpsc-\\d{5}[a-z]?|hc-\\d{1,8})$' } }, raw],
        responses: { '200': { description: 'The notice', content: { 'application/json': { schema: { type: 'object', properties: { data: noticeRef } } } } }, '404': { $ref: '#/components/responses/Error' }, ...errors },
      },
    },
    '/v1/product-recalls/stats': { get: { operationId: 'getProductRecallStats', summary: 'Public coverage counts', security: [], responses: { '200': { description: 'Coverage' } } } },
  };
}

const PRODUCT_RECALL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    agency: { type: 'string', enum: ['CPSC', 'HC'] },
    jurisdiction: { type: 'string', enum: ['US', 'CA'] },
    source_id: { type: 'string' },
    title: { type: 'string' },
    url: { type: 'string' },
    published_on: { type: ['string', 'null'] },
    updated_on: { type: ['string', 'null'] },
    products: { type: 'array', items: { type: 'object' } },
    firms: { type: 'array', items: { type: 'object' } },
    hazard: { type: 'object', properties: { classes: { type: 'array', items: { type: 'string', enum: [...HAZARD_CLASSES] } }, text: { type: ['string', 'null'] } } },
    remedy: { type: 'object', properties: { classes: { type: 'array', items: { type: 'string', enum: [...REMEDY_CLASSES] } }, text: { type: ['string', 'null'] } } },
    units: { type: 'object', properties: { us: { type: ['integer', 'null'] }, canada: { type: ['integer', 'null'] }, mexico: { type: ['integer', 'null'] }, text: { type: ['string', 'null'] } } },
    identifiers: { type: 'object', properties: { gtins: { type: 'array', items: { type: 'string' } }, model_numbers: { type: 'array', items: { type: 'string' } }, model_keys: { type: 'array', items: { type: 'string' } } } },
    trade_facets: { type: 'array', items: { type: 'string', enum: [...TRADE_FACETS] } },
    linked_notices: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, agency: { type: 'string' }, relation: { type: 'string', enum: ['cites', 'cited_by'] }, basis: { type: 'string', enum: ['declared_citation'] } } } },
    provenance: { type: 'object' },
    raw: { type: 'object', description: 'Verbatim source record (include=raw) with the fields listed in raw_redaction.removed_fields withheld.' },
    raw_redaction: {
      type: 'object',
      description: 'With include=raw. provenance.raw_sha256 is the digest of the stored original record; presented_sha256 is the SHA-256 of JSON.stringify(raw) as returned.',
      properties: { removed_fields: { type: 'array', items: { type: 'string' } }, presented_sha256: { type: 'string' } },
    },
  },
};

/** The contract for the datasets served right now: a withdrawn dataset's paths and schema are omitted. */
/**
 * `marketplace` renders the contract RapidAPI imports: the same data paths, with
 * no account endpoints and no bearer scheme (RapidAPI authenticates its subscribers).
 */
export function openApiDocument(ctx: PageContext, served: { readonly fda: boolean; readonly products: boolean; readonly marketplace?: boolean }): Record<string, unknown> {
  const { products } = served;
  const recallRef = { $ref: '#/components/schemas/Recall' };
  const errors = {
    '400': { $ref: '#/components/responses/Error' },
    '401': { $ref: '#/components/responses/Error' },
    '403': { $ref: '#/components/responses/Error' },
    '429': { $ref: '#/components/responses/Error' },
  };
  const document = {
    openapi: '3.1.0',
    info: {
      title: products ? 'Data Foundry — Recall APIs (FDA; CPSC and Health Canada)' : 'Data Foundry — FDA Recall Intelligence API',
      version: '1.0.0',
      description:
        `Structured FDA food, drug and device enforcement reports (openFDA, CC0): distribution states, lots, GTIN/UPC/UDI, NDC, expiry dates, allergens and pathogens, each with provenance.${products ? ' CPSC and Health Canada consumer-product recalls (US Government work; Open Government Licence – Canada): model numbers, GTINs, units, hazard and remedy classes, trade facets and declared cross-agency links.' : ''} Not endorsed by FDA, CPSC or Health Canada.`,
      contact: { email: ctx.supportEmail, url: `${ctx.publicOrigin}/` },
      termsOfService: `${ctx.publicOrigin}/terms`,
    },
    servers: [{ url: ctx.apiOrigin }],
    security: [{ bearer: [] }],
    paths: {
      '/v1/recalls/lookup': {
        get: {
          operationId: 'lookupCode',
          summary: 'Find recalls for one product code (GTIN/UPC/UDI, NDC, lot, serial or model)',
          parameters: [{ ...stringParam('code', 'The code as scanned or printed.'), required: true }, stringParam('include', 'Set to "raw" to include the verbatim FDA record.', { enum: ['raw'] })],
          responses: {
            '200': {
              description: 'Matches',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: { matched_on: { type: 'array', items: { type: 'object' } }, recall: recallRef } } } } } } },
            },
            ...errors,
          },
        },
      },
      '/v1/recalls': {
        get: {
          operationId: 'searchRecalls',
          summary: 'Filter recalls, newest report first',
          parameters: [
            stringParam('gtin', 'UPC/EAN/GTIN/UDI-DI with a valid check digit.'),
            stringParam('ndc', 'National Drug Code: a package code matches that package or a whole-product recall; a product code matches all its packages.'),
            stringParam('lot', 'Lot number.'),
            stringParam('serial', 'Serial number.'),
            stringParam('model', 'Model or catalog number.'),
            stringParam('state', 'USPS state code; nationwide recalls always match.'),
            stringParam('country', 'ISO 3166-1 alpha-2 code.'),
            stringParam('category', 'Product category.', { enum: ['food', 'drug', 'device'] }),
            stringParam('classification', 'FDA recall class.', { enum: ['I', 'II', 'III'] }),
            stringParam('status', 'Recall status.', { enum: ['Ongoing', 'Completed', 'Terminated', 'Pending'] }),
            stringParam('reason_class', 'Recall reason class.', { enum: [...REASON_CLASSES] }),
            stringParam('allergen', 'Undeclared major allergen.', { enum: [...ALLERGENS] }),
            stringParam('pathogen', 'Named pathogen.', { enum: [...PATHOGENS] }),
            stringParam('firm', 'Substring of the recalling firm name.'),
            stringParam('q', 'Full-text search over firm, product and reason.'),
            stringParam('reported_from', 'YYYY-MM-DD', { format: 'date' }),
            stringParam('reported_to', 'YYYY-MM-DD', { format: 'date' }),
            stringParam('changed_since', 'ISO timestamp for incremental sync.', { format: 'date-time' }),
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            stringParam('cursor', 'next_cursor from the previous page.'),
            stringParam('include', 'Set to "raw" to include the verbatim FDA record.', { enum: ['raw'] }),
          ],
          responses: {
            '200': {
              description: 'A page of recalls',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: recallRef }, next_cursor: { type: ['string', 'null'] } } } } },
            },
            ...errors,
          },
        },
      },
      '/v1/recalls/{recall_number}': {
        get: {
          operationId: 'getRecall',
          summary: 'One recall by FDA recall number',
          parameters: [{ name: 'recall_number', in: 'path', required: true, schema: { type: 'string' } }, stringParam('include', 'Set to "raw" to include the verbatim FDA record.', { enum: ['raw'] })],
          responses: { '200': { description: 'The recall', content: { 'application/json': { schema: { type: 'object', properties: { data: recallRef } } } } }, '404': { $ref: '#/components/responses/Error' }, ...errors },
        },
      },
      '/v1/account': { get: { operationId: 'getAccount', summary: 'Plan, usage and allowance (not metered)', responses: { '200': { description: 'Account' }, ...errors } } },
      '/v1/account/rotate-key': { post: { operationId: 'rotateKey', summary: 'Revoke this key and issue a new one', responses: { '200': { description: 'New key' }, ...errors } } },
      '/v1/account/billing-portal': { post: { operationId: 'billingPortal', summary: 'Stripe billing portal URL', responses: { '200': { description: 'Portal URL' }, ...errors } } },
      '/v1/recalls/stats': { get: { operationId: 'getStats', summary: 'Public coverage counts', security: [], responses: { '200': { description: 'Coverage' } } } },
      ...(products ? productPaths(errors) : {}),
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'rcl_live_… API key' } },
      responses: {
        Error: {
          description: 'Error',
          content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } },
        },
      },
      schemas: {
        ...(products ? { ProductRecall: PRODUCT_RECALL_SCHEMA } : {}),
        Recall: {
          type: 'object',
          properties: {
            recall_number: { type: 'string' },
            category: { type: 'string', enum: ['food', 'drug', 'device'] },
            classification: { type: ['string', 'null'], enum: ['I', 'II', 'III', null] },
            status: { type: ['string', 'null'] },
            voluntary: { type: ['boolean', 'null'] },
            event_id: { type: ['string', 'null'] },
            firm: { type: 'object' },
            dates: { type: 'object' },
            product_description: { type: ['string', 'null'] },
            reason_for_recall: { type: ['string', 'null'] },
            distribution: {
              type: 'object',
              properties: {
                nationwide_us: { type: 'boolean' },
                international: { type: 'boolean' },
                us_states: { type: 'array', items: { type: 'string' } },
                countries: { type: 'array', items: { type: 'string' } },
                us_military: { type: 'boolean' },
                internet_sales: { type: 'boolean' },
              },
            },
            quantity: { type: 'object' },
            codes: {
              type: 'object',
              properties: {
                gtins: { type: 'array', items: { type: 'string' } },
                ndcs: { type: 'array', items: { type: 'string' } },
                lots: { type: 'array', items: { type: 'string' } },
                serial_numbers: { type: 'array', items: { type: 'string' } },
                model_numbers: { type: 'array', items: { type: 'string' } },
                expiration_dates: { type: 'array', items: { type: 'string' } },
              },
            },
            reason: { type: 'object' },
            provenance: { type: 'object' },
            raw: { type: 'object', description: 'Verbatim FDA record (include=raw).' },
          },
        },
      },
    },
  };
  if (!served.fda) {
    for (const path of ['/v1/recalls/lookup', '/v1/recalls', '/v1/recalls/{recall_number}', '/v1/recalls/stats']) delete (document.paths as Record<string, unknown>)[path];
    delete (document.components.schemas as Record<string, unknown>)['Recall'];
    document.info.title = products ? 'Data Foundry — Consumer Product Recall API (CPSC and Health Canada)' : 'Data Foundry API';
    document.info.description = products
      ? 'CPSC and Health Canada consumer-product recalls (US Government work; Open Government Licence – Canada): model numbers, GTINs, units, hazard and remedy classes, trade facets and declared cross-agency links. Not endorsed by CPSC or Health Canada.'
      : 'No dataset is available right now.';
  }
  if (served.marketplace) {
    for (const path of ['/v1/account', '/v1/account/rotate-key', '/v1/account/billing-portal']) delete (document.paths as Record<string, unknown>)[path];
    (document as { security: unknown[] }).security = [];
    delete (document.components as { securitySchemes?: unknown }).securitySchemes;
  }
  return document;
}
