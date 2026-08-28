/**
 * One error envelope for every failure this surface can produce.
 *
 * Two properties matter more than the shape itself:
 *
 *   * **Machine-readable.** A client branches on `error.code`, never on the
 *     prose. The HTTP status is a coarse category shared by a dozen different
 *     causes; the code is the cause.
 *   * **Nothing internal escapes.** Every message in a response body is
 *     authored HERE, from a fixed set. An exception's own `message`, its stack,
 *     a SQL fragment, a file path and a reviewer's name are all things that end
 *     up in an unhandled error's text, and an API that forwards them is an
 *     information-disclosure bug with a friendly face. Unknown throwables
 *     collapse to a single opaque `INTERNAL_ERROR`; the real error goes to the
 *     `onError` hook the app is constructed with, which is where operators —
 *     not customers — read it.
 *
 * `details` exists so a 400 can say *which* parameter, without ever carrying a
 * value the server derived. Everything placed in it is either a constant or an
 * echo of what the client itself sent.
 */

import { validateApiErrorEnvelope } from './wire.js';

export const API_ERROR_CODES = [
  /** A path segment or query parameter is syntactically invalid. */
  'INVALID_PARAMETER',
  /** A required query parameter was not supplied. */
  'MISSING_PARAMETER',
  /** The `/vN` prefix names a contract version this deployment does not serve. */
  'UNSUPPORTED_API_VERSION',
  /** The path matches no route in the served version. */
  'ROUTE_NOT_FOUND',
  /** The route exists; the entity does not. */
  'ENTITY_NOT_FOUND',
  /** The route exists but not for this HTTP method. This surface is read-only. */
  'METHOD_NOT_ALLOWED',
  /**
   * Syntactically valid, semantically refused — a filter on a field the
   * vertical does not declare as filterable, a range filter on a string field.
   * 422 rather than 400: the request parsed, the query layer declined it.
   */
  'UNPROCESSABLE_QUERY',
  /** The query layer could not be reached. */
  'SERVICE_UNAVAILABLE',
  /** Anything else. Deliberately carries no detail. */
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  INVALID_PARAMETER: 400,
  MISSING_PARAMETER: 400,
  UNSUPPORTED_API_VERSION: 404,
  ROUTE_NOT_FOUND: 404,
  ENTITY_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UNPROCESSABLE_QUERY: 422,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Safe, structured context for a failure. Constants and client echoes only. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface ApiErrorPayload {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly message: string;
  readonly details?: ErrorDetails;
  /** Echo of the client's own `x-request-id`, when it supplied one. */
  readonly requestId?: string;
}

/** The body of every non-2xx response. Exactly one shape, no exceptions. */
export interface ApiErrorBody {
  readonly error: ApiErrorPayload;
}

/**
 * A failure the API decided on deliberately, with a message written to be read
 * by a customer. Anything that is NOT an `ApiError` is by definition something
 * we did not anticipate, and is never rendered verbatim.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ErrorDetails | null;

  constructor(code: ApiErrorCode, message: string, details: ErrorDetails | null = null) {
    super(message);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  static invalidParameter(parameter: string, expected: string, received?: string): ApiError {
    return new ApiError('INVALID_PARAMETER', `"${parameter}" is not valid: ${expected}.`, {
      parameter,
      expected,
      ...(received === undefined ? {} : { received }),
    });
  }

  static missingParameter(parameter: string, purpose: string): ApiError {
    return new ApiError('MISSING_PARAMETER', `"${parameter}" is required: ${purpose}.`, {
      parameter,
    });
  }

  static entityNotFound(details: ErrorDetails): ApiError {
    return new ApiError('ENTITY_NOT_FOUND', 'No entity matches this identifier.', details);
  }
}

/**
 * The single fixed message for anything unanticipated. It says nothing about
 * the cause on purpose — the cause reaches the operator through `onError`.
 */
export const OPAQUE_INTERNAL_MESSAGE =
  'The server could not complete this request. The failure has been recorded.';

/**
 * Render any throwable as the envelope.
 *
 * The `instanceof` gate is the whole control: an `ApiError`'s message was
 * written here, so it is publishable; anything else was written somewhere we do
 * not control, so it is not.
 */
export function toErrorBody(error: unknown, requestId?: string): ApiErrorBody {
  const id = requestId === undefined ? {} : { requestId };
  if (error instanceof ApiError) {
    return validateApiErrorEnvelope({
      error: {
        code: error.code,
        status: error.status,
        message: error.message,
        ...(error.details === null ? {} : { details: error.details }),
        ...id,
      },
    });
  }
  return validateApiErrorEnvelope({
    error: {
      code: 'INTERNAL_ERROR',
      status: ERROR_STATUS.INTERNAL_ERROR,
      message: OPAQUE_INTERNAL_MESSAGE,
      ...id,
    },
  });
}
