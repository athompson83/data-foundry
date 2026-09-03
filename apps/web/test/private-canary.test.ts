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

describe('web private-canary readiness', () => {
  it('uses the explicit private service binding without any public origin or cache configuration', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/web' },
      },
      { openDriver: hyperdrive.openDriver },
    )).resolves.toEqual({
      worker: 'web',
      runId: input.runId,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    });
    expect(hyperdrive.opens).toEqual([{
      connectionString: 'postgres://hyperdrive.fixture/web',
      options: { schema: 'data_foundry' },
    }]);
    expect(hyperdrive.statements).toEqual([
      expect.stringContaining('current_user::text AS current_user'),
      'SELECT 1 AS ready',
    ]);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('does not expose a configuration reason or open a direct connection', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');
    expect(hyperdrive.opens).toEqual([]);
  });

  it('rejects a session role other than df_web before reporting READY', async () => {
    const hyperdrive = recordingHyperdrive({
      roleBinding: { sessionUser: 'df_usage' },
    });

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/web' },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');

    expect(hyperdrive.closed()).toBe(true);
  });

  it('exports a named service-binding RPC entrypoint', () => {
    expect(PrivateCanaryEntrypoint.prototype.probe).toBeTypeOf('function');
  });
});
