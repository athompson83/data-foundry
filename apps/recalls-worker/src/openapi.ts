import { ALLERGENS, PATHOGENS, REASON_CLASSES } from '@data-foundry/recall-structuring';

import type { PageContext } from './pages.js';

const stringParam = (name: string, description: string, extra: Record<string, unknown> = {}) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'string', ...extra },
});

export function openApiDocument(ctx: PageContext): Record<string, unknown> {
  const recallRef = { $ref: '#/components/schemas/Recall' };
  const errors = {
    '400': { $ref: '#/components/responses/Error' },
    '401': { $ref: '#/components/responses/Error' },
    '403': { $ref: '#/components/responses/Error' },
    '429': { $ref: '#/components/responses/Error' },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Data Foundry — FDA Recall Intelligence API',
      version: '1.0.0',
      description:
        'Structured FDA food, drug and device enforcement reports (openFDA, CC0): distribution states, lots, GTIN/UPC/UDI, NDC, expiry dates, allergens and pathogens, each with provenance. Not endorsed by FDA.',
      contact: { email: ctx.supportEmail, url: `${ctx.publicOrigin}/recalls` },
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
}
