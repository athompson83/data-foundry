/**
 * `@data-foundry/api` — the read-only REST surface.
 *
 * AGENTS.md rule 5: "Web/API/MCP must read from the same canonical query
 * layer." This package is an interface, not a business-logic owner. It reads
 * through `@data-foundry/query-model` and nothing beneath it, serializes facts
 * through that package's shared mapper (ADR-0004), and owns no notion of
 * selection, ranking, filtering, redirect following or publishability.
 *
 * There is no composition root here on purpose: a `QueryModel` is injected. See
 * `config.ts` for why, and ADR-0005 for why nothing in this repository is
 * deployed yet.
 */

export {
  API_ERROR_CODES,
  ApiError,
  ERROR_STATUS,
  OPAQUE_INTERNAL_MESSAGE,
  toErrorBody,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorPayload,
  type ErrorDetails,
} from './errors.js';

export {
  JSON_CONTENT_TYPE,
  baseHeaders,
  jsonResponse,
  requestId,
  API_REQUEST_SURFACES,
  type ApiHandler,
  type ApiRequestAccess,
  type ApiRequestSurface,
  type ApiRequest,
  type ApiResponse,
} from './http.js';

export {
  PAGE_BOUNDS,
  pageMeta,
  paginate,
  parsePageRequest,
  type Page,
  type PageMeta,
  type PageRequest,
} from './pagination.js';

export {
  resolveContext,
  type ApiAppOptions,
  type ApiContext,
  type ApiErrorContext,
  type ApiFactSelectionPolicy,
  type ApiRequestTelemetry,
} from './config.js';

export {
  CURRENT_VERSION,
  CONTRACT_ROUTE_KEY,
  ROUTE_KEYS,
  ROUTES,
  SERVICE_ROUTE_KEY,
  SUPPORTED_VERSIONS,
  UNMATCHED_ROUTE_KEY,
  contractDocument,
  matchRoute,
  routeParams,
  type Route,
  type RouteKey,
  type RouteMatch,
} from './routes.js';

export { buildOpenApiDocument, type OpenApiVerticalMetadata } from './openapi.js';

export {
  comparisonWire,
  entityViewWire,
  entityWire,
  facetWire,
  factWire,
  redirectTraceWire,
  relationshipEdgeWire,
  searchHitWire,
  parseWireResponse,
  validateApiErrorEnvelope,
  validateOpaqueEdgeErrorEnvelope,
  wireJsonResponse,
  WIRE_COMPONENT_SCHEMAS,
  type OpenApiResponseSchemaName,
  type WireComponentSchemaName,
  type ApiErrorEnvelope,
  type OpaqueEdgeErrorEnvelope,
  type ComparisonWire,
  type EntityWire,
  type FacetWire,
  type RedirectTraceWire,
  type RelationshipEdgeWire,
  type SearchHitWire,
} from './wire.js';

export { createApiApp } from './app.js';
export { createApiServer, startApiServer, type ListeningApiServer } from './server.js';
