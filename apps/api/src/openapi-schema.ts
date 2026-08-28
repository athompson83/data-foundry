/** Runtime JSON Schema metadata for the camelCase REST wire contract. */
import { CORRECTION_FIELDS_JSON_SCHEMA } from '@data-foundry/query-model';

const nullableString = { type: ['string', 'null'] } as const;
const uuid = { type: 'string', format: 'uuid' } as const;
const instant = { type: 'string', format: 'date-time' } as const;
const reference = (name: string): Readonly<Record<string, string>> => ({
  $ref: `#/components/schemas/${name}`,
});

export const OPENAPI_SCHEMAS = {
  ApiErrorEnvelope: {
    type: 'object',
    additionalProperties: false,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'status', 'message'],
        properties: {
          code: { type: 'string' },
          status: { type: 'integer', minimum: 400, maximum: 599 },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
          requestId: { type: 'string', maxLength: 64 },
        },
      },
    },
  },
  OpaqueEdgeErrorEnvelope: {
    type: 'object',
    additionalProperties: false,
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', enum: ['UNAUTHORIZED', 'FORBIDDEN', 'SERVICE_UNAVAILABLE'] },
          message: { type: 'string' },
        },
      },
    },
  },
  PageMeta: {
    type: 'object',
    additionalProperties: false,
    required: ['limit', 'offset', 'total', 'hasMore'],
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0, maximum: 10_000 },
      total: { type: 'integer', minimum: 0 },
      hasMore: { type: 'boolean' },
    },
  },
  Entity: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id', 'verticalId', 'entityType', 'canonicalName', 'canonicalSlug', 'status',
      'qualityScore', 'firstSeenAt', 'lastVerifiedAt', 'createdAt', 'updatedAt',
    ],
    properties: {
      id: uuid,
      verticalId: uuid,
      entityType: { type: 'string' },
      canonicalName: { type: 'string' },
      canonicalSlug: { type: 'string' },
      status: { type: 'string' },
      qualityScore: { type: 'number', minimum: 0, maximum: 1 },
      firstSeenAt: instant,
      lastVerifiedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: instant,
      updatedAt: instant,
    },
  },
  RedirectHop: {
    type: 'object',
    additionalProperties: false,
    required: ['fromEntityId', 'toEntityId', 'fromSlug', 'reason', 'createdAt'],
    properties: {
      fromEntityId: uuid,
      toEntityId: uuid,
      fromSlug: nullableString,
      reason: { type: 'string' },
      createdAt: instant,
    },
  },
  RedirectTrace: {
    type: 'object',
    additionalProperties: false,
    required: ['fromEntityId', 'fromSlug', 'reason', 'hops'],
    properties: {
      fromEntityId: { type: ['string', 'null'], format: 'uuid' },
      fromSlug: nullableString,
      reason: nullableString,
      hops: { type: 'array', items: reference('RedirectHop') },
    },
  },
  RedirectResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['redirect'],
    properties: {
      redirect: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'location', 'canonicalEntityId', 'redirectedFrom'],
        properties: {
          status: { type: 'integer', const: 301 },
          location: { type: 'string' },
          canonicalEntityId: uuid,
          redirectedFrom: reference('RedirectTrace'),
        },
      },
    },
  },
  EntityView: {
    type: 'object',
    additionalProperties: false,
    required: ['entity', 'redirectedFrom'],
    properties: {
      entity: reference('Entity'),
      redirectedFrom: { oneOf: [reference('RedirectTrace'), { type: 'null' }] },
    },
  },
  Fact: {
    // JSON Schema 2020-12 tracks properties evaluated across every `allOf`
    // member. `additionalProperties: false` on the base member would instead
    // reject the correction fields contributed by the shared schema.
    unevaluatedProperties: false,
    allOf: [
      {
        type: 'object',
        required: [
          'property', 'value', 'valueType', 'unit', 'confidence', 'factId', 'rule',
          'reason', 'sources', 'unresolvedConflict',
        ],
        properties: {
          property: { type: 'string' },
          value: true,
          valueType: nullableString,
          unit: nullableString,
          confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
          factId: { type: ['string', 'null'], format: 'uuid' },
          rule: { type: 'string' },
          reason: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          unresolvedConflict: { type: 'boolean' },
          verified: { type: 'boolean' },
        },
      },
      CORRECTION_FIELDS_JSON_SCHEMA,
    ],
  },
  RelationshipEdge: {
    type: 'object',
    additionalProperties: false,
    required: [
      'relationshipId', 'predicate', 'direction', 'fromEntityId', 'neighbor', 'depth',
      'evidenceCount', 'confidence', 'validFrom', 'validTo',
    ],
    properties: {
      relationshipId: uuid,
      predicate: { type: 'string' },
      direction: { type: 'string', enum: ['out', 'in'] },
      fromEntityId: uuid,
      neighbor: reference('Entity'),
      depth: { type: 'integer', minimum: 1, maximum: 4 },
      evidenceCount: { type: 'integer', minimum: 0 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      validFrom: instant,
      validTo: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  SearchHit: {
    type: 'object',
    additionalProperties: false,
    required: ['entity', 'matchKind', 'score', 'textRank', 'exact', 'matchedOn', 'explain'],
    properties: {
      entity: reference('Entity'),
      matchKind: { type: 'string' },
      score: { type: 'number' },
      textRank: { type: 'number' },
      exact: { type: 'boolean' },
      matchedOn: nullableString,
      explain: { type: 'string' },
    },
  },
  Facet: {
    type: 'object',
    additionalProperties: false,
    required: ['property', 'label', 'control', 'valueType', 'unit', 'values', 'range', 'entityCount'],
    properties: {
      property: { type: 'string' },
      label: { type: 'string' },
      control: { type: 'string' },
      valueType: { type: 'string' },
      unit: nullableString,
      values: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['value', 'count'],
          properties: { value: { type: 'string' }, count: { type: 'integer', minimum: 0 } },
        },
      },
      range: {
        oneOf: [
          {
            type: 'object', additionalProperties: false, required: ['min', 'max'],
            properties: { min: { type: 'number' }, max: { type: 'number' } },
          },
          { type: 'null' },
        ],
      },
      entityCount: { type: 'integer', minimum: 0 },
    },
  },
  Comparison: {
    type: 'object',
    additionalProperties: false,
    required: ['entities', 'rows', 'propertiesCompared', 'propertiesDiffering'],
    properties: {
      entities: { type: 'array', items: reference('Entity'), minItems: 2, maxItems: 8 },
      rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
      propertiesCompared: { type: 'integer', minimum: 0 },
      propertiesDiffering: { type: 'integer', minimum: 0 },
    },
  },
  HealthResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'version', 'verticalId', 'declaredFields', 'checks'],
    properties: {
      status: { type: 'string', const: 'ok' },
      version: { type: 'string', const: 'v1' },
      verticalId: uuid,
      declaredFields: { type: 'integer', minimum: 0 },
      checks: {
        type: 'object', additionalProperties: false, required: ['queryLayer'],
        properties: { queryLayer: { type: 'string', const: 'ok' } },
      },
    },
  },
  EntityResponse: {
    type: 'object', additionalProperties: false, required: ['data'],
    properties: { data: reference('EntityView') },
  },
  FactPageResponse: {
    type: 'object', additionalProperties: false, required: ['entityId', 'data', 'page'],
    properties: {
      entityId: uuid,
      data: { type: 'array', items: reference('Fact') },
      page: reference('PageMeta'),
    },
  },
  RelationshipPageResponse: {
    type: 'object', additionalProperties: false,
    required: ['entityId', 'traversal', 'data', 'page'],
    properties: {
      entityId: uuid,
      traversal: { type: 'object', additionalProperties: true },
      data: { type: 'array', items: reference('RelationshipEdge') },
      page: reference('PageMeta'),
    },
  },
  SearchResponse: {
    type: 'object', additionalProperties: false,
    required: ['data', 'page', 'match', 'strategy', 'facets'],
    properties: {
      data: { type: 'array', items: reference('SearchHit') },
      page: reference('PageMeta'),
      match: { type: 'object', additionalProperties: true },
      strategy: { type: 'object', additionalProperties: true },
      facets: { type: 'array', items: reference('Facet') },
    },
  },
  CompareResponse: {
    type: 'object', additionalProperties: false, required: ['data', 'redirects'],
    properties: {
      data: reference('Comparison'),
      redirects: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['requestedId', 'canonicalEntityId'],
          properties: { requestedId: uuid, canonicalEntityId: uuid },
        },
      },
    },
  },
} as const;

export type OpenApiResponseSchemaName =
  | 'HealthResponse'
  | 'EntityResponse'
  | 'FactPageResponse'
  | 'RelationshipPageResponse'
  | 'SearchResponse'
  | 'CompareResponse';
