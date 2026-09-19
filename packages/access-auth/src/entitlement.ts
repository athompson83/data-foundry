/**
 * Synchronous allowance reservation against `api_entitlements` (migration
 * 0034, ADR-0014). This is the strict-quota mechanism ADR-0007 said would
 * "arrive as its own mechanism": a strongly consistent counter on the request
 * path, kept apart from abuse protection (fast, lossy) and metering (durable,
 * asynchronous).
 *
 * The contract is reserve-then-serve. A request that passes authentication
 * reserves one unit of the tenant's active period before any route executes;
 * a request the allowance cannot cover is refused without executing anything.
 * If the platform then fails to serve the request (a 5xx), the unit is
 * released, so a customer is never charged an allowance unit for a fault that
 * was ours. Client errors (4xx) keep their unit: the request was served.
 *
 * Only `DIRECT`-billed tiers are entitled here. The marketplace enforces its
 * own plans per subscriber before a request reaches the origin, and MCP is
 * analytics-only (`NONE`).
 */
import type { SqlExecutor } from '@data-foundry/canonical-store';

export type EntitlementRefusalReason =
  /** The tenant holds no active entitlement period covering this instant. */
  | 'ENTITLEMENT_REQUIRED'
  /** The active period's included requests are fully consumed. */
  | 'QUOTA_EXHAUSTED';

export interface EntitlementReservation {
  readonly ok: true;
  readonly entitlementId: string;
  readonly includedRequests: number;
  /** Remaining after this reservation. */
  readonly remainingRequests: number;
  readonly periodEnd: Date;
}

export interface EntitlementRefusal {
  readonly ok: false;
  readonly reason: EntitlementRefusalReason;
  /** Present for `QUOTA_EXHAUSTED`: when the exhausted period ends. */
  readonly periodEnd: Date | null;
}

export type EntitlementDecision = EntitlementReservation | EntitlementRefusal;

export interface ReserveEntitlementOptions {
  readonly tenantId: string;
  readonly verticalId: string;
  readonly now: Date;
}

type ReservedRow = {
  readonly id: string;
  readonly included_requests: number | string;
  readonly consumed_requests: number | string;
  readonly period_end: Date | string;
} & Record<string, unknown>;

type ActivePeriodRow = { readonly period_end: Date | string } & Record<string, unknown>;

function asInteger(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Reserve one request against the tenant's active `DIRECT` entitlement for
 * this vertical. One atomic `UPDATE`: the row-level lock serializes concurrent
 * requests from the same tenant, and the `consumed_requests <
 * included_requests` predicate plus the table's check constraint make
 * over-consumption impossible rather than merely unlikely.
 */
export async function reserveEntitlement(
  executor: SqlExecutor,
  options: ReserveEntitlementOptions,
): Promise<EntitlementDecision> {
  const { tenantId, verticalId, now } = options;
  const reserved = await executor.query<ReservedRow>(
    `update api_entitlements
        set consumed_requests = consumed_requests + 1,
            updated_at = now()
      where tenant_id = $1
        and vertical_id = $2
        and billing_source = 'DIRECT'
        and status = 'ACTIVE'
        and period_start <= $3::timestamptz
        and $3::timestamptz < period_end
        and consumed_requests < included_requests
      returning id, included_requests, consumed_requests, period_end`,
    [tenantId, verticalId, now.toISOString()],
  );
  const row = reserved[0];
  if (row !== undefined) {
    const included = asInteger(row.included_requests);
    const consumed = asInteger(row.consumed_requests);
    return {
      ok: true,
      entitlementId: row.id,
      includedRequests: included,
      remainingRequests: Math.max(0, included - consumed),
      periodEnd: asDate(row.period_end),
    };
  }
  // Nothing was reserved: either there is no active period, or it is spent.
  const active = await executor.query<ActivePeriodRow>(
    `select period_end
       from api_entitlements
      where tenant_id = $1
        and vertical_id = $2
        and billing_source = 'DIRECT'
        and status = 'ACTIVE'
        and period_start <= $3::timestamptz
        and $3::timestamptz < period_end
      order by period_end desc
      limit 1`,
    [tenantId, verticalId, now.toISOString()],
  );
  const period = active[0];
  if (period === undefined) return { ok: false, reason: 'ENTITLEMENT_REQUIRED', periodEnd: null };
  return { ok: false, reason: 'QUOTA_EXHAUSTED', periodEnd: asDate(period.period_end) };
}

/**
 * Give back a unit reserved for a request the platform failed to serve. Never
 * drives the counter below zero; a release that finds nothing to release is
 * not an error (the period may have been renewed or cancelled meanwhile).
 */
export async function releaseEntitlement(
  executor: SqlExecutor,
  entitlementId: string,
): Promise<boolean> {
  const rows = await executor.query<{ readonly id: string }>(
    `update api_entitlements
        set consumed_requests = consumed_requests - 1,
            updated_at = now()
      where id = $1
        and consumed_requests > 0
      returning id`,
    [entitlementId],
  );
  return rows.length === 1;
}
