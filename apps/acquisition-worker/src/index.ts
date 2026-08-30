import { R2ArtifactStore } from '@data-foundry/acquisition';
import { createPostgresDriver, type SqlDriver } from '@data-foundry/canonical-store';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import {
  resolveAcquisitionConfig,
  type AcquisitionWorkerEnv,
} from './env.js';
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

export interface ScheduledEventLike {
  /** Cloudflare's scheduled epoch milliseconds. */
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface ScheduledEventOptions {
  /** Test seam only; the production handler always opens Postgres over Hyperdrive. */
  readonly openDriver?: (connectionString: string) => Promise<SqlDriver>;
}

const drivers = new Map<string, Promise<SqlDriver>>();

async function driverFor(
  connectionString: string,
  openDriver: (connectionString: string) => Promise<SqlDriver>,
): Promise<SqlDriver> {
  const existing = drivers.get(connectionString);
  if (existing !== undefined) return existing;
  const pending = openDriver(connectionString).catch((error: unknown) => {
    drivers.delete(connectionString);
    throw error;
  });
  drivers.set(connectionString, pending);
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
    options.openDriver ?? createPostgresDriver,
  );
  return runScheduledAcquisition({
    driver,
    runtime,
    scheduledFor: new Date(event.scheduledTime).toISOString(),
    artifactStore: new R2ArtifactStore({
      bucket: config.bucketName,
      client: createR2ObjectClient(config.bucket),
    }),
    env,
  });
}

export default {
  async scheduled(event: ScheduledEventLike, env: AcquisitionWorkerEnv): Promise<void> {
    await runScheduledEvent(event, env);
  },
};
