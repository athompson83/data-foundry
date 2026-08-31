import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createQueryFixtures,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import {
  fixtureRuntime,
  mcpRequest,
  modernBody,
  recordingQueue,
  seedKey,
} from './support.js';

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

function productionEnv(queue: ReturnType<typeof recordingQueue>['queue']) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'production',
    HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/data-foundry' },
    VERTICAL_SLUG: 'hvac',
    API_KEY_ENVIRONMENT: 'live',
    MCP_HOSTNAME: 'mcp.aroqon.com',
    MCP_ALLOWED_ORIGINS: 'https://app.aroqon.com',
    PUBLIC_ORIGIN: 'https://data.aroqon.com',
    USAGE_EVENTS_QUEUE: queue,
  } as const;
}

function productionRequest(secret: string | undefined): Request {
  return mcpRequest(secret, modernBody('tools/list'), {
    hostname: 'mcp.aroqon.com',
    origin: 'https://app.aroqon.com',
    url: 'https://mcp.aroqon.com/mcp',
  });
}

describe('MCP response-lifecycle failure handling', () => {
  it('closes Hyperdrive when response wrapping fails before response ownership transfers', async () => {
    const key = await seedKey(fixtures, 'mcp-hyperdrive-locked-response', { environment: 'live' });
    const { queue } = recordingQueue();
    let closes = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    vi.doMock('../src/composition.js', () => ({
      getMcpDeployment: async () => ({
        driver: fixtures.driver,
        verticalId: fixtures.vertical.id,
        handler: {
          fetch: async () => {
            const response = new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{}'));
                controller.close();
              },
            }));
            // A handler could retain a reader before returning. The adapter
            // must release the invocation-owned driver when wrapping this
            // locked response fails.
            response.body?.getReader();
            return response;
          },
        },
        close: async () => { closes += 1; },
      }),
      resetMcpDeployments: () => undefined,
    }));

    try {
      const { serveMcpRequest } = await import('../src/index.js');
      const response = await serveMcpRequest(
        productionRequest(key.secret),
        productionEnv(queue),
        { runtime: fixtureRuntime },
      );

      expect(response.status).toBe(503);
      expect(closes).toBe(1);
    } finally {
      vi.doUnmock('../src/composition.js');
      vi.restoreAllMocks();
      vi.resetModules();
    }
  });
});
