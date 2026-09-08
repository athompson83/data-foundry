import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { artifactContentKey } from '@data-foundry/acquisition';
import type { SqlDriver, SqlRow } from '@data-foundry/canonical-store';
import { recordingHyperdrive } from '../../../tooling/test-support/private-canary.js';
import { REPO_ROOT } from '../../../tests/support/harness.js';
import synthetic, { assertSyntheticDelivery, consumeSyntheticIngestion, SYNTHETIC_INGESTION_BUCKET, SYNTHETIC_INGESTION_FIXTURES } from '../src/synthetic-ingestion.js';
const deliveryId = '11111111-1111-4111-8111-111111111111';
const row = (key = 'acme-hvac-catalog') => ({ source_key: key, vertical_slug: 'hvac', status: 'SUCCEEDED', outcome: 'FETCHED', artifact_count: 1,
  work_kind: 'PROCESS_ARTIFACTS', content_hash: SYNTHETIC_INGESTION_FIXTURES[key]!.hash,
  r2_uri: `r2://${SYNTHETIC_INGESTION_BUCKET}/${artifactContentKey({ vertical: 'hvac', source: key, contentHash: SYNTHETIC_INGESTION_FIXTURES[key]!.hash })}` });
function fake(rows: SqlRow[] = [row()]) {
  const recording = recordingHyperdrive();
  const openDriver = async () => {
    const base = await recording.openDriver('fixture');
    return { ...base, query: async <R extends SqlRow>(sql: string, params?: Parameters<SqlDriver['query']>[1]): Promise<R[]> =>
      sql.includes('FROM ingestion_deliveries') ? rows as R[] : base.query<R>(sql, params) };
  };
  return { recording, openDriver };
}
const env = { DEPLOYMENT_ENVIRONMENT: 'production', SYNTHETIC_INGESTION_MODE: 'fixed-fixtures-v1', HYPERDRIVE: { connectionString: 'fixture' },
  SYNTHETIC_ARTIFACTS: { get: vi.fn(async () => null) } };
const message = () => ({ body: { version: 1, deliveryId }, ack: vi.fn(), retry: vi.fn() });
describe('fixed synthetic ingestion queue boundary', () => {
  it.each(Object.keys(SYNTHETIC_INGESTION_FIXTURES))('pins exact checked-in bytes and canonical key for %s', async key => {
    const fixture = SYNTHETIC_INGESTION_FIXTURES[key]!;
    const bytes = await readFile(join(REPO_ROOT, 'verticals/hvac/fixtures', fixture.file));
    expect(bytes.byteLength).toBe(fixture.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.hash);
    await expect(assertSyntheticDelivery(await fake([row(key)]).openDriver(), deliveryId)).resolves.toBeUndefined();
  });
  it.each([{ source_key: 'unreviewed-real-source' }, { content_hash: '0'.repeat(64) }, { r2_uri: 'r2://data-foundry-raw-artifacts/fixture' },
    { artifact_count: 2 }, { work_kind: 'VERIFY_UNCHANGED' }, { status: 'RUNNING' }, { outcome: 'NOT_MODIFIED' }, { vertical_slug: 'other' }])('refuses altered source/artifact metadata before processing: %j', async change => {
    const mock = fake([{ ...row(), ...change }]); const process = vi.fn(); const item = message();
    await consumeSyntheticIngestion({ messages: [item] }, env, { openDriver: mock.openDriver, process });
    expect(process).not.toHaveBeenCalled(); expect(item.retry).toHaveBeenCalledOnce(); expect(mock.recording.closed()).toBe(true);
  });
  it('only exports queue processing and acknowledges a successful bounded delivery', async () => {
    expect(Object.keys(synthetic)).toEqual(['queue']);
    const mock = fake(); const process = vi.fn(async () => 'PUBLISHED' as const); const item = message();
    await consumeSyntheticIngestion({ messages: [item] }, env, { openDriver: mock.openDriver, process });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, bucketName: SYNTHETIC_INGESTION_BUCKET }));
    expect(item.ack).toHaveBeenCalledOnce(); expect(mock.recording.closed()).toBe(true);
  });
  it('retries malformed or credential-bearing environments without opening a database', async () => {
    const openDriver = vi.fn(); const item = message();
    await consumeSyntheticIngestion({ messages: [item] }, { ...env, POSTGRES_URL: 'forbidden' }, { openDriver });
    await consumeSyntheticIngestion({ messages: [{ ...item, body: { ...item.body, source: 'forbidden' } }] }, env, { openDriver });
    expect(openDriver).not.toHaveBeenCalled(); expect(item.retry).toHaveBeenCalledTimes(2);
  });
});
