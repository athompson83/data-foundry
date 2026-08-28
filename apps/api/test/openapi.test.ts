/**
 * The OpenAPI contract is another projection of the live route table, not a
 * hand-maintained inventory for a marketplace listing.
 */
import { describe, expect, it } from 'vitest';
import { READ_METHODS, ROUTES } from '../src/routes.js';
import type { FieldMetadataInput } from '@data-foundry/query-model';

type OpenApiOperation = {
  readonly operationId: string;
  readonly parameters?: readonly { readonly name: string; readonly in: string; readonly required: boolean }[];
  readonly responses: Readonly<Record<string, unknown>>;
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
};

type OpenApiDocument = {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, unknown>>;
    readonly securitySchemes: Readonly<Record<string, unknown>>;
  };
};

const documentedRoutes = ROUTES.filter((route) => route.pattern.at(-1) !== 'by-slug');
const cleanPath = (path: string): string => path.split('?')[0] ?? path;

const FILTER_FIELDS = [
  {
    field: 'refrigerant',
    value_type: 'string',
    filter: { type: 'multi_select', facet_count: true },
  },
  {
    field: 'seer2',
    value_type: 'number',
    filter: { type: 'range', facet_count: true },
  },
  {
    field: 'compressor_stages',
    value_type: 'integer',
    filter: { type: 'range', facet_count: true },
  },
  {
    field: 'cooling_capacity',
    value_type: 'quantity',
    unit: 'BTU/h',
    filter: { type: 'range', facet_count: true },
  },
  {
    field: 'internal_note',
    value_type: 'string',
    filter: { type: 'none', facet_count: false },
  },
] satisfies readonly FieldMetadataInput[];

const OPENAPI_VERTICAL = { slug: 'hvac', fields: FILTER_FIELDS } as const;

async function loadBuilder(): Promise<((vertical: typeof OPENAPI_VERTICAL) => OpenApiDocument) | null> {
  const module = await import('../src/openapi.js').catch(() => null);
  expect(module, 'apps/api must expose an OpenAPI projection of ROUTES').not.toBeNull();
  if (module === null) return null;
  const build = (module as Record<string, unknown>)['buildOpenApiDocument'];
  expect(typeof build).toBe('function');
  return typeof build === 'function'
    ? (build as (vertical: typeof OPENAPI_VERTICAL) => OpenApiDocument)
    : null;
}

describe('the generated OpenAPI document', () => {
  it('comes from every documented ROUTES entry with GET and HEAD, and no duplicate route list', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build(OPENAPI_VERTICAL);
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths).sort()).toEqual(
      [...new Set(documentedRoutes.map((route) => cleanPath(route.path)))].sort(),
    );
    for (const route of documentedRoutes) {
      const operations = document.paths[cleanPath(route.path)];
      expect(operations, route.path).toBeDefined();
      expect(Object.keys(operations ?? {}).sort(), route.path).toEqual(
        READ_METHODS.map((method) => method.toLowerCase()).sort(),
      );
      expect(operations?.['get']?.operationId, route.path).toBeTruthy();
      expect(operations?.['head']?.operationId, route.path).toBeTruthy();
    }
  });

  it('derives path/query parameters from each route and preserves required query inputs', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build(OPENAPI_VERTICAL);

    const slug = document.paths['/v1/entities/by-slug/{slug}']?.['get'];
    expect(slug?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'slug', in: 'path', required: true }),
        expect.objectContaining({ name: 'type', in: 'query', required: true }),
      ]),
    );
    const compare = document.paths['/v1/compare']?.['get'];
    expect(compare?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ids', in: 'query', required: true }),
        expect.objectContaining({ name: 'properties', in: 'query', required: false }),
      ]),
    );
    const search = document.paths['/v1/search']?.['get'];
    const searchParameterNames = search?.parameters?.map(({ name }) => name) ?? [];
    expect(searchParameterNames).toEqual(expect.arrayContaining([
      'filter.refrigerant',
      'filter.refrigerant.exists',
      'filter.seer2',
      'filter.seer2.min',
      'filter.seer2.max',
      'filter.seer2.exists',
      'filter.compressor_stages',
      'filter.compressor_stages.min',
      'filter.compressor_stages.max',
      'filter.compressor_stages.exists',
      'filter.cooling_capacity',
      'filter.cooling_capacity.min',
      'filter.cooling_capacity.max',
      'filter.cooling_capacity.exists',
      'limit',
    ]));
    expect(searchParameterNames).not.toContain('filter.{field}');
    expect(searchParameterNames).not.toContain('filter.internal_note');
  });

  it('publishes only the consumer bearer credential, never the provider proxy secret', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build(OPENAPI_VERTICAL);
    expect(Object.keys(document.components.securitySchemes)).toEqual(['DataFoundryBearer']);
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        expect(operation.security).toEqual([{ DataFoundryBearer: [] }]);
      }
    }
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('RapidApiProxySecret');
    expect(serialized).not.toContain('X-RapidAPI-Proxy-Secret');
    expect(serialized).not.toContain('marketplace-proxy-secret-for-tests');
    expect(serialized).not.toMatch(/df_(live|test)_[A-Za-z0-9_-]{43}/);
  });

  it('documents canonical redirects only on routes that can emit them', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build(OPENAPI_VERTICAL);

    const getRedirect = document.paths['/v1/entities/{id}']?.['get']?.responses['301'] as
      | { readonly headers?: Readonly<Record<string, unknown>>; readonly content?: unknown }
      | undefined;
    const headRedirect = document.paths['/v1/entities/{id}/facts']?.['head']?.responses['301'] as
      | { readonly headers?: Readonly<Record<string, unknown>>; readonly content?: unknown }
      | undefined;
    expect(getRedirect?.headers?.['Location']).toBeDefined();
    expect(headRedirect?.headers?.['Location']).toEqual(getRedirect?.headers?.['Location']);
    expect(headRedirect).not.toHaveProperty('content');
    expect(document.paths['/v1/search']?.['get']?.responses['301']).toBeUndefined();
  });

  it('projects response components from the runtime wire schemas', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build(OPENAPI_VERTICAL);
    const factPage = document.components.schemas['FactPageResponse'] as {
      readonly properties?: {
        readonly data?: {
          readonly items?: { readonly properties?: Readonly<Record<string, unknown>> };
        };
      };
    };
    const factProperties = factPage.properties?.data?.items?.properties ?? {};
    expect(Object.keys(factProperties)).toEqual(expect.arrayContaining([
      'property',
      'editoriallyCorrected',
      'editorialCorrectionReason',
      'selectionWarnings',
    ]));
  });
});
