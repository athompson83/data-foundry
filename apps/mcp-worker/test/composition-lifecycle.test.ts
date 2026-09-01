import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SqlDriver } from '@data-foundry/canonical-store';
import {
  createQueryFixtures,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { MCP_RUNTIMES } from '../generated/runtime-registry.js';
import type { McpWorkerRuntime } from '../src/composition.js';

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

function driverThatRecordsClose(onClose: () => void): SqlDriver {
  return {
    label: fixtures.driver.label,
    dialect: fixtures.driver.dialect,
    query: fixtures.driver.query.bind(fixtures.driver),
    exec: fixtures.driver.exec.bind(fixtures.driver),
    transaction: fixtures.driver.transaction.bind(fixtures.driver),
    close: async () => { onClose(); },
  };
}

describe('MCP deployment teardown', () => {
  it('closes the Hyperdrive driver even when SDK handler teardown rejects', async () => {
    const handlerClose = vi.fn(async () => {
      throw new Error('deliberate SDK handler teardown failure');
    });
    vi.resetModules();
    vi.doMock('../src/sdk-server.js', () => ({
      createSdkHandler: () => ({
        fetch: async () => new Response('{}'),
        close: handlerClose,
      }),
    }));

    try {
      const { getMcpDeployment, resetMcpDeployments } = await import('../src/composition.js');
      let driverCloses = 0;
      const deployment = await getMcpDeployment({
        env: {
          DEPLOYMENT_ENVIRONMENT: 'production',
          HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/data-foundry' },
          VERTICAL_SLUG: 'hvac',
          API_KEY_ENVIRONMENT: 'live',
          MCP_HOSTNAME: 'mcp.aroqon.com',
          MCP_ALLOWED_ORIGINS: 'https://app.aroqon.com',
          PUBLIC_ORIGIN: 'https://data.aroqon.com',
          USAGE_EVENTS_QUEUE: { send: async () => undefined },
        },
        runtime: MCP_RUNTIMES['hvac'] as McpWorkerRuntime,
        openDriver: async () => driverThatRecordsClose(() => { driverCloses += 1; }),
      });

      await expect(deployment.close()).rejects.toThrow('deliberate SDK handler teardown failure');
      expect(handlerClose).toHaveBeenCalledTimes(1);
      expect(driverCloses).toBe(1);
      resetMcpDeployments();
    } finally {
      vi.doUnmock('../src/sdk-server.js');
      vi.resetModules();
    }
  });
});
