import { createHyperdriveDriver, createPostgresDriver, DATA_FOUNDRY_PRIVATE_SCHEMA,
  createIngestionDeliveryStore, parseIngestionEnvelope, type IngestionQueue,
  type PostgresDriverOptions, type SqlDriver } from '@data-foundry/canonical-store';
import { INGESTION_RUNTIMES } from '../generated/runtime-registry.js';
import { processIngestionDelivery, type IngestionBucket } from './runner.js';
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { PrivateCanaryProbeInput, PrivateCanaryProbeResult } from '@data-foundry/private-canary';
import { probePrivateCanaryReadiness } from './private-canary.js';
import type { IngestionRuntime } from '../../../services/ingest-worker/src/runtime.js';
import { runOperationAlerts, type OperationAlertsEnv } from './operation-alerts.js';

export interface IngestionWorkerEnv extends OperationAlertsEnv {
  readonly DEPLOYMENT_ENVIRONMENT?: string;
  readonly PRIVATE_CANARY_MODE?: string;
  readonly VERTICAL_SLUG?: string;
  readonly RAW_ARTIFACTS_BUCKET_NAME?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly POSTGRES_URL?: string;
  readonly RAW_ARTIFACTS?: IngestionBucket;
  readonly INGESTION_QUEUE?: IngestionQueue;
}
export interface IngestionMessage { readonly body: unknown; ack(): void; retry(options?: { delaySeconds: number }): void }
export interface IngestionBatch { readonly messages: readonly IngestionMessage[] }
export interface IngestionWorkerOptions {
  readonly openDriver?: (connectionString: string, options?: PostgresDriverOptions) => Promise<SqlDriver>;
}
export interface ResolvedIngestionConfig {
  readonly connectionString: string; readonly runtime: IngestionRuntime;
  readonly bucket: IngestionBucket; readonly bucketName: string; readonly queue: IngestionQueue;
}
export class PrivateCanaryEntrypoint extends WorkerEntrypoint<IngestionWorkerEnv> {
  async probe(input: PrivateCanaryProbeInput): Promise<PrivateCanaryProbeResult> {
    return probePrivateCanaryReadiness(input, this.env);
  }
}
export { probePrivateCanaryReadiness } from './private-canary.js';
export function resolveIngestionConfig(env: IngestionWorkerEnv): ResolvedIngestionConfig {
  if (env.DEPLOYMENT_ENVIRONMENT !== 'production' && env.DEPLOYMENT_ENVIRONMENT !== 'development') throw new Error('INGESTION_ENVIRONMENT_INVALID');
  if (env.DEPLOYMENT_ENVIRONMENT === 'production' && env.HYPERDRIVE === undefined) throw new Error('INGESTION_HYPERDRIVE_REQUIRED');
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  const runtime = INGESTION_RUNTIMES[env.VERTICAL_SLUG ?? ''];
  if (!connectionString.trim() || !runtime || !env.RAW_ARTIFACTS || !env.RAW_ARTIFACTS_BUCKET_NAME || !env.INGESTION_QUEUE) throw new Error('INGESTION_BINDINGS_REQUIRED');
  return { connectionString, runtime, bucket: env.RAW_ARTIFACTS, bucketName: env.RAW_ARTIFACTS_BUCKET_NAME, queue: env.INGESTION_QUEUE };
}
async function withDriver<T>(env: IngestionWorkerEnv, options: IngestionWorkerOptions, callback: (driver: SqlDriver) => Promise<T>): Promise<T> {
  const config = resolveIngestionConfig(env);
  const driver = await (options.openDriver ?? (env.HYPERDRIVE ? createHyperdriveDriver : createPostgresDriver))(
    config.connectionString, env.DEPLOYMENT_ENVIRONMENT === 'production'
      ? { schema: DATA_FOUNDRY_PRIVATE_SCHEMA } : { allowPlaintextLoopback: true });
  try { return await callback(driver); } finally { await driver.close().catch(() => undefined); }
}
export async function consumeIngestionBatch(batch: IngestionBatch, env: IngestionWorkerEnv, options: IngestionWorkerOptions = {}): Promise<void> {
  const valid = batch.messages.map(message => ({ message, envelope: parseIngestionEnvelope(message.body) }));
  // Malformed/over-sharing messages never cause database or R2 work.
  for (const { message, envelope } of valid) if (envelope === null) message.ack();
  if (!valid.some(item => item.envelope !== null)) return;
  const config = resolveIngestionConfig(env);
  await withDriver(env, options, async driver => {
    for (const { message, envelope } of valid) {
      if (!envelope) continue;
      try {
        const result = await processIngestionDelivery({ driver, deliveryId: envelope.deliveryId,
          runtime: config.runtime, bucket: config.bucket, bucketName: config.bucketName });
        if (result === 'RETRY') {
          console.warn('[ingestion-worker] processing retry', { code: 'INGESTION_RETRY' });
          message.retry({ delaySeconds: 60 });
        } else message.ack();
      } catch {
        console.error('[ingestion-worker] processing unavailable', { code: 'INGESTION_PROCESSING_FAILED' });
        message.retry({ delaySeconds: 60 });
      }
    }
    await createIngestionDeliveryStore(driver).dispatch(config.queue);
  });
}
export async function dispatchIngestionOutbox(env: IngestionWorkerEnv, options: IngestionWorkerOptions = {}): Promise<number> {
  const config = resolveIngestionConfig(env);
  return withDriver(env, options, driver => createIngestionDeliveryStore(driver).dispatch(config.queue));
}
export async function runScheduledIngestion(env: IngestionWorkerEnv, options: IngestionWorkerOptions = {}): Promise<void> {
  const config = resolveIngestionConfig(env);
  await withDriver(env, options, async driver => {
    let dispatchFailed = false;
    try { await createIngestionDeliveryStore(driver).dispatch(config.queue); }
    catch { dispatchFailed = true; }
    // A Queue outage must not prevent the independent database health snapshot.
    try {
      const summary = await runOperationAlerts(driver, config.runtime.vertical_slug, env);
      if (summary.enabled && summary.attempted > 0) console.info('[ingestion-worker] operational alerts', {
        code: 'OPERATION_ALERT_COUNTS', attempted: summary.attempted, accepted: summary.accepted,
        failed: summary.failed, unknown: summary.unknown,
      });
    } catch {
      console.error('[ingestion-worker] operational monitor unavailable', { code: 'OPERATION_MONITOR_FAILED' });
      throw new Error('OPERATION_MONITOR_FAILED');
    }
    if (dispatchFailed) throw new Error('INGESTION_OUTBOX_FAILED');
  });
}
export default {
  queue: async (batch: IngestionBatch, env: IngestionWorkerEnv) => {
    try { await consumeIngestionBatch(batch, env); }
    catch {
      console.error('[ingestion-worker] queue unavailable', { code: 'INGESTION_QUEUE_FAILED' });
      throw new Error('INGESTION_QUEUE_FAILED');
    }
  },
  scheduled: async (_event: unknown, env: IngestionWorkerEnv) => {
    try { await runScheduledIngestion(env); }
    catch (error) {
      if (error instanceof Error && error.message === 'OPERATION_MONITOR_FAILED') throw new Error('OPERATION_MONITOR_FAILED');
      console.error('[ingestion-worker] outbox unavailable', { code: 'INGESTION_OUTBOX_FAILED' });
      throw new Error('INGESTION_OUTBOX_FAILED');
    }
  },
};
