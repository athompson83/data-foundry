/**
 * Edge-specific HTTP rendering for shared access authentication.
 * Credential/database decisions live in `@data-foundry/access-auth`; this
 * adapter deliberately owns only the REST error envelope and status mapping.
 */
import { validateOpaqueEdgeErrorEnvelope } from '@data-foundry/api';
import {
  authenticate,
  type AuthenticateOptions,
  type AuthFailure,
  type AuthFailureReason,
  type AuthResult,
  type AuthSuccess,
} from '@data-foundry/access-auth';

export {
  authenticate,
  type AuthenticateOptions,
  type AuthFailure,
  type AuthFailureReason,
  type AuthResult,
  type AuthSuccess,
};

const REASON_STATUS: Readonly<Record<AuthFailureReason, 401 | 403>> = {
  MISSING_CREDENTIAL: 401,
  MALFORMED_CREDENTIAL: 401,
  UNKNOWN_KEY: 401,
  REVOKED: 401,
  EXPIRED: 401,
  WRONG_ENVIRONMENT: 401,
  TENANT_SUSPENDED: 403,
  WRONG_VERTICAL: 403,
  TENANT_CLOSED: 403,
  TENANT_INACTIVE: 403,
  ACCESS_PROFILE_MISSING: 403,
  WRONG_BILLING_SOURCE: 403,
};

export interface AuthResponseBody {
  readonly error: {
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN';
    readonly message: string;
  };
}

export function toAuthResponse(failure: AuthFailure): { status: 401 | 403; body: AuthResponseBody } {
  const status = REASON_STATUS[failure.reason];
  const code = status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN';
  const message =
    status === 401
      ? 'A valid API key is required. Provide one as a Bearer token in the Authorization header.'
      : 'This API key may not access this deployment.';
  const body: AuthResponseBody = { error: { code, message } };
  return { status, body: validateOpaqueEdgeErrorEnvelope(body) };
}
