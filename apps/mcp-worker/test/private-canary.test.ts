import { describe, expect, it } from 'vitest';
import { recordingHyperdrive } from '../../../tooling/test-support/private-canary.js';
import {
  PrivateCanaryEntrypoint,
  probePrivateCanaryReadiness,
} from '../src/index.js';

const input = {
  runId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  verticalId: '33333333-3333-4333-8333-333333333333',
  edgeApiKeyId: '44444444-4444-4444-8444-444444444444',
  mcpApiKeyId: '55555555-5555-4555-8555-555555555555',
  edgeEventId: '66666666-6666-4666-8666-666666666666',
  mcpEventId: '77777777-7777-4777-8777-777777777777',
} as const;

describe('mcp-worker private-canary readiness', () => {
  it('uses the explicit private service binding without public MCP endpoint configuration and emits the same synthetic MCP event twice', async () => {
    const hyperdrive = recordingHyperdrive();
    const sent: unknown[] = [];
    const startedAt = Date.now();

    const result = await probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/mcp' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    );
    const finishedAt = Date.now();

    expect(result).toEqual({
      worker: 'mcp-worker',
      runId: input.runId,
      readiness: 'READY',
      metering: 'QUEUED',
    });
    expect(hyperdrive.opens).toEqual([{
      connectionString: 'postgres://hyperdrive.fixture/mcp',
      options: { schema: 'data_foundry' },
    }]);
    expect(hyperdrive.statements).toEqual([
      expect.stringContaining('current_user::text AS current_user'),
      'SELECT 1 AS ready',
    ]);
    expect(hyperdrive.closed()).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const event = sent[0] as Record<string, unknown>;
    expect({ ...event, occurred_at: '<fresh-canary-time>' }).toEqual({
      schema_version: 2,
      id: input.mcpEventId,
      tenant_id: input.tenantId,
      api_key_id: input.mcpApiKeyId,
      vertical_id: input.verticalId,
      occurred_at: '<fresh-canary-time>',
      route_key: 'mcp.tools_list',
      method: 'POST',
      status: 200,
      rows_served: 0,
      duration_ms: 0,
      access_tier: 'MCP',
      billing_source: 'NONE',
    });
    const occurredAt = Date.parse(String(event['occurred_at']));
    expect(occurredAt).toBeGreaterThanOrEqual(startedAt);
    expect(occurredAt).toBeLessThanOrEqual(finishedAt);
  });

  it('does not leak an origin failure after safely closing its Hyperdrive client', async () => {
    const hyperdrive = recordingHyperdrive({ queryError: new Error('origin diagnostic must not escape') });

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/mcp' },
        USAGE_EVENTS_QUEUE: { send: async () => undefined },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');
    expect(hyperdrive.closed()).toBe(true);
  });

  it('rejects an incomplete runtime capability matrix before sending metering', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { roleCapabilityIsExact: false },
    });
    const sent: unknown[] = [];

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/mcp' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(sent).toEqual([]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('rejects a df_mcp login with role membership before sending metering', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { membershipIsEmpty: false },
    });
    const sent: unknown[] = [];

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/mcp' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(sent).toEqual([]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('exports a named service-binding RPC entrypoint', () => {
    expect(PrivateCanaryEntrypoint.prototype.probe).toBeTypeOf('function');
  });
});
