/**
 * Edge-specific HTTP rendering for the direct-customer allowance
 * (`@data-foundry/access-auth`'s `reserveEntitlement`, ADR-0014). The
 * reservation decision lives in the shared package; this adapter owns only
 * the two opaque refusal responses and the allowance headers a served
 * response carries.
 *
 * Two refusals, two fixed bodies, nothing about the tenant in either:
 *
 * - `ENTITLEMENT_REQUIRED` → 403 `FORBIDDEN`. A valid key whose tenant holds
 *   no active period. Indistinguishable on the wire from the other 403s, on
 *   purpose: which of them applies is the account holder's business, not a
 *   probe's.
 * - `QUOTA_EXHAUSTED` → 429 `QUOTA_EXHAUSTED` with `Retry-After` set to the
 *   seconds until the period ends. This is an allowance, not a rate limit,
 *   and the code says so; the status is the one HTTP has for "not now".
 */
import { validateOpaqueEdgeErrorEnvelope } from '@data-foundry/api';
import type { EntitlementRefusal, EntitlementReservation } from '@data-foundry/access-auth';

export {
  releaseEntitlement,
  reserveEntitlement,
  type EntitlementDecision,
  type EntitlementRefusal,
  type EntitlementRefusalReason,
  type EntitlementReservation,
} from '@data-foundry/access-auth';

export interface EntitlementResponseBody {
  readonly error: {
    readonly code: 'FORBIDDEN' | 'QUOTA_EXHAUSTED';
    readonly message: string;
  };
}

/** Header names are lowercase so tests and clients read them one way. */
export const ALLOWANCE_LIMIT_HEADER = 'x-allowance-limit';
export const ALLOWANCE_REMAINING_HEADER = 'x-allowance-remaining';
export const ALLOWANCE_RESET_HEADER = 'x-allowance-reset';

export function toEntitlementResponse(
  refusal: EntitlementRefusal,
  now: Date,
): { status: 403 | 429; body: EntitlementResponseBody; headers: Readonly<Record<string, string>> } {
  if (refusal.reason === 'ENTITLEMENT_REQUIRED') {
    return {
      status: 403,
      body: validateOpaqueEdgeErrorEnvelope({
        error: { code: 'FORBIDDEN', message: 'This API key may not access this deployment.' },
      }),
      headers: {},
    };
  }
  const resetAt = refusal.periodEnd ?? now;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  return {
    status: 429,
    body: validateOpaqueEdgeErrorEnvelope({
      error: {
        code: 'QUOTA_EXHAUSTED',
        message: 'The request allowance for the current billing period is exhausted.',
      },
    }),
    headers: {
      'retry-after': String(retryAfterSeconds),
      [ALLOWANCE_REMAINING_HEADER]: '0',
      [ALLOWANCE_RESET_HEADER]: resetAt.toISOString(),
    },
  };
}

/** Headers a served response carries so a client can inspect its allowance. */
export function allowanceHeaders(reservation: EntitlementReservation): Readonly<Record<string, string>> {
  return {
    [ALLOWANCE_LIMIT_HEADER]: String(reservation.includedRequests),
    [ALLOWANCE_REMAINING_HEADER]: String(reservation.remainingRequests),
    [ALLOWANCE_RESET_HEADER]: reservation.periodEnd.toISOString(),
  };
}
