/**
 * The OpenAPI contract is another projection of the live route table, not a
 * hand-maintained inventory for a marketplace listing.
 */
import { describe, expect, it } from 'vitest';
import { CORRECTION_FIELDS_JSON_SCHEMA } from '@data-foundry/query-model';
import { READ_METHODS, ROUTES } from '../src/routes.js';

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

async function loadBuilder(): Promise<(() => OpenApiDocument) | null> {
  const module = await import('../src/openapi.js').catch(() => null);
  expect(module, 'apps/api must expose an OpenAPI projection of ROUTES').not.toBeNull();
  if (module === null) return null;
  const build = (module as Record<string, unknown>)['buildOpenApiDocument'];
  expect(typeof build).toBe('function');
  return typeof build === 'function' ? (build as () => OpenApiDocument) : null;
}

describe('the generated OpenAPI document', () => {
  it('comes from every documented ROUTES entry with GET and HEAD, and no duplicate route list', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build();
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
    const document = build();

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
    expect(search?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'filter.{field}', in: 'query', required: false }),
        expect.objectContaining({ name: 'limit', in: 'query', required: false }),
      ]),
    );
  });

  it('documents both trusted origin channels without embedding a secret value', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build();
    expect(Object.keys(document.components.securitySchemes).sort()).toEqual([
      'DataFoundryBearer',
      'RapidApiProxySecret',
    ]);
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        expect(operation.security).toEqual([
          { DataFoundryBearer: [] },
          { RapidApiProxySecret: [] },
        ]);
      }
    }
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain('marketplace-proxy-secret-for-tests');
    expect(serialized).not.toMatch(/df_(live|test)_[A-Za-z0-9_-]{43}/);
  });

  it('documents canonical redirects only on routes that can emit them', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build();

    expect(document.paths['/v1/entities/{id}']?.['get']?.responses['301']).toBeDefined();
    expect(document.paths['/v1/entities/{id}/facts']?.['head']?.responses['301']).toBeDefined();
    expect(document.paths['/v1/search']?.['get']?.responses['301']).toBeUndefined();
  });

  it('reuses the query layer correction schema on the REST fact wire shape', async () => {
    const build = await loadBuilder();
    if (build === null) return;
    const document = build();
    const fact = document.components.schemas['Fact'] as {
      readonly unevaluatedProperties?: boolean;
      readonly allOf?: readonly { readonly properties?: Readonly<Record<string, unknown>> }[];
    };
    const correction = fact.allOf?.find((part) =>
      Object.hasOwn(part.properties ?? {}, 'editoriallyCorrected'),
    );
    expect(fact.unevaluatedProperties).toBe(false);
    expect(correction).toEqual(CORRECTION_FIELDS_JSON_SCHEMA);
  });
});
