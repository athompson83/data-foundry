/**
 * The route table and its handlers.
 *
 * Every handler is the same three steps: validate the request into the query
 * layer's own vocabulary, make ONE call (or a small composition of calls) into
 * `QueryModel`, project the answer through `wire.ts`. No handler filters,
 * ranks, resolves, follows a redirect or decides what is publishable — all of
 * that already happened below, once, and re-deciding it here is how the API and
 * the web page start disagreeing (AGENTS.md rule 5).
 *
 * Two consequences worth stating because they are easy to get wrong:
 *
 *   * **Facts are read through `canonicalFacts`, never `facts`.**
 *     `QueryModel.facts` (`listFactsWithEvidence`) returns stored fact versions
 *     with their evidence attached and applies NO rights gate — it is the
 *     provenance/audit read. `canonicalFacts` runs the doc-04 selection
 *     cascade, whose eligibility pre-filter drops any claim "backed only by
 *     RED/UNREVIEWED sources" (AGENTS.md rule 1). Serving the former would
 *     publish exactly what rule 1 forbids, from a method whose name looks
 *     right. A property that survives the cascade with nothing selected is not
 *     served either: no selected value is not a published fact.
 *
 *   * **Exact-identifier-beats-text-search is not implemented here.** Rule 7
 *     lives in `searchEntities`, which evaluates an equality tier ahead of any
 *     ranking. This surface passes the query through and reports
 *     `match.exactShortCircuit` so the behaviour stays observable. Re-sorting
 *     the hits here — for any reason — would undo it.
 */
import {
  ApiError,
  API_ERROR_CODES,
  ERROR_STATUS,
  type ApiErrorCode,
} from './errors.js';
import { jsonResponse, type ApiResponse } from './http.js';
import {
  PAGE_BOUNDS,
  pageMeta,
  paginate,
  parsePageRequest,
} from './pagination.js';
import {
  optionalIdentifier,
  optionalInstant,
  parseBoolean,
  parseBoundedInt,
  parseEntityId,
  parseEnum,
  parseFilters,
  parseIdentifier,
  parseList,
  parseSlug,
  requiredIdentifier,
} from './params.js';
import type { ApiContext } from './config.js';
import {
  comparisonWire,
  entityViewWire,
  facetWire,
  factWire,
  redirectTraceWire,
  relationshipEdgeWire,
  searchHitWire,
} from './wire.js';
import type { EntityId, Identifier } from '@data-foundry/canonical-schema';
import type { EntityView, FacetFilter } from '@data-foundry/query-model';

/**
 * The contract versions this deployment serves.
 *
 * The `/vN` path segment is the ONLY version selector. There is no `Accept`
 * header negotiation and no default-to-latest: a request that does not name a
 * version in its path is not a versioned request, and silently serving it the
 * newest contract is how a client breaks on a deploy it did not trigger.
 */
export const SUPPORTED_VERSIONS = ['v1'] as const;
export const CURRENT_VERSION = 'v1';

/**
 * The only methods this surface serves. An ALLOW-LIST, and the single one.
 *
 * `app.ts` refuses anything outside this list before it looks at a path, the
 * `Allow` header on the refusal is derived from it, and `contractDocument`
 * publishes it — so what is enforced, what is advertised and what the header
 * names are one fact with one spelling. They were three, and the document was
 * the only one of them that was true for every path.
 *
 * An allow-list rather than a list of methods known to write: the failure mode
 * of a deny-list is the method it was never told about, and there is no
 * shortage of those.
 */
export const READ_METHODS = ['GET', 'HEAD'] as const;
export const ALLOW_HEADER = READ_METHODS.join(', ');

/** The query layer's own traversal ceiling; asking for more is clamped there. */
const TRAVERSAL_BOUND = 500;
const MAX_COMPARE_ENTITIES = 8;
const MIN_COMPARE_ENTITIES = 2;
/**
 * A well-formed id that no fixture or production row can hold, used to prove
 * the query layer answers at all. `getEntity` on it is a redirect probe plus a
 * primary-key miss: two round trips, no scan.
 */
const HEALTH_PROBE_ID = '00000000-0000-4000-8000-000000000000';

export interface RouteMatch {
  readonly params: ReadonlyMap<string, string>;
  readonly query: URLSearchParams;
}

export interface Route {
  /** Path after the version segment, `:name` marking a parameter. */
  readonly pattern: readonly string[];
  /** Full documented path, version included. */
  readonly path: string;
  readonly summary: string;
  /** A limitation a client must know about. Published in the contract document. */
  readonly caveat?: string;
  readonly handler: (context: ApiContext, match: RouteMatch) => Promise<ApiResponse>;
}

function param(match: RouteMatch, name: string): string {
  const value = match.params.get(name);
  // Unreachable while the pattern and the handler agree; an ApiError rather
  // than a bare throw so a future mismatch is still a clean envelope.
  if (value === undefined) throw new ApiError('INTERNAL_ERROR', 'route parameter missing');
  return value;
}

/**
 * 301 rather than 200-with-a-note.
 *
 * `entities.ts` states the intent: a consumer that saved an id before a merge
 * "is told that it was redirected, so the web layer can answer 301 instead of
 * silently serving different content at the old address." The same reasoning
 * holds for an API: an id that now means a different entity must not keep
 * answering as though nothing happened. The body carries the full hop chain so
 * a client that does not follow redirects can still explain itself.
 */
function redirectResponse(
  context: ApiContext,
  view: EntityView,
  location: string,
): ApiResponse {
  const trace = view.redirected_from;
  if (trace === null) throw new ApiError('INTERNAL_ERROR', 'redirect without a trace');
  return jsonResponse(
    301,
    {
      redirect: {
        status: 301,
        location,
        canonicalEntityId: view.entity.id,
        redirectedFrom: redirectTraceWire(trace),
      },
    },
    context.version,
    { location },
  );
}

/** Fetch, 404 or hand back a redirect response. Every entity route starts here. */
async function resolveEntity(
  context: ApiContext,
  rawId: string,
  suffix: string,
): Promise<{ readonly view: EntityView } | { readonly redirect: ApiResponse }> {
  const id = parseEntityId(rawId);
  const view = await context.queryModel.getEntity(id);
  if (view === null) throw ApiError.entityNotFound({ entityId: id });
  if (view.redirected_from !== null) {
    return {
      redirect: redirectResponse(context, view, `/${context.version}/entities/${view.entity.id}${suffix}`),
    };
  }
  return { view };
}

/** The doc-04 policy for this request: the deployment's, plus an optional `at`. */
function requestPolicy(context: ApiContext, query: URLSearchParams): ApiContext['factSelection'] {
  const at = optionalInstant(query);
  return at === undefined ? context.factSelection : { ...context.factSelection, at };
}

const health: Route['handler'] = async (context) => {
  try {
    // Liveness that actually touches the dependency. A health check that only
    // proves the process is running reports "ok" through a database outage.
    await context.queryModel.getEntity(parseEntityId(HEALTH_PROBE_ID));
  } catch {
    throw new ApiError('SERVICE_UNAVAILABLE', 'The canonical query layer is not reachable.');
  }
  return jsonResponse(
    200,
    {
      status: 'ok',
      version: context.version,
      verticalId: context.verticalId,
      declaredFields: context.queryModel.fields.size,
      checks: { queryLayer: 'ok' },
    },
    context.version,
  );
};

const getEntity: Route['handler'] = async (context, match) => {
  const resolved = await resolveEntity(context, param(match, 'id'), '');
  if ('redirect' in resolved) return resolved.redirect;
  return jsonResponse(200, { data: entityViewWire(resolved.view) }, context.version);
};

const getEntityBySlug: Route['handler'] = async (context, match) => {
  const slug = parseSlug(param(match, 'slug'));
  const entityType = requiredIdentifier(
    match.query,
    'type',
    'a slug is only unique within one entity type',
  );
  const view = await context.queryModel.getEntityBySlug(context.verticalId, entityType, slug);
  if (view === null) throw ApiError.entityNotFound({ slug, entityType });
  if (view.redirected_from !== null) {
    return redirectResponse(context, view, `/${context.version}/entities/${view.entity.id}`);
  }
  return jsonResponse(200, { data: entityViewWire(view) }, context.version);
};

const listFacts: Route['handler'] = async (context, match) => {
  const resolved = await resolveEntity(context, param(match, 'id'), '/facts');
  if ('redirect' in resolved) return resolved.redirect;

  const property = optionalIdentifier(match.query, 'property');
  const views = await context.queryModel.canonicalFacts(
    resolved.view.entity.id,
    requestPolicy(context, match.query),
  );

  const published = views.filter(
    (view) => view.fact_id !== null && (property === undefined || view.property === property),
  );
  // Serialized in full BEFORE paging: a reviewer-identity leak on page 3 must
  // fail the request, not wait for someone to page that far.
  const facts = published.map((view) => factWire(view, context.reviewers));
  const page = paginate(facts, parsePageRequest(match.query));

  return jsonResponse(
    200,
    { entityId: resolved.view.entity.id, ...page },
    context.version,
  );
};

const listRelationships: Route['handler'] = async (context, match) => {
  const resolved = await resolveEntity(context, param(match, 'id'), '/relationships');
  if ('redirect' in resolved) return resolved.redirect;

  const direction = parseEnum(match.query, 'direction', ['out', 'in', 'both'] as const, 'both');
  const depth = parseBoundedInt(match.query, 'depth', 1, 1, 4);
  const predicate = optionalIdentifier(match.query, 'predicate');

  const traversal = await context.queryModel.relationships({
    entity_id: resolved.view.entity.id,
    direction,
    depth,
    limit: TRAVERSAL_BOUND,
    ...(predicate === undefined ? {} : { predicate }),
  });

  const page = paginate(traversal.edges.map(relationshipEdgeWire), parsePageRequest(match.query));
  return jsonResponse(
    200,
    {
      entityId: resolved.view.entity.id,
      traversal: {
        depth: traversal.depth,
        direction,
        edgeBound: TRAVERSAL_BOUND,
        /** True when the traversal stopped at its bound, so more edges exist. */
        boundReached: traversal.truncated,
        /**
         * Edges the walk reached and would not serve: no evidence, or evidence
         * only from sources that may not publish. Reported so an empty result
         * reads as "nothing publishable here" rather than "nothing here" — a
         * count only, never which edge or whose source.
         */
        withheldEdgeCount: traversal.withheld_edge_count,
      },
      ...page,
    },
    context.version,
  );
};

const search: Route['handler'] = async (context, match) => {
  const text = (match.query.get('q') ?? '').trim();
  const entityType = optionalIdentifier(match.query, 'type');
  const filters: FacetFilter[] = parseFilters(match.query);
  const includeFacets = parseBoolean(match.query, 'facets', false);
  const request = parsePageRequest(match.query);

  const result = await context.queryModel.search({
    vertical_id: context.verticalId,
    ...(text === '' ? {} : { text }),
    ...(entityType === undefined ? {} : { entity_type: entityType }),
    ...(filters.length === 0 ? {} : { filters }),
    limit: request.limit,
    offset: request.offset,
    include_facets: includeFacets,
  });

  return jsonResponse(
    200,
    {
      data: result.hits.map(searchHitWire),
      page: pageMeta(request, result.hits.length, result.total),
      match: {
        // Rule 7, observable: true means a deterministic identifier match led
        // the result set ahead of everything text ranking preferred.
        exactShortCircuit: result.exact_short_circuit,
        exactCount: result.exact_count,
      },
      strategy: {
        exactFirst: result.strategy.exact_first,
        fullText: result.strategy.full_text,
        trigram: result.strategy.trigram,
        vector: result.strategy.vector,
      },
      facets: result.facets.map(facetWire),
    },
    context.version,
  );
};

const compare: Route['handler'] = async (context, match) => {
  const raw = parseList(match.query, 'ids');
  if (raw.length < MIN_COMPARE_ENTITIES || raw.length > MAX_COMPARE_ENTITIES) {
    throw ApiError.invalidParameter(
      'ids',
      `expected between ${MIN_COMPARE_ENTITIES} and ${MAX_COMPARE_ENTITIES} comma-separated entity ids`,
      String(raw.length),
    );
  }
  const properties = parseList(match.query, 'properties').map((value) =>
    parseIdentifier(value, 'properties'),
  );

  // Resolved one by one through the redirect-aware read rather than handed
  // straight to `compare`, which looks ids up directly and would silently drop
  // a merged-away entity from the table.
  const unknown: string[] = [];
  const redirects: { requestedId: string; canonicalEntityId: string }[] = [];
  const canonical: EntityId[] = [];
  for (const value of raw) {
    const id = parseEntityId(value, 'ids');
    const view = await context.queryModel.getEntity(id);
    if (view === null) {
      unknown.push(id);
      continue;
    }
    if (view.redirected_from !== null) {
      redirects.push({ requestedId: id, canonicalEntityId: view.entity.id });
    }
    if (!canonical.includes(view.entity.id)) canonical.push(view.entity.id);
  }
  if (unknown.length > 0) throw ApiError.entityNotFound({ unknownIds: unknown });
  if (canonical.length < MIN_COMPARE_ENTITIES) {
    throw ApiError.invalidParameter(
      'ids',
      'expected at least two distinct entities after following redirects',
      String(canonical.length),
    );
  }

  const comparison = await context.queryModel.compare({
    entity_ids: canonical,
    ...(properties.length === 0 ? {} : { properties: properties as readonly Identifier[] }),
    policy: requestPolicy(context, match.query),
  });

  return jsonResponse(
    200,
    { data: comparisonWire(comparison), redirects },
    context.version,
  );
};

export const ROUTES: readonly Route[] = [
  {
    pattern: ['health'],
    path: '/v1/health',
    summary: 'Liveness plus a real round trip through the canonical query layer.',
    handler: health,
  },
  {
    pattern: ['entities', 'by-slug'],
    path: '/v1/entities/by-slug/{slug}',
    summary: 'Reject a slug lookup with no slug, rather than reading "by-slug" as an id.',
    handler: async () => {
      throw ApiError.missingParameter('slug', 'the slug to look up follows /entities/by-slug/');
    },
  },
  {
    pattern: ['entities', 'by-slug', ':slug'],
    path: '/v1/entities/by-slug/{slug}?type={entityType}',
    summary:
      'Entity by canonical slug. Honours retired slugs: a slug a merge took away answers 301 to the surviving entity.',
    handler: getEntityBySlug,
  },
  {
    pattern: ['entities', ':id'],
    path: '/v1/entities/{id}',
    summary: 'Entity by id. A merged-away id answers 301 with its redirect chain, never 404.',
    handler: getEntity,
  },
  {
    pattern: ['entities', ':id', 'facts'],
    path: '/v1/entities/{id}/facts?property=&at=&limit=&offset=',
    summary:
      'The canonical view: one selected value per property, with the doc-04 rule that chose it and its correction state.',
    caveat:
      'Only properties with a published value appear. A property whose every claim is retracted, unevidenced or backed only by RED/UNREVIEWED sources is omitted entirely.',
    handler: listFacts,
  },
  {
    pattern: ['entities', ':id', 'relationships'],
    path: '/v1/entities/{id}/relationships?predicate=&direction=&depth=&limit=&offset=',
    summary: 'Bounded graph traversal from this entity, breadth-first and cycle-guarded.',
    caveat:
      'Rule 1 applies here as it does to facts: an edge whose every piece of evidence comes from a source that may not publish is withheld, and so is any neighbour reachable only through one. Edge counts are therefore a view of the publishable graph, not of everything recorded.',
    handler: listRelationships,
  },
  {
    pattern: ['search'],
    path: '/v1/search?q=&type=&filter.{field}=&facets=&limit=&offset=',
    summary:
      'Faceted search. Exact identifier matches lead the result set ahead of any text ranking (AGENTS.md rule 7).',
    handler: search,
  },
  {
    pattern: ['compare'],
    path: '/v1/compare?ids=a,b&properties=&at=',
    summary: 'Side-by-side canonical values for 2–8 entities, aligned on declared field order.',
    caveat:
      'Comparison cells carry the selecting rule and conflict state but not correction state; read /v1/entities/{id}/facts for the full trust surface.',
    handler: compare,
  },
];

export function matchRoute(segments: readonly string[]): Route | null {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const ok = route.pattern.every(
      (piece, index) => piece.startsWith(':') || piece === segments[index],
    );
    if (ok) return route;
  }
  return null;
}

export function routeParams(route: Route, segments: readonly string[]): ReadonlyMap<string, string> {
  const params = new Map<string, string>();
  route.pattern.forEach((piece, index) => {
    if (piece.startsWith(':')) params.set(piece.slice(1), segments[index] ?? '');
  });
  return params;
}

/**
 * The contract, served as data.
 *
 * A README describing pagination bounds drifts from the code that enforces
 * them; this document is generated from the same constants the handlers use, and
 * `test/boundary.test.ts` asserts every route it advertises actually routes, and
 * every route that exists is advertised.
 */
export function contractDocument(version: string): unknown {
  return {
    version,
    supportedVersions: [...SUPPORTED_VERSIONS],
    readOnly: true,
    methods: [...READ_METHODS],
    // Stated next to the methods it constrains, and generated from the same
    // constant the guard reads, so "read-only" is a checkable claim rather than
    // an adjective: every other method, on every path this deployment answers
    // at all, is this refusal.
    otherMethods: { status: 405, code: 'METHOD_NOT_ALLOWED', allow: ALLOW_HEADER },
    versioning: {
      selector: 'path',
      note: 'The /vN path segment is the only version selector; the Accept header is not used.',
      unknownVersion: { status: 404, code: 'UNSUPPORTED_API_VERSION' },
    },
    pagination: {
      parameters: ['limit', 'offset'],
      defaultLimit: PAGE_BOUNDS.defaultLimit,
      minLimit: PAGE_BOUNDS.minLimit,
      maxLimit: PAGE_BOUNDS.maxLimit,
      maxOffset: PAGE_BOUNDS.maxOffset,
      outOfRange: 'Rejected with 400 INVALID_PARAMETER. Values are never silently clamped.',
      pastEnd: '200 with an empty data array and hasMore false. Never 404.',
    },
    errorEnvelope: {
      shape: { error: { code: 'string', status: 'number', message: 'string', details: 'object?' } },
      codes: API_ERROR_CODES.map((code: ApiErrorCode) => ({ code, status: ERROR_STATUS[code] })),
    },
    routes: ROUTES.filter((route) => route.pattern.at(-1) !== 'by-slug').map((route) => ({
      method: 'GET',
      path: route.path,
      summary: route.summary,
      ...(route.caveat === undefined ? {} : { caveat: route.caveat }),
    })),
  };
}
