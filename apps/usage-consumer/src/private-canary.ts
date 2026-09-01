import {
  createHyperdriveDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import type {
  PrivateCanaryProbeInput,
  PrivateCanaryProbeResult,
} from '@data-foundry/private-canary';
import { resolvePrivateCanaryConnectionString } from '@data-foundry/private-canary';
import type { ConsumerEnv } from './env.js';

export interface PrivateCanaryProbeOptions {
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
}

function failedProbe(): never {
  throw new Error('Private canary probe failed.');
}

/** The queue consumer's own database capability probe; it does not consume a message. */
export async function probePrivateCanaryReadiness(
  input: PrivateCanaryProbeInput,
  env: ConsumerEnv,
  options: PrivateCanaryProbeOptions = {},
): Promise<PrivateCanaryProbeResult> {
  let driver: SqlDriver | undefined;
  try {
    const connectionString = resolvePrivateCanaryConnectionString(env);

    driver = await (options.openDriver ?? createHyperdriveDriver)(
      connectionString,
      { schema: DATA_FOUNDRY_PRIVATE_SCHEMA },
    );
    const [row] = await driver.query<{ readonly ready: unknown }>('SELECT 1 AS ready');
    if (row?.ready !== 1) failedProbe();

    return {
      worker: 'usage-consumer',
      runId: input.runId,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    };
  } catch {
    return failedProbe();
  } finally {
    if (driver !== undefined) await driver.close().catch(() => undefined);
  }
}
