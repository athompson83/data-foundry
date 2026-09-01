import {
  createHyperdriveDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  buildUsageEvent,
  type UsageEvent,
} from '@data-foundry/usage-events';
import type {
  PrivateCanaryProbeInput,
  PrivateCanaryProbeResult,
} from '@data-foundry/private-canary';
import { resolvePrivateCanaryConnectionString } from '@data-foundry/private-canary';
import type { McpWorkerEnv } from './env.js';

export interface PrivateCanaryProbeOptions {
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
}

function failedProbe(): never {
  throw new Error('Private canary probe failed.');
}

function syntheticUsageEvent(input: PrivateCanaryProbeInput): UsageEvent {
  return buildUsageEvent({
    id: input.mcpEventId,
    tenantId: input.tenantId,
    apiKeyId: input.mcpApiKeyId,
    verticalId: input.verticalId,
    occurredAt: new Date(),
    routeKey: 'mcp.tools_list',
    method: 'POST',
    status: 200,
    rowsServed: 0,
    durationMs: 0,
    accessTier: 'MCP',
    billingSource: 'NONE',
  });
}

/** Service-binding-only MCP runtime readiness; it opens no streamable HTTP request. */
export async function probePrivateCanaryReadiness(
  input: PrivateCanaryProbeInput,
  env: McpWorkerEnv,
  options: PrivateCanaryProbeOptions = {},
): Promise<PrivateCanaryProbeResult> {
  let driver: SqlDriver | undefined;
  try {
    const connectionString = resolvePrivateCanaryConnectionString(env);
    const queue = env.USAGE_EVENTS_QUEUE;
    if (queue === undefined) failedProbe();

    driver = await (options.openDriver ?? createHyperdriveDriver)(
      connectionString,
      { schema: DATA_FOUNDRY_PRIVATE_SCHEMA },
    );
    const [row] = await driver.query<{ readonly ready: unknown }>('SELECT 1 AS ready');
    if (row?.ready !== 1) failedProbe();

    const event = syntheticUsageEvent(input);
    await queue.send(event);
    await queue.send(event);

    return {
      worker: 'mcp-worker',
      runId: input.runId,
      readiness: 'READY',
      metering: 'QUEUED',
    };
  } catch {
    return failedProbe();
  } finally {
    if (driver !== undefined) await driver.close().catch(() => undefined);
  }
}
