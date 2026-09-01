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

describe('usage-consumer private-canary readiness', () => {
  it('opens its production Hyperdrive only inside data_foundry and always closes it', async () => {
    const hyperdrive = recordingHyperdrive();

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/usage' },
      },
      { openDriver: hyperdrive.openDriver },
    )).resolves.toEqual({
      worker: 'usage-consumer',
      runId: input.runId,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    });
    expect(hyperdrive.opens).toEqual([{
      connectionString: 'postgres://hyperdrive.fixture/usage',
      options: { schema: 'data_foundry' },
    }]);
    expect(hyperdrive.statements).toEqual(['SELECT 1 AS ready']);
    expect(hyperdrive.closed()).toBe(true);
  });

  it('normalizes a database failure after closing the borrowed Hyperdrive client', async () => {
    const hyperdrive = recordingHyperdrive({ queryError: new Error('origin diagnostic must not escape') });

    await expect(probePrivateCanaryReadiness(
      input,
      {
        DEPLOYMENT_ENVIRONMENT: 'production',
        PRIVATE_CANARY_MODE: 'service-binding',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/usage' },
      },
      { openDriver: hyperdrive.openDriver },
    )).rejects.toThrow('Private canary probe failed.');
    expect(hyperdrive.closed()).toBe(true);
  });

  it('exports a named service-binding RPC entrypoint', () => {
    expect(PrivateCanaryEntrypoint.prototype.probe).toBeTypeOf('function');
  });
});
