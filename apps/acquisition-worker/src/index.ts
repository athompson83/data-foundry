import { R2ArtifactStore } from '@data-foundry/acquisition';
import {
  createHyperdriveDriver,
  createPostgresDriver,
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  type PostgresDriverOptions,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  PrivateCanaryProbe,
  PrivateCanaryProbeInput,
  PrivateCanaryProbeResult,
} from '@data-foundry/private-canary';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import {
  resolveAcquisitionConfig,
  type AcquisitionWorkerEnv,
} from './env.js';
import { probePrivateCanaryReadiness } from './private-canary.js';
import { createR2ObjectClient } from './r2.js';
import { runScheduledAcquisition, type ScheduledAcquisitionResult } from './runner.js';

export {
  AcquisitionWorkerConfigurationError,
  resolveAcquisitionConfig,
  type AcquisitionWorkerEnv,
  type HyperdriveBinding,
  type ResolvedAcquisitionConfig,
} from './env.js';
export { runScheduledAcquisition, type ScheduledAcquisitionResult } from './runner.js';
export { probePrivateCanaryReadiness, type PrivateCanaryProbeOptions } from './private-canary.js';

/** Service-binding-only probe; it never evaluates or acquires a source. */
export class PrivateCanaryEntrypoint extends WorkerEntrypoint<AcquisitionWorkerEnv> implements PrivateCanaryProbe {
  async probe(input: PrivateCanaryProbeInput): Promise<PrivateCanaryProbeResult> {
    return probePrivateCanaryReadiness(input, this.env);
  }
}

export interface ScheduledEventLike {
  /** Cloudflare's scheduled epoch milliseconds. */
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface ScheduledEventOptions {
  /** Test seam only; the production handler always opens Postgres over Hyperdrive. */
  readonly openDriver?: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
}

const drivers = new Map<string, Promise<SqlDriver>>();

async function driverFor(
  connectionString: string,
  deploymentEnvironment: 'development' | 'production',
  usesHyperdrive: boolean,
  openDriver: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>,
): Promise<SqlDriver> {
  if (usesHyperdrive) {
    return openDriver(
      connectionString,
      deploymentEnvironment === 'production'
        ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA }
        : undefined,
    );
  }
  const driverKey = `${deploymentEnvironment} ${connectionString}`;
  const existing = drivers.get(driverKey);
  if (existing !== undefined) return existing;
  const pending = openDriver(
    connectionString,
    deploymentEnvironment === 'production'
      ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA }
      : undefined,
  ).catch((error: unknown) => {
    drivers.delete(driverKey);
    throw error;
  });
  drivers.set(driverKey, pending);
  return pending;
}

/** Test seam: clear isolate-local pooled driver promises. */
export function resetAcquisitionDrivers(): void {
  drivers.clear();
}

/** Compose one Cron delivery. No provider secret is read until stored rights admit its target. */
export async function runScheduledEvent(
  event: ScheduledEventLike,
  env: AcquisitionWorkerEnv,
  options: ScheduledEventOptions = {},
): Promise<ScheduledAcquisitionResult> {
  const config = resolveAcquisitionConfig(env);
  const runtime = ACQUISITION_RUNTIMES[config.verticalSlug as keyof typeof ACQUISITION_RUNTIMES];
  if (runtime === undefined || runtime.vertical_slug !== config.verticalSlug) {
    throw new Error(`No bundled acquisition runtime exists for ${config.verticalSlug}.`);
  }
  const driver = await driverFor(
    config.connectionString,
    config.deploymentEnvironment,
    env.HYPERDRIVE !== undefined,
    options.openDriver ?? (
      env.HYPERDRIVE === undefined ? createPostgresDriver : createHyperdriveDriver
    ),
  );
  try {
    return await runScheduledAcquisition({
      driver,
      runtime,
      scheduledFor: new Date(event.scheduledTime).toISOString(),
      artifactStore: new R2ArtifactStore({
        bucket: config.bucketName,
        client: createR2ObjectClient(config.bucket),
      }),
      env,
    });
  } finally {
    if (env.HYPERDRIVE !== undefined) await driver.close().catch(() => undefined);
  }
}

export default {
  async scheduled(event: ScheduledEventLike, env: AcquisitionWorkerEnv): Promise<void> {
    await runScheduledEvent(event, env);
  },
};
