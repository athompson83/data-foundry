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

describe('acquisition-worker private-canary readiness', () => {
  it('checks its production Hyperdrive without an R2 binding, source configuration, or source read', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/acquisition' },
      },
      { openDriver: hyperdrive.openDriver },
    )).resolves.toEqual({
      worker: 'acquisition-worker',
      runId: input.runId,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    });
    expect(hyperdrive.opens).toEqual([{
      connectionString: 'postgres://hyperdrive.fixture/acquisition',
      options: { schema: 'data_foundry' },
    }]);
    expect(hyperdrive.statements).toEqual([
      expect.stringContaining('current_user::text AS current_user'),
      'SELECT 1 AS ready',
    ]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('refuses an incomplete production binding through a generic result channel', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/acquisition' },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');
    expect(hyperdrive.opens).toEqual([]);
  });

  it('rejects a runtime role with private-schema CREATE before reporting READY', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { privateSchemaCreate: true },
    });

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/acquisition' },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(hyperdrive.closed()).toBe(true);
  });

  it('exports a named service-binding RPC entrypoint', () => {
    expect(PrivateCanaryEntrypoint.prototype.probe).toBeTypeOf('function');
  });
});
