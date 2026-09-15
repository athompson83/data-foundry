import {
  createHyperdriveDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
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
import type { AcquisitionWorkerEnv } from './env.js';

export interface PrivateCanaryProbeOptions {
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
}

function failedProbe(): never {
  throw new Error('Private canary probe failed.');
}

/**
 * This confirms only the scheduled Worker's bound database capability. It
 * deliberately never evaluates source rights, calls a provider, or reads R2.
 */
export async function probePrivateCanaryReadiness(
  input: PrivateCanaryProbeInput,
  env: AcquisitionWorkerEnv,
  options: PrivateCanaryProbeOptions = {},
): Promise<PrivateCanaryProbeResult> {
  let driver: SqlDriver | undefined;
  try {
    const connectionString = resolvePrivateCanaryConnectionString(env);

    driver = await (options.openDriver ?? createHyperdriveDriver)(
      connectionString,
      { schema: DATA_FOUNDRY_PRIVATE_SCHEMA },
    );
    await assertPrivateCanaryRuntimeBinding('acquisition-worker', (expectedRole) =>
      driver!.query<PrivateCanaryRuntimeBinding>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, [expectedRole]),
    );
    const [row] = await driver.query<{ readonly ready: unknown }>('SELECT 1 AS ready');
    if (row?.ready !== 1) failedProbe();

    return {
      worker: 'acquisition-worker',
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
