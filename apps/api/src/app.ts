/**
 * Dispatch: URL in, `ApiResponse` out, no socket involved.
 *
 * The error funnel is the point of this file. Every path out — a bad id, an
 * unknown version, a filter the vertical does not declare, a database that went
 * away, a bug — leaves through `toErrorBody`, so there is exactly one response
 * shape for failure and exactly one place that decides what a customer is told.
 * Handlers throw; they never format an error.
 */
import { ApiError, OPAQUE_INTERNAL_MESSAGE, toErrorBody } from './errors.js';
import { baseHeaders, jsonResponse, requestId, type ApiHandler, type ApiRequest, type ApiResponse } from './http.js';
import { resolveContext, type ApiAppOptions, type ApiContext, type ApiRequestTelemetry } from './config.js';
import {
  ALLOW_HEADER,
  CURRENT_VERSION,
  METHOD_NOT_ALLOWED_ROUTE_TEMPLATE,
  READ_METHODS,
  ROOT_ROUTE_TEMPLATE,
  SUPPORTED_VERSIONS,
  UNMATCHED_ROUTE_TEMPLATE,
  UNSUPPORTED_VERSION_ROUTE_TEMPLATE,
  contractDocument,
  contractRouteTemplate,
  matchRoute,
  routeParams,
  routeTemplate,
} from './routes.js';
import {
  ReviewerIdentityLeak,
  UnknownFieldError,
} from '@data-foundry/query-model';

/** The published allow-list, in the form the guard needs. No second list. */
const SERVED_METHODS: ReadonlySet<string> = new Set<string>(READ_METHODS);

/**
 * Parsing only — the base is a placeholder so `URL` accepts a request target.
 * Nothing is fetched, resolved or contacted.
 */
const PARSE_BASE = 'http://api.invalid';

function isSupportedVersion(value: string): boolean {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(value);
}

/**
 * Anything a handler or the query layer threw, rendered as a decided failure.
 *
 * `UnknownFieldError` is the one non-`ApiError` that becomes a 4xx: it is the
 * query layer refusing a filter the *client* asked for, and its `field` is the
 * client's own input, so echoing it discloses nothing. Everything else — a
 * `ReviewerIdentityLeak` included — collapses to an opaque 500. A leak guard
 * that reported what it caught would be a leak.
 */
function normalize(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof UnknownFieldError) {
    return new ApiError(
      'UNPROCESSABLE_QUERY',
      `Field "${error.field}" cannot be used as a filter or facet in this vertical.`,
      { field: error.field },
    );
  }
  if (error instanceof ReviewerIdentityLeak) {
    return new ApiError('INTERNAL_ERROR', 'The server refused to serialize this response.');
  }
  return new ApiError('INTERNAL_ERROR', OPAQUE_INTERNAL_MESSAGE);
}

async function dispatch(
  context: ApiContext,
  request: ApiRequest,
  report: (template: string) => void,
): Promise<ApiResponse> {
  // FIRST — before the target is parsed, before a version is recognised, before
  // a route is matched. The check used to sit next to the route table, which
  // made it a property of *routed* requests: `POST /` was answered by the
  // service document and `PUT /v1` by the contract document, both 200, because
  // both return before routing happens. That is a read-only guarantee a client
  // can walk around by choosing a shorter path.
  //
  // Placing it at the top makes the guarantee a property of the surface rather
  // than of each answer inside it, and the placement is what enforces it: a
  // route added tomorrow, or another early return like the two above, cannot
  // reintroduce the hole because there is nothing before this line to return
  // from. It is an allow-list, so an unknown method fails closed.
  if (!SERVED_METHODS.has(request.method.toUpperCase())) {
    report(METHOD_NOT_ALLOWED_ROUTE_TEMPLATE);
    throw new ApiError(
      'METHOD_NOT_ALLOWED',
      'This API is read-only; only GET and HEAD are supported.',
      { allow: ALLOW_HEADER },
    );
  }

  let url: URL;
  try {
    url = new URL(request.url, PARSE_BASE);
  } catch {
    // A request target the URL parser rejects is the client's mistake, not a
    // server fault; it must not fall through to the generic 500.
    report(UNMATCHED_ROUTE_TEMPLATE);
    throw ApiError.invalidParameter('url', 'expected a well-formed request target');
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
    report(ROOT_ROUTE_TEMPLATE);
    return jsonResponse(
      200,
      {
        service: 'data-foundry-api',
        readOnly: true,
        supportedVersions: [...SUPPORTED_VERSIONS],
        current: `/${CURRENT_VERSION}`,
      },
      context.version,
    );
  }

  const [version, ...rest] = segments;
  if (version === undefined || !isSupportedVersion(version)) {
    report(UNSUPPORTED_VERSION_ROUTE_TEMPLATE);
    throw new ApiError(
      'UNSUPPORTED_API_VERSION',
      'This deployment does not serve that API version.',
      { requested: version?.slice(0, 32) ?? '', supported: [...SUPPORTED_VERSIONS] },
    );
  }

  if (rest.length === 0) {
    report(contractRouteTemplate(version));
    return jsonResponse(200, contractDocument(version), version);
  }

  const route = matchRoute(rest);
  if (route === null) {
    report(UNMATCHED_ROUTE_TEMPLATE);
    throw new ApiError('ROUTE_NOT_FOUND', 'No route matches this path.', {
      path: url.pathname.slice(0, 200),
    });
  }

  report(routeTemplate(version, route));
  return route.handler(context, {
    params: routeParams(route, rest),
    query: url.searchParams,
  });
}

export function createApiApp(options: ApiAppOptions): ApiHandler {
  const context = resolveContext(options, CURRENT_VERSION);

  return async (
    request: ApiRequest,
    onRequest?: (info: ApiRequestTelemetry) => void,
  ): Promise<ApiResponse> => {
    const id = requestId(request);
    // `dispatch` reports its template through this callback rather than a
    // return value, because it also has to be known on the throw path — a
    // 404 or a 405 is exactly the kind of request usage-based billing must
    // still see. Defaults to "unmatched": if `dispatch` throws before its
    // first `report` call, that default is precisely what happened — nothing
    // matched yet.
    let matchedTemplate: string = UNMATCHED_ROUTE_TEMPLATE;
    const report = (template: string): void => {
      matchedTemplate = template;
    };
    try {
      const response = await dispatch(context, request, report);
      onRequest?.({ method: request.method, routeTemplate: matchedTemplate, status: response.status });
      return response;
    } catch (error) {
      const failure = normalize(error);
      // Operators get the cause; customers get the code. This is the only
      // place the original throwable is handed anywhere.
      if (failure.status >= 500) {
        let path = request.url;
        try {
          path = new URL(request.url, PARSE_BASE).pathname;
        } catch {
          path = '<unparseable>';
        }
        options.onError?.(error, {
          method: request.method,
          path,
          ...(id === undefined ? {} : { requestId: id }),
        });
      }
      const response: ApiResponse = {
        status: failure.status,
        headers: {
          ...baseHeaders(context.version),
          ...(failure.code === 'METHOD_NOT_ALLOWED' ? { allow: ALLOW_HEADER } : {}),
        },
        body: toErrorBody(failure, id),
      };
      onRequest?.({ method: request.method, routeTemplate: matchedTemplate, status: response.status });
      return response;
    }
  };
}
