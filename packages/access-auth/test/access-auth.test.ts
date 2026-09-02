import { describe, expect, it, vi } from 'vitest';
import { mintApiKey, type ApiAccessTier } from '@data-foundry/api-keys';
import type { SqlExecutor } from '@data-foundry/canonical-store';
import { authenticate } from '../src/index.js';

const VERTICAL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VERTICAL_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';
const KEY_ID = '44444444-4444-4444-8444-444444444444';

async function executorFor(options: {
  readonly accessTier: 'API_PAID' | 'RAPIDAPI' | 'MCP';
  readonly billingSource: 'DIRECT' | 'RAPIDAPI' | 'NONE';
  readonly verticalId?: string;
  readonly revokedAt?: string | null;
}) {
  const key = await mintApiKey('test');
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('from api_keys')) {
      return [{
        id: KEY_ID,
        tenant_id: TENANT_ID,
        token_hash: key.tokenHash,
        token_prefix: key.tokenPrefix,
        vertical_id: options.verticalId ?? VERTICAL_ID,
        access_tier: options.accessTier,
        billing_source: options.billingSource,
        revoked_at: options.revokedAt ?? null,
        expires_at: null,
      }];
    }
    if (sql.includes('from api_tenants')) return [{ id: TENANT_ID, status: 'ACTIVE' }];
    throw new Error('unexpected query');
  });
  return { key, query, executor: { query } as unknown as SqlExecutor };
}

const mcpOptions = {
  verticalId: VERTICAL_ID,
  environment: 'test',
  expectedBillingSource: 'NONE',
  now: new Date('2026-08-28T12:00:00.000Z'),
} as const;

describe('shared database-backed access authentication', () => {
  it('accepts only the exact MCP/NONE classification for the MCP channel', async () => {
    const mcp = await executorFor({ accessTier: 'MCP', billingSource: 'NONE' });
    await expect(
      authenticate(mcp.executor, `Bearer ${mcp.key.secret}`, mcpOptions),
    ).resolves.toEqual({
      ok: true,
      tenantId: TENANT_ID,
      apiKeyId: KEY_ID,
      verticalId: VERTICAL_ID,
      accessTier: 'MCP',
      billingSource: 'NONE',
    });

    for (const classification of [
      { accessTier: 'API_PAID', billingSource: 'DIRECT' },
      { accessTier: 'RAPIDAPI', billingSource: 'RAPIDAPI' },
    ] as const) {
      const other = await executorFor(classification);
      await expect(
        authenticate(other.executor, `Bearer ${other.key.secret}`, mcpOptions),
      ).resolves.toEqual({ ok: false, reason: 'WRONG_BILLING_SOURCE' });
    }
  });

  it('rejects MCP credentials at a direct adapter and narrows successful direct tiers', async () => {
    const mcp = await executorFor({ accessTier: 'MCP', billingSource: 'NONE' });
    const directOptions = { ...mcpOptions, expectedBillingSource: 'DIRECT' } as const;
    await expect(
      authenticate(mcp.executor, `Bearer ${mcp.key.secret}`, directOptions),
    ).resolves.toEqual({ ok: false, reason: 'WRONG_BILLING_SOURCE' });

    const direct = await executorFor({ accessTier: 'API_PAID', billingSource: 'DIRECT' });
    const result = await authenticate(
      direct.executor,
      `Bearer ${direct.key.secret}`,
      directOptions,
    );
    if (!result.ok) throw new Error(`direct key unexpectedly failed: ${result.reason}`);
    const directTier: Exclude<ApiAccessTier, 'MCP' | 'RAPIDAPI'> = result.accessTier;
    expect(directTier).toBe('API_PAID');
    expect(result.billingSource).toBe('DIRECT');
  });

  it('preserves one-key-one-vertical scope and live revocation checks', async () => {
    const wrongVertical = await executorFor({
      accessTier: 'MCP',
      billingSource: 'NONE',
      verticalId: OTHER_VERTICAL_ID,
    });
    await expect(
      authenticate(wrongVertical.executor, `Bearer ${wrongVertical.key.secret}`, mcpOptions),
    ).resolves.toEqual({ ok: false, reason: 'WRONG_VERTICAL' });

    const revoked = await executorFor({
      accessTier: 'MCP',
      billingSource: 'NONE',
      revokedAt: '2026-08-28T11:59:59.000Z',
    });
    await expect(
      authenticate(revoked.executor, `Bearer ${revoked.key.secret}`, mcpOptions),
    ).resolves.toEqual({ ok: false, reason: 'REVOKED' });
    expect(revoked.query).toHaveBeenCalledTimes(1);
  });
});
