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

describe('edge private-canary readiness', () => {
  it('uses the private-schema Hyperdrive and queues one deterministic event twice', async () => {
    const hyperdrive = recordingHyperdrive();
    const sent: unknown[] = [];
    const startedAt = Date.now();

    const result = await probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/edge' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    );
    const finishedAt = Date.now();

    expect(result).toEqual({
      worker: 'edge',
      runId: input.runId,
      readiness: 'READY',
      metering: 'QUEUED',
    });
    expect(hyperdrive.opens).toEqual([{
      connectionString: 'postgres://hyperdrive.fixture/edge',
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
      id: input.edgeEventId,
      tenant_id: input.tenantId,
      api_key_id: input.edgeApiKeyId,
      vertical_id: input.verticalId,
      occurred_at: '<fresh-canary-time>',
      route_key: 'health',
      method: 'GET',
      status: 200,
      rows_served: 0,
      duration_ms: 0,
      access_tier: 'API_FREE',
      billing_source: 'DIRECT',
    });
    const occurredAt = Date.parse(String(event['occurred_at']));
    expect(occurredAt).toBeGreaterThanOrEqual(startedAt);
    expect(occurredAt).toBeLessThanOrEqual(finishedAt);
  });

  it('fails with a fixed message before opening a driver when production metering is unbound', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/edge' },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');
    expect(hyperdrive.opens).toEqual([]);
  });

  it('rejects a current role other than df_edge before sending metering', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { currentUser: 'df_web' },
    });
    const sent: unknown[] = [];

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/edge' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(sent).toEqual([]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('rejects a privileged df_edge login before sending metering', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { roleIsLoginNonprivileged: false },
    });
    const sent: unknown[] = [];

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/edge' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(sent).toEqual([]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('rejects an edge role that can read api_keys.created_at before readiness or metering', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { edgeApiKeysCreatedAtSelect: true },
    });
    const sent: unknown[] = [];

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/edge' },
        USAGE_EVENTS_QUEUE: { send: async (event: unknown) => { sent.push(event); } },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(hyperdrive.statements).toHaveLength(1);
    expect(hyperdrive.statements[0]).toContain('effective_privilege_differences');
    expect(hyperdrive.statements[0]).toContain('has_column_privilege');
    expect(sent).toEqual([]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('exports a named RPC entrypoint rather than adding a public fetch route', () => {
    expect(PrivateCanaryEntrypoint.prototype.probe).toBeTypeOf('function');
  });
});
