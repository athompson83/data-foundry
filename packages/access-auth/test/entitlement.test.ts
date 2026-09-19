import { describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from '@data-foundry/canonical-store';
import { releaseEntitlement, reserveEntitlement } from '../src/index.js';

const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const VERTICAL_ID = '11111111-1111-4111-8111-111111111111';
const ENTITLEMENT_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-09-19T12:00:00.000Z');
const PERIOD_END = new Date('2026-10-19T12:00:00.000Z');

function executorWith(handlers: {
  readonly update?: (params: readonly unknown[]) => unknown[];
  readonly select?: (params: readonly unknown[]) => unknown[];
}) {
  const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.trimStart().startsWith('update api_entitlements')) return handlers.update?.(params) ?? [];
    if (sql.trimStart().startsWith('select period_end')) return handlers.select?.(params) ?? [];
    throw new Error(`unexpected query: ${sql.slice(0, 40)}`);
  });
  return { query, executor: { query } as unknown as SqlExecutor };
}

describe('reserveEntitlement', () => {
  it('reserves one unit with a single conditional update and reports the remainder', async () => {
    const { query, executor } = executorWith({
      update: () => [{ id: ENTITLEMENT_ID, included_requests: '5000', consumed_requests: '1', period_end: PERIOD_END.toISOString() }],
    });
    const decision = await reserveEntitlement(executor, { tenantId: TENANT_ID, verticalId: VERTICAL_ID, now: NOW });
    expect(decision).toEqual({
      ok: true,
      entitlementId: ENTITLEMENT_ID,
      includedRequests: 5000,
      remainingRequests: 4999,
      periodEnd: PERIOD_END,
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('consumed_requests < included_requests');
    expect(sql).toContain("billing_source = 'DIRECT'");
    expect(sql).toContain("status = 'ACTIVE'");
    expect(sql).toContain('period_start <= $3::timestamptz');
    expect(sql).toContain('$3::timestamptz < period_end');
    expect(params).toEqual([TENANT_ID, VERTICAL_ID, NOW.toISOString()]);
  });

  it('refuses with ENTITLEMENT_REQUIRED when no active period covers the instant', async () => {
    const { query, executor } = executorWith({ update: () => [], select: () => [] });
    const decision = await reserveEntitlement(executor, { tenantId: TENANT_ID, verticalId: VERTICAL_ID, now: NOW });
    expect(decision).toEqual({ ok: false, reason: 'ENTITLEMENT_REQUIRED', periodEnd: null });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('refuses with QUOTA_EXHAUSTED and the period end when the active period is spent', async () => {
    const { executor } = executorWith({
      update: () => [],
      select: () => [{ period_end: PERIOD_END }],
    });
    const decision = await reserveEntitlement(executor, { tenantId: TENANT_ID, verticalId: VERTICAL_ID, now: NOW });
    expect(decision).toEqual({ ok: false, reason: 'QUOTA_EXHAUSTED', periodEnd: PERIOD_END });
  });

  it('never reports a negative remainder even if the counter and allowance disagree', async () => {
    const { executor } = executorWith({
      update: () => [{ id: ENTITLEMENT_ID, included_requests: 3, consumed_requests: 3, period_end: PERIOD_END }],
    });
    const decision = await reserveEntitlement(executor, { tenantId: TENANT_ID, verticalId: VERTICAL_ID, now: NOW });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.remainingRequests).toBe(0);
  });
});

describe('releaseEntitlement', () => {
  it('decrements only a positive counter and reports whether a unit was released', async () => {
    const { query, executor } = executorWith({ update: () => [{ id: ENTITLEMENT_ID }] });
    expect(await releaseEntitlement(executor, ENTITLEMENT_ID)).toBe(true);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('consumed_requests - 1');
    expect(sql).toContain('consumed_requests > 0');
    expect(params).toEqual([ENTITLEMENT_ID]);

    const spent = executorWith({ update: () => [] });
    expect(await releaseEntitlement(spent.executor, ENTITLEMENT_ID)).toBe(false);
  });
});
