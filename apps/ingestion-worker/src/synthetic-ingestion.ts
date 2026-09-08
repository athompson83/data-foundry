/** Queue-only second phase; never deploy this profile while the readiness harness is active. */
import { createHyperdriveDriver, parseIngestionEnvelope, type SqlDriver } from '@data-foundry/canonical-store';
import { assertPrivateCanaryRuntimeBinding, PRIVATE_CANARY_RUNTIME_BINDING_SQL, type PrivateCanaryRuntimeBinding } from '@data-foundry/private-canary';
import { artifactContentKey } from '@data-foundry/acquisition';
import { INGESTION_RUNTIMES } from '../generated/runtime-registry.js';
import { processIngestionDelivery, type IngestionBucket } from './runner.js';
import type { IngestionBatch } from './index.js';

export const SYNTHETIC_INGESTION_BUCKET = 'data-foundry-private-ingestion-artifacts';
export const SYNTHETIC_INGESTION_QUEUE = 'data-foundry-private-ingestion';
export const SYNTHETIC_INGESTION_DLQ = 'data-foundry-private-ingestion-dlq';
export const SYNTHETIC_INGESTION_FIXTURES: Readonly<Record<string, { readonly hash: string; readonly bytes: number; readonly file: string }>> = {
  'acme-hvac-catalog': { hash: '90a9cbd7bf507928158acb7e5b0551f9d901e09ca3efde06f7cc79ea8b8cf43b', bytes: 4597, file: 'acme-catalog.json' },
  'ahri-directory-export': { hash: '5865e326ed4f7feaa5eac0fcce672149617b50e3d248f502491c0351e4c8ecc2', bytes: 1868, file: 'ahri-export.csv' },
};
export interface SyntheticIngestionEnv {
  readonly DEPLOYMENT_ENVIRONMENT?: string;
  readonly SYNTHETIC_INGESTION_MODE?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
  readonly SYNTHETIC_ARTIFACTS?: IngestionBucket;
  readonly POSTGRES_URL?: string;
}
export interface SyntheticIngestionOptions {
  readonly openDriver?: typeof createHyperdriveDriver;
  readonly process?: typeof processIngestionDelivery;
}

/** Database metadata and fixed bytes must agree before any synthetic R2 access. */
export async function assertSyntheticDelivery(driver: SqlDriver, deliveryId: string): Promise<void> {
  const rows = await driver.query(`SELECT run.source_key, run.vertical_slug, run.status, run.outcome,
      run.artifact_count, delivery.work_kind, artifact.content_hash, artifact.r2_uri
    FROM ingestion_deliveries delivery JOIN scheduled_acquisition_runs run ON run.id=delivery.artifact_run_id
    JOIN scheduled_acquisition_run_artifacts link ON link.run_id=run.id
    JOIN source_artifacts artifact ON artifact.id=link.artifact_id AND artifact.source_id=run.source_id
    WHERE delivery.id=$1 LIMIT 2`, [deliveryId]);
  const row = rows[0];
  const sourceKey = String(row?.['source_key']);
  const fixture = SYNTHETIC_INGESTION_FIXTURES[sourceKey];
  if (rows.length !== 1 || !fixture || row?.['vertical_slug'] !== 'hvac' || row['status'] !== 'SUCCEEDED' ||
      row['outcome'] !== 'FETCHED' || row['work_kind'] !== 'PROCESS_ARTIFACTS' || Number(row['artifact_count']) !== 1 ||
      row['content_hash'] !== fixture.hash ||
      row['r2_uri'] !== `r2://${SYNTHETIC_INGESTION_BUCKET}/${artifactContentKey({ vertical: 'hvac', source: sourceKey, contentHash: fixture.hash })}`) {
    throw new Error('SYNTHETIC_INGESTION_REFUSED');
  }
}

export async function consumeSyntheticIngestion(batch: IngestionBatch, env: SyntheticIngestionEnv, options: SyntheticIngestionOptions = {}): Promise<void> {
  for (const message of batch.messages) {
    const envelope = parseIngestionEnvelope(message.body);
    if (!envelope || env.DEPLOYMENT_ENVIRONMENT !== 'production' || env.SYNTHETIC_INGESTION_MODE !== 'fixed-fixtures-v1' ||
        !env.HYPERDRIVE?.connectionString || env.POSTGRES_URL || !env.SYNTHETIC_ARTIFACTS) {
      message.retry(); continue;
    }
    let driver: SqlDriver | undefined;
    try {
      driver = await (options.openDriver ?? createHyperdriveDriver)(env.HYPERDRIVE.connectionString, { schema: 'data_foundry' });
      await assertPrivateCanaryRuntimeBinding('ingestion-worker', expected => driver!.query<PrivateCanaryRuntimeBinding>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, [expected]));
      await assertSyntheticDelivery(driver, envelope.deliveryId);
      const result = await (options.process ?? processIngestionDelivery)({ driver, deliveryId: envelope.deliveryId,
        runtime: INGESTION_RUNTIMES['hvac']!, bucketName: SYNTHETIC_INGESTION_BUCKET, bucket: env.SYNTHETIC_ARTIFACTS });
      if (result === 'RETRY') message.retry({ delaySeconds: 60 }); else message.ack();
    } catch { message.retry({ delaySeconds: 60 }); }
    finally { await driver?.close().catch(() => undefined); }
  }
}
// No HTTP, Cron, ordinary outbox dispatcher, producer, email or receipt-writing capability.
export default { queue: consumeSyntheticIngestion };
