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
  PrivateCanaryRuntimeBinding,
} from '@data-foundry/private-canary';
import {
  assertPrivateCanaryRuntimeBinding,
  PRIVATE_CANARY_RUNTIME_BINDING_SQL,
  resolvePrivateCanaryConnectionString,
} from '@data-foundry/private-canary';
import type { EdgeEnv } from './env.js';

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
    id: input.edgeEventId,
    tenantId: input.tenantId,
    apiKeyId: input.edgeApiKeyId,
    verticalId: input.verticalId,
    occurredAt: new Date(),
    routeKey: 'health',
    method: 'GET',
    status: 200,
    rowsServed: 0,
    durationMs: 0,
    accessTier: 'API_FREE',
    billingSource: 'DIRECT',
  });
}

/**
 * Service-binding-only readiness path. It intentionally performs no HTTP
 * request, authentication, source read, or application query.
 */
export async function probePrivateCanaryReadiness(
  input: PrivateCanaryProbeInput,
  env: EdgeEnv,
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
    await assertPrivateCanaryRuntimeBinding('edge', (expectedRole) =>
      driver!.query<PrivateCanaryRuntimeBinding>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, [expectedRole]),
    );
    const [row] = await driver.query<{ readonly ready: unknown }>('SELECT 1 AS ready');
    if (row?.ready !== 1) failedProbe();

    const event = syntheticUsageEvent(input);
    await queue.send(event);
    await queue.send(event);

    return {
      worker: 'edge',
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
