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
import { resolveContext, type ApiAppOptions, type ApiContext } from './config.js';
import {
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  contractDocument,
  matchRoute,
  routeParams,
} from './routes.js';
import {
  ReviewerIdentityLeak,
  UnknownFieldError,
} from '@data-foundry/query-model';

const READ_METHODS = new Set(['GET', 'HEAD']);
const ALLOW = 'GET, HEAD';

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

async function dispatch(context: ApiContext, request: ApiRequest): Promise<ApiResponse> {
  let url: URL;
  try {
    url = new URL(request.url, PARSE_BASE);
  } catch {
    // A request target the URL parser rejects is the client's mistake, not a
    // server fault; it must not fall through to the generic 500.
    throw ApiError.invalidParameter('url', 'expected a well-formed request target');
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
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
    throw new ApiError(
      'UNSUPPORTED_API_VERSION',
      'This deployment does not serve that API version.',
      { requested: version?.slice(0, 32) ?? '', supported: [...SUPPORTED_VERSIONS] },
    );
  }

  if (rest.length === 0) return jsonResponse(200, contractDocument(version), version);

  const route = matchRoute(rest);
  if (route === null) {
    throw new ApiError('ROUTE_NOT_FOUND', 'No route matches this path.', {
      path: url.pathname.slice(0, 200),
    });
  }

  if (!READ_METHODS.has(request.method.toUpperCase())) {
    throw new ApiError(
      'METHOD_NOT_ALLOWED',
      'This API is read-only; only GET and HEAD are supported.',
      { allow: ALLOW },
    );
  }

  return route.handler(context, {
    params: routeParams(route, rest),
    query: url.searchParams,
  });
}

export function createApiApp(options: ApiAppOptions): ApiHandler {
  const context = resolveContext(options, CURRENT_VERSION);

  return async (request: ApiRequest): Promise<ApiResponse> => {
    const id = requestId(request);
    try {
      return await dispatch(context, request);
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
      return {
        status: failure.status,
        headers: {
          ...baseHeaders(context.version),
          ...(failure.code === 'METHOD_NOT_ALLOWED' ? { allow: ALLOW } : {}),
        },
        body: toErrorBody(failure, id),
      };
    }
  };
}
