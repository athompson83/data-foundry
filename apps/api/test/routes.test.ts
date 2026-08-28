/**
 * The success contract: what every route answers when nothing is wrong, plus
 * pagination and the failures that are part of ordinary use.
 *
 * These assertions are deliberately about SHAPE and about the properties the
 * repository's rules turn on — not about spelling. Where a value is checked it
 * is checked because getting it wrong would be a rule violation (rule 1's
 * exclusions, rule 7's ordering) or a contract break (page arithmetic).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runtimeSchema as z } from '@data-foundry/query-model';
import {
  EXTRA_PROPERTIES,
  RIGHTS_BLOCKED_PROPERTY,
  call,
  createApiFixtures,
  dataOf,
  errorOf,
  pageOf,
  type ApiFixtures,
} from './support.js';
import { PAGE_BOUNDS } from '../src/pagination.js';
import { buildOpenApiDocument } from '../src/openapi.js';
import { contractDocument } from '../src/routes.js';
import type { EntityWire, RelationshipEdgeWire, SearchHitWire } from '../src/wire.js';
import type { RestFact } from '../../../packages/query-model/src/index.js';

let fixtures: ApiFixtures;

/** seer2_rating, refrigerant, tonnage, plus the extras. forum_rumor is excluded. */
const PUBLISHED_PROPERTY_COUNT = 3 + EXTRA_PROPERTIES.length;

beforeAll(async () => {
  fixtures = await createApiFixtures();
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('service and contract documents', () => {
  it('names the versions it serves at the root', async () => {
    const response = await call(fixtures.app, '/');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ supportedVersions: ['v1'], current: '/v1', readOnly: true });
  });

  it('publishes the contract, including pagination bounds and error codes', async () => {
    const response = await call(fixtures.app, '/v1');
    expect(response.status).toBe(200);
    const body = response.body as {
      pagination: { maxLimit: number; defaultLimit: number; maxOffset: number };
      errorEnvelope: { codes: { code: string; status: number }[] };
      routes: { path: string }[];
    };
    expect(body.pagination.defaultLimit).toBe(PAGE_BOUNDS.defaultLimit);
    expect(body.pagination.maxLimit).toBe(PAGE_BOUNDS.maxLimit);
    expect(body.pagination.maxOffset).toBe(PAGE_BOUNDS.maxOffset);
    expect(body.errorEnvelope.codes).toContainEqual({ code: 'ENTITY_NOT_FOUND', status: 404 });
    expect(body.routes.map((route) => route.path)).toContain('/v1/health');
  });

  it('stamps the served contract version on every response', async () => {
    const response = await call(fixtures.app, '/v1/health');
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

describe('GET /v1/health', () => {
  it('reports ok only after a real round trip through the query layer', async () => {
    const response = await call(fixtures.app, '/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      version: 'v1',
      verticalId: fixtures.vertical.id,
      checks: { queryLayer: 'ok' },
    });
  });
});

describe('GET /v1/entities/{id}', () => {
  it('returns the canonical entity in wire form', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`);
    expect(response.status).toBe(200);
    const data = dataOf<{ entity: EntityWire; redirectedFrom: null }>(response);
    expect(data.entity.id).toBe(fixtures.equipment.id);
    expect(data.entity.canonicalName).toBe('Carrier Infinity 24ANB7');
    expect(data.entity.canonicalSlug).toBe('carrier-infinity-24anb7');
    expect(data.redirectedFrom).toBeNull();
  });

  it('emits camelCase only — no snake_case field leaks through', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`);
    const keys = Object.keys(dataOf<{ entity: EntityWire }>(response).entity);
    expect(keys.filter((key) => key.includes('_'))).toEqual([]);
  });

  it('404s an id that is well-formed but unknown', async () => {
    const response = await call(fixtures.app, '/v1/entities/11111111-1111-4111-8111-111111111111');
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ENTITY_NOT_FOUND');
  });
});

describe('GET /v1/entities/by-slug/{slug}', () => {
  it('resolves a live slug within its entity type', async () => {
    const response = await call(
      fixtures.app,
      '/v1/entities/by-slug/carrier-infinity-24anb7?type=equipment',
    );
    expect(response.status).toBe(200);
    expect(dataOf<{ entity: EntityWire }>(response).entity.id).toBe(fixtures.equipment.id);
  });

  it('requires the entity type, because a slug is only unique within one', async () => {
    const response = await call(fixtures.app, '/v1/entities/by-slug/carrier-infinity-24anb7');
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'MISSING_PARAMETER',
      details: { parameter: 'type' },
    });
  });

  it('404s a slug that does not exist', async () => {
    const response = await call(fixtures.app, '/v1/entities/by-slug/no-such-thing?type=equipment');
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ENTITY_NOT_FOUND');
  });
});

describe('GET /v1/entities/{id}/facts', () => {
  it('serves the canonical view with its selection rule and correction state', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}/facts?limit=100`);
    expect(response.status).toBe(200);
    const facts = dataOf<RestFact[]>(response);
    const seer2 = facts.find((fact) => fact.property === 'seer2_rating');
    expect(seer2).toBeDefined();
    expect(seer2?.value).toBe(16);
    expect(seer2?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(seer2?.sources).toEqual(['Acme Climate']);
    // The three trust fields ADR-0004 exists to keep on every surface.
    expect(seer2).toHaveProperty('editoriallyCorrected', false);
    expect(seer2).toHaveProperty('editorialCorrectionReason', null);
    expect(seer2).toHaveProperty('selectionWarnings');
  });

  it('filters to one property without changing the wire shape', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?property=tonnage`,
    );
    const facts = dataOf<RestFact[]>(response);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.property).toBe('tonnage');
    expect(facts[0]?.unit).toBe('ton');
  });

  it('answers an unmatched property filter with an empty page, not a 404', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?property=nonexistent_property`,
    );
    expect(response.status).toBe(200);
    expect(dataOf<RestFact[]>(response)).toEqual([]);
    expect(pageOf(response).total).toBe(0);
  });

  it('rejects a malformed `at` instead of silently ignoring it', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?at=yesterday`,
    );
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({ code: 'INVALID_PARAMETER', details: { parameter: 'at' } });
  });

  it('answers an `at` before anything was claimed with an empty canonical view', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?at=2020-01-01T00:00:00Z`,
    );
    expect(response.status).toBe(200);
    expect(dataOf<RestFact[]>(response)).toEqual([]);
  });
});

describe('GET /v1/entities/{id}/relationships', () => {
  it('returns evidence-backed edges with their neighbours', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?limit=50`,
    );
    expect(response.status).toBe(200);
    const edges = dataOf<RelationshipEdgeWire[]>(response);
    expect(edges.map((edge) => edge.predicate).sort()).toEqual(['has_part', 'replaced_by']);
    for (const edge of edges) {
      expect(edge.evidenceCount).toBeGreaterThan(0);
      expect(edge.neighbor.id).not.toBe(fixtures.equipment.id);
      expect(edge.depth).toBe(1);
    }
    expect(response.body).toMatchObject({
      traversal: { depth: 1, direction: 'both', boundReached: false },
    });
  });

  it('filters by predicate and direction through the query layer', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?predicate=has_part&direction=out`,
    );
    const edges = dataOf<RelationshipEdgeWire[]>(response);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.predicate).toBe('has_part');
    expect(edges[0]?.direction).toBe('out');
  });

  it('rejects a direction it does not serve', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?direction=sideways`,
    );
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toMatchObject({ parameter: 'direction' });
  });

  it('rejects a traversal depth beyond the query layer’s bound', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?depth=9`,
    );
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toMatchObject({ parameter: 'depth' });
  });
});

describe('GET /v1/search', () => {
  it('lets an exact identifier match lead a text query it loses on rank', async () => {
    // The fixture's whole point: `HK-32EA/001` normalizes to `hk32ea001`, while
    // an unrelated part is literally NAMED "HK32EA001 Motor" and therefore
    // ranks far better textually. Rule 7 says the exact match still wins.
    const response = await call(fixtures.app, '/v1/search?q=hk32ea001&type=part');
    expect(response.status).toBe(200);
    const hits = dataOf<SearchHitWire[]>(response);
    expect(hits[0]?.entity.id).toBe(fixtures.motor.id);
    expect(hits[0]?.exact).toBe(true);
    expect(response.body).toMatchObject({ match: { exactShortCircuit: true } });
    // Observable, not merely asserted: the runner-up outranked the winner on text.
    const rival = hits.find((hit) => hit.entity.id === fixtures.rival.id);
    expect(rival).toBeDefined();
    expect(rival?.textRank).toBeGreaterThan(hits[0]?.textRank ?? 0);
  });

  it('never claims a vector strategy', async () => {
    const response = await call(fixtures.app, '/v1/search?q=carrier');
    expect(response.body).toMatchObject({ strategy: { exactFirst: true, vector: false } });
  });

  it('browses by filter with no text query at all', async () => {
    const response = await call(fixtures.app, '/v1/search?type=equipment&filter.refrigerant=R-454B');
    expect(response.status).toBe(200);
    const hits = dataOf<SearchHitWire[]>(response);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.entity.entityType).toBe('equipment');
  });

  it('returns facet counts derived from the vertical’s field metadata', async () => {
    const response = await call(fixtures.app, '/v1/search?type=equipment&facets=true');
    const facets = (response.body as { facets: { property: string }[] }).facets;
    expect(facets.map((facet) => facet.property)).toContain('refrigerant');
    // `internal_note` declares filter.type "none" and is not indexable.
    expect(facets.map((facet) => facet.property)).not.toContain('internal_note');
  });

  it('scopes results to the deployment’s vertical', async () => {
    const response = await call(fixtures.app, '/v1/search?q=carrier&limit=100');
    for (const hit of dataOf<SearchHitWire[]>(response)) {
      expect(hit.entity.verticalId).toBe(fixtures.vertical.id);
    }
  });
});

describe('GET /v1/compare', () => {
  it('aligns two entities on declared field order', async () => {
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
    );
    expect(response.status).toBe(200);
    const data = dataOf<{
      entities: EntityWire[];
      rows: { property: string; differs: boolean; cells: { value: unknown }[] }[];
      propertiesCompared: number;
    }>(response);
    expect(data.entities.map((entity) => entity.id)).toEqual([
      fixtures.equipment.id,
      fixtures.heatPump.id,
    ]);
    const seer2 = data.rows.find((row) => row.property === 'seer2_rating');
    expect(seer2?.cells.map((cell) => cell.value)).toEqual([16, 18]);
    expect(seer2?.differs).toBe(true);
    const refrigerant = data.rows.find((row) => row.property === 'refrigerant');
    expect(refrigerant?.differs).toBe(false);
  });

  it('orders the leading rows by the vertical’s declaration order, not the database’s', async () => {
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
    );
    const rows = dataOf<{ rows: { property: string }[] }>(response).rows;
    expect(rows.slice(0, 3).map((row) => row.property)).toEqual([
      'seer2_rating',
      'refrigerant',
      'tonnage',
    ]);
  });

  it('restricts the table to requested properties', async () => {
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}&properties=tonnage`,
    );
    const rows = dataOf<{ rows: { property: string }[] }>(response).rows;
    expect(rows.map((row) => row.property)).toEqual(['tonnage']);
  });

  it('needs at least two ids', async () => {
    const response = await call(fixtures.app, `/v1/compare?ids=${fixtures.equipment.id}`);
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toMatchObject({ parameter: 'ids' });
  });

  it('404s rather than silently comparing against an entity that is not there', async () => {
    const missing = '22222222-2222-4222-8222-222222222222';
    const response = await call(
      fixtures.app,
      `/v1/compare?ids=${fixtures.equipment.id},${missing}`,
    );
    expect(response.status).toBe(404);
    expect(errorOf(response)).toMatchObject({
      code: 'ENTITY_NOT_FOUND',
      details: { unknownIds: [missing] },
    });
  });
});

describe('pagination', () => {
  const factsUrl = (query: string): string =>
    `/v1/entities/${fixtures.equipment.id}/facts?${query}`;

  it('defaults to the documented page size', async () => {
    const response = await call(fixtures.app, factsUrl(''));
    expect(pageOf(response).limit).toBe(PAGE_BOUNDS.defaultLimit);
    expect(pageOf(response).offset).toBe(0);
  });

  it('reports the whole result set, not the page, in `total`', async () => {
    const response = await call(fixtures.app, factsUrl('limit=5'));
    expect(dataOf<RestFact[]>(response)).toHaveLength(5);
    expect(pageOf(response)).toMatchObject({
      limit: 5,
      offset: 0,
      total: PUBLISHED_PROPERTY_COUNT,
      hasMore: true,
    });
  });

  it('walks to the last page and says so', async () => {
    const response = await call(fixtures.app, factsUrl(`limit=5&offset=10`));
    expect(dataOf<RestFact[]>(response)).toHaveLength(PUBLISHED_PROPERTY_COUNT - 10);
    expect(pageOf(response).hasMore).toBe(false);
  });

  it('pages without overlap or gaps', async () => {
    const first = dataOf<RestFact[]>(await call(fixtures.app, factsUrl('limit=4&offset=0')));
    const second = dataOf<RestFact[]>(await call(fixtures.app, factsUrl('limit=4&offset=4')));
    const third = dataOf<RestFact[]>(await call(fixtures.app, factsUrl('limit=4&offset=8')));
    const walked = [...first, ...second, ...third].map((fact) => fact.property);
    const whole = dataOf<RestFact[]>(await call(fixtures.app, factsUrl('limit=100'))).map(
      (fact) => fact.property,
    );
    expect(walked).toEqual(whole);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it('answers past the end with an empty page, never a 404', async () => {
    const response = await call(fixtures.app, factsUrl('offset=9999'));
    expect(response.status).toBe(200);
    expect(dataOf<RestFact[]>(response)).toEqual([]);
    expect(pageOf(response)).toMatchObject({ total: PUBLISHED_PROPERTY_COUNT, hasMore: false });
  });

  it('rejects an over-large limit rather than clamping it into a lie', async () => {
    const response = await call(fixtures.app, factsUrl(`limit=${PAGE_BOUNDS.maxLimit + 1}`));
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'INVALID_PARAMETER',
      details: { parameter: 'limit', received: String(PAGE_BOUNDS.maxLimit + 1) },
    });
  });

  it('rejects limit=0, a negative offset and a fractional limit', async () => {
    for (const query of ['limit=0', 'offset=-1', 'limit=2.5', 'limit=abc', 'limit=1e2x']) {
      const response = await call(fixtures.app, factsUrl(query));
      expect(response.status, query).toBe(400);
      expect(errorOf(response).code, query).toBe('INVALID_PARAMETER');
    }
  });

  it('rejects paging past the query layer’s own offset ceiling', async () => {
    const response = await call(fixtures.app, factsUrl(`offset=${PAGE_BOUNDS.maxOffset + 1}`));
    expect(response.status).toBe(400);
    expect(errorOf(response).details).toMatchObject({ parameter: 'offset' });
  });

  it('applies the same bounds to search and relationships', async () => {
    for (const url of [
      '/v1/search?q=carrier&limit=500',
      `/v1/entities/${fixtures.equipment.id}/relationships?limit=500`,
    ]) {
      const response = await call(fixtures.app, url);
      expect(response.status, url).toBe(400);
      expect(errorOf(response).details, url).toMatchObject({ parameter: 'limit' });
    }
  });

  it('reports search totals from the query layer, not from the page length', async () => {
    const response = await call(fixtures.app, '/v1/search?type=part&limit=1');
    expect(dataOf<SearchHitWire[]>(response)).toHaveLength(1);
    expect(pageOf(response).total).toBeGreaterThan(1);
    expect(pageOf(response).hasMore).toBe(true);
  });
});

describe('the rights gate (AGENTS.md rule 1)', () => {
  it('does not publish a fact whose only source is UNREVIEWED', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}/facts?limit=100`);
    const facts = dataOf<RestFact[]>(response);
    expect(facts.map((fact) => fact.property)).not.toContain(RIGHTS_BLOCKED_PROPERTY);
    expect(pageOf(response).total).toBe(PUBLISHED_PROPERTY_COUNT);
  });

  it('does not leak the blocked value or publisher anywhere in the payload', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}/facts?limit=100`);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('HVAC Forum');
    expect(raw).not.toContain('forum.example');
    expect(raw).not.toContain(RIGHTS_BLOCKED_PROPERTY);
  });

  it('cannot be switched off from a query string', async () => {
    // `requirePublishableRights: false` is a real policy field. If a request
    // could reach it, rule 1 would be one query parameter deep.
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?limit=100&requirePublishableRights=false`,
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(RIGHTS_BLOCKED_PROPERTY);
  });

  it('is the choice of query-layer method: the unfiltered read does return it', async () => {
    // Proof rather than assertion. `QueryModel.facts` is the audit read and
    // applies no rights gate; serving it from /facts would have published the
    // blocked claim. The handler uses `canonicalFacts` precisely for this.
    const unfiltered = await fixtures.qm.facts({ entity_id: fixtures.equipment.id });
    expect(unfiltered.map((row) => row.fact.property)).toContain(RIGHTS_BLOCKED_PROPERTY);
  });
});

describe('every route the contract advertises for HEAD actually answers HEAD', () => {
  /**
   * The document now says each route serves GET and HEAD. That sentence was
   * wrong once already in the other direction — the table said GET alone while
   * the dispatcher answered both — so it is checked against the dispatcher
   * rather than trusted. The same lesson as the traversal caveat: a published
   * claim asserted only against itself is not a claim about the system.
   */
  const paths = (contractDocument('v1') as { routes: { path: string }[] }).routes.map(
    (route) => route.path,
  );

  it('has routes to check, so this cannot pass vacuously', () => {
    expect(paths.length).toBeGreaterThan(5);
  });

  it('answers HEAD wherever it answers GET, with the same status and the same answer', async () => {
    // The app layer returns HEAD's body; the socket adapter is what withholds
    // it, because content-length on a HEAD must equal what GET would have sent
    // and the only way to know that is to render it. So the property here is
    // that HEAD is ROUTED and decided identically — `server.test`'s
    // "answers HEAD with GET's headers and no body" covers the suppression.
    for (const template of paths) {
      const path = template
        .replace('{id}', fixtures.equipment.id)
        .replace('{slug}', fixtures.equipment.canonical_slug)
        .split('?')[0] as string;
      const get = await call(fixtures.app, path);
      const head = await call(fixtures.app, path, { method: 'HEAD' });
      expect(head.status, `${path} HEAD status`).toBe(get.status);
      expect(head.status, `${path} must not be refused`).not.toBe(405);
      expect(head.body, `${path} HEAD answer`).toEqual(get.body);
    }
  });
});

describe('runtime and generated response contracts', () => {
  it('validates representative actual handler responses through both projections', async () => {
    const wireModule = await import('../src/wire.js') as Record<string, unknown>;
    const parseWireResponse = wireModule['parseWireResponse'];
    expect(
      typeof parseWireResponse,
      'REST handlers need the runtime response validator that also generates OpenAPI schemas',
    ).toBe('function');
    if (typeof parseWireResponse !== 'function') return;

    const document = buildOpenApiDocument({
      slug: 'fixture',
      fields: fixtures.qm.fields.all(),
    }) as {
      readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
    };
    const cases = [
      ['HealthResponse', '/v1/health'],
      ['EntityResponse', `/v1/entities/${fixtures.equipment.id}`],
      ['FactPageResponse', `/v1/entities/${fixtures.equipment.id}/facts?limit=100`],
      [
        'RelationshipPageResponse',
        `/v1/entities/${fixtures.equipment.id}/relationships?limit=100`,
      ],
      ['SearchResponse', '/v1/search?type=equipment&facets=true'],
      [
        'CompareResponse',
        `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
      ],
    ] as const;

    for (const [schemaName, url] of cases) {
      const response = await call(fixtures.app, url);
      expect(response.status, url).toBe(200);
      expect(
        (parseWireResponse as (name: string, value: unknown) => unknown)(schemaName, response.body),
        `${url} runtime schema`,
      ).toEqual(response.body);

      const jsonSchema = document.components.schemas[schemaName];
      expect(jsonSchema, `${schemaName} OpenAPI component`).toBeDefined();
      const validator = z.fromJSONSchema(
        jsonSchema as Parameters<typeof z.fromJSONSchema>[0],
      );
      expect(validator.safeParse(response.body).success, `${url} generated JSON Schema`).toBe(true);
    }

    const errorResponse = await call(fixtures.app, '/v1/not-a-route');
    expect(errorResponse.status).toBe(404);
    expect(
      (parseWireResponse as (name: string, value: unknown) => unknown)(
        'ApiErrorEnvelope',
        errorResponse.body,
      ),
    ).toEqual(errorResponse.body);
    const errorValidator = z.fromJSONSchema(
      document.components.schemas['ApiErrorEnvelope'] as Parameters<typeof z.fromJSONSchema>[0],
    );
    expect(errorValidator.safeParse(errorResponse.body).success).toBe(true);
  });
});
