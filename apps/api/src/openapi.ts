/** OpenAPI 3.1 projection of live routes, vertical fields, and runtime wire schemas. */
import {
  FieldMetadataSchema,
  isNumericValueType,
  runtimeSchema as z,
  type FieldMetadata,
} from '@data-foundry/query-model';
import { PAGE_BOUNDS } from './pagination.js';
import { READ_METHODS, ROUTES, type Route } from './routes.js';
import { WIRE_COMPONENT_SCHEMAS } from './wire.js';

type JsonObject = Readonly<Record<string, unknown>>;

export interface OpenApiVerticalMetadata {
  readonly slug: string;
  readonly fields: readonly unknown[];
}

export type OpenApiChannel = 'DIRECT' | 'RAPIDAPI';

export interface BuildOpenApiDocumentOptions {
  readonly channel?: OpenApiChannel;
}

const DIRECT_SECURITY = [{ DataFoundryBearer: [] }] as const;

const QUERY_PARAMETER_SCHEMA: Readonly<Record<string, JsonObject>> = {
  q: { type: 'string', description: 'Text or exact identifier search.' },
  type: { type: 'string', description: 'Vertical-defined entity type.' },
  property: { type: 'string', description: 'Vertical-defined fact property.' },
  predicate: { type: 'string', description: 'Vertical-defined relationship predicate.' },
  direction: { type: 'string', enum: ['out', 'in', 'both'], default: 'both' },
  depth: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
  facets: { type: 'boolean', default: false },
  limit: {
    type: 'integer',
    minimum: PAGE_BOUNDS.minLimit,
    maximum: PAGE_BOUNDS.maxLimit,
    default: PAGE_BOUNDS.defaultLimit,
  },
  offset: { type: 'integer', minimum: 0, maximum: PAGE_BOUNDS.maxOffset, default: 0 },
  at: { type: 'string', format: 'date-time' },
  ids: {
    type: 'string',
    description: 'Comma-separated canonical entity UUIDs. Between 2 and 8 distinct entities after redirects.',
  },
  properties: { type: 'string', description: 'Comma-separated vertical-defined fact properties.' },
};

function splitDocumentedPath(path: string): { readonly pathname: string; readonly queryNames: string[] } {
  const [pathname = path, query = ''] = path.split('?', 2);
  const queryNames = query === ''
    ? []
    : query
        .split('&')
        .map((part) => part.split('=', 1)[0] ?? '')
        .filter((name) => name !== '');
  return { pathname, queryNames };
}

function verticalFilterParameters(fields: readonly FieldMetadata[]): readonly JsonObject[] {
  const parameters: JsonObject[] = [];
  for (const field of fields) {
    if (field.filter === null || field.filter.type === 'none') continue;
    const name = `filter.${field.field}`;
    parameters.push({
      name,
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description:
        `Comma-separated exact values for ${field.field}` +
        (field.unit === null ? '.' : ` (${field.unit}).`),
    });
    if (isNumericValueType(field.value_type)) {
      parameters.push(
        {
          name: `${name}.min`,
          in: 'query',
          required: false,
          schema: { type: 'number' },
          description: `Inclusive minimum for ${field.field}.`,
        },
        {
          name: `${name}.max`,
          in: 'query',
          required: false,
          schema: { type: 'number' },
          description: `Inclusive maximum for ${field.field}.`,
        },
      );
    }
    parameters.push({
      name: `${name}.exists`,
      in: 'query',
      required: false,
      allowEmptyValue: true,
      schema: { type: 'string', enum: ['true', '1'] },
      description: `Require an authorized current ${field.field} fact; false/0 are not supported.`,
    });
  }
  return parameters;
}

function parametersFor(route: Route, fields: readonly FieldMetadata[]): readonly JsonObject[] {
  const { pathname, queryNames } = splitDocumentedPath(route.path);
  const parameters: JsonObject[] = [];
  for (const match of pathname.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1];
    if (name === undefined) continue;
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: name === 'id' ? { type: 'string', format: 'uuid' } : { type: 'string' },
    });
  }
  const required = new Set(route.openapi.requiredQueryParameters ?? []);
  for (const name of queryNames) {
    if (name === 'filter.{field}') {
      parameters.push(...verticalFilterParameters(fields));
      continue;
    }
    parameters.push({
      name,
      in: 'query',
      required: required.has(name),
      schema: QUERY_PARAMETER_SCHEMA[name] ?? { type: 'string' },
    });
  }
  return parameters;
}

function errorResponse(description: string, edgePossible = false): JsonObject {
  const schema = edgePossible
    ? {
        oneOf: [
          { $ref: '#/components/schemas/ApiErrorEnvelope' },
          { $ref: '#/components/schemas/OpaqueEdgeErrorEnvelope' },
        ],
      }
    : { $ref: '#/components/schemas/ApiErrorEnvelope' };
  return { description, content: { 'application/json': { schema } } };
}

function responsesFor(route: Route, method: 'GET' | 'HEAD'): JsonObject {
  const success = method === 'HEAD'
    ? { description: 'Same status and headers as GET, with no response body.' }
    : {
        description: 'Successful response.',
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${route.openapi.responseSchema}` },
          },
        },
      };
  const redirect = {
    description: 'The canonical entity moved. Follow the Location header.',
    headers: {
      Location: { schema: { type: 'string' }, description: 'Canonical resource path.' },
    },
    ...(method === 'HEAD'
      ? {}
      : {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RedirectResponse' } },
          },
        }),
  };
  return {
    '200': success,
    ...(route.openapi.mayRedirect === true ? { '301': redirect } : {}),
    '400': errorResponse('Invalid or missing request parameter.'),
    '401': errorResponse('Origin authentication failed.', true),
    '403': errorResponse('The authenticated key may not access this origin or vertical.', true),
    '404': errorResponse('The version, route, or entity was not found.'),
    '405': errorResponse('The method is not allowed; this API is read-only.'),
    '422': errorResponse('The query is syntactically valid but unsupported by this vertical.'),
    '500': errorResponse('An opaque internal failure occurred.'),
    '503': errorResponse('The query layer or deployment configuration is unavailable.', true),
  };
}

function operationFor(
  route: Route,
  method: 'GET' | 'HEAD',
  fields: readonly FieldMetadata[],
  channel: OpenApiChannel,
): JsonObject {
  return {
    operationId: method === 'GET' ? route.openapi.operationId : `${route.openapi.operationId}Head`,
    summary: route.summary,
    ...(route.caveat === undefined ? {} : { description: route.caveat }),
    tags: [route.routeKey.split('.')[0] ?? 'api'],
    parameters: parametersFor(route, fields),
    ...(channel === 'DIRECT' ? { security: DIRECT_SECURITY } : {}),
    responses: responsesFor(route, method),
    'x-data-foundry-route-key': route.routeKey,
  };
}

function generatedComponentSchemas(): Readonly<Record<string, JsonObject>> {
  return Object.fromEntries(
    Object.entries(WIRE_COMPONENT_SCHEMAS).map(([name, schema]) => {
      const generated = z.toJSONSchema(schema, {
        target: 'draft-2020-12',
        reused: 'inline',
        unrepresentable: 'any',
      }) as Record<string, unknown>;
      delete generated['$schema'];
      return [name, generated];
    }),
  );
}

export function buildOpenApiDocument(
  vertical: OpenApiVerticalMetadata,
  options: BuildOpenApiDocumentOptions = {},
): JsonObject {
  const slug = vertical.slug.trim();
  if (slug === '') throw new Error('OpenAPI vertical slug must not be blank.');
  const channel = options.channel ?? 'DIRECT';
  if (channel !== 'DIRECT' && channel !== 'RAPIDAPI') {
    throw new Error(`Unsupported OpenAPI channel: ${String(channel)}.`);
  }
  const fields = vertical.fields.map((field) => FieldMetadataSchema.parse(field));
  const paths: Record<string, Record<string, JsonObject>> = {};
  const operationIds = new Set<string>();
  for (const route of ROUTES) {
    // This arm exists only to shape the missing-slug error and is not a resource.
    if (route.pattern.at(-1) === 'by-slug') continue;
    const { pathname } = splitDocumentedPath(route.path);
    if (paths[pathname] !== undefined) throw new Error(`duplicate documented API path: ${pathname}`);
    const operations: Record<string, JsonObject> = {};
    for (const method of READ_METHODS) {
      const operation = operationFor(route, method, fields, channel);
      const operationId = operation['operationId'];
      if (typeof operationId !== 'string' || operationIds.has(operationId)) {
        throw new Error(`duplicate OpenAPI operationId: ${String(operationId)}`);
      }
      operationIds.add(operationId);
      operations[method.toLowerCase()] = operation;
    }
    paths[pathname] = operations;
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Data Foundry API',
      version: '1.0.0',
      description:
        channel === 'DIRECT'
          ? 'One read-only canonical API served directly and through a trusted RapidAPI marketplace origin.'
          : 'The read-only canonical Data Foundry API exposed through the RapidAPI marketplace.',
    },
    servers: [{
      url: '/',
      description: channel === 'DIRECT'
        ? 'The configured Data Foundry Cloudflare origin.'
        : 'The marketplace endpoint configured for this listing.',
    }],
    paths,
    components: {
      securitySchemes: channel === 'DIRECT'
        ? {
            DataFoundryBearer: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'Data Foundry API key',
              description: 'Direct API requests use a tenant/vertical-scoped Data Foundry bearer key.',
            },
          }
        : {},
      schemas: generatedComponentSchemas(),
    },
    'x-data-foundry-vertical': slug,
  };
}
