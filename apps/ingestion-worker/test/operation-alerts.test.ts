import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationAlertStore, readOperationHealth, type OperationAlertCounts } from '@data-foundry/canonical-store';
import { createFactory, type Factory } from '../../../tests/support/harness.js';
import { InMemoryObjectClient, R2ArtifactStore } from '@data-foundry/acquisition';
import { runScheduledAcquisition } from '../../acquisition-worker/src/runner.js';
import { ACQUISITION_RUNTIMES } from '../../acquisition-worker/generated/runtime-registry.js';
import { compileIngestionRuntime } from '../../../tooling/scripts/compile-ingestion-runtime.js';
import { stubFetch } from '../../../packages/acquisition/test/helpers.js';
import { processIngestionDelivery } from '../src/runner.js';
import { readFile } from 'node:fs/promises';
import { REPO_ROOT } from '../../../tests/support/harness.js';
import { deliverOperationAlerts, resolveOperationAlerts, runOperationAlerts, type OperationEmailBinding } from '../src/operation-alerts.js';

let factory: Factory;
let store: OperationAlertStore;
const AT = '2026-09-08T12:00:00.000Z';
const LATER = '2026-09-08T12:05:00.000Z';
const ZERO: OperationAlertCounts = { ACQUISITION_FAILURE: 0, OUTBOX_AGE: 0, PUBLICATION_LAG: 0, FAILED_JOBS: 0, RIGHTS_EXPIRY: 0 };
const FAILURE = { ...ZERO, FAILED_JOBS: 2 };
const config = (send: OperationEmailBinding['send']) => ({ binding: { send }, from: 'alerts@example.test', to: 'operations@example.test' });

beforeAll(async () => { factory = await createFactory(); store = new OperationAlertStore(factory.driver); });
beforeEach(async () => {
  // These are the disposable test database's alert rows, never canonical data.
  await factory.driver.query('DELETE FROM operation_alert_deliveries');
  await factory.driver.query('DELETE FROM operation_incidents');
});
afterAll(async () => factory?.close());

describe('bounded operational email monitor', () => {
  it('is disabled by default and does no database or binding work', async () => {
    const query = vi.fn(); const send = vi.fn();
    const driver = { ...factory.driver, query, transaction: vi.fn() };
    expect(await runOperationAlerts(driver, 'hvac', { OPS_EMAIL: { send } })).toEqual({
      enabled: false, transitions: 0, attempted: 0, accepted: 0, failed: 0, unknown: 0,
    });
    expect(query).not.toHaveBeenCalled(); expect(driver.transaction).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('rejects incomplete or multi-recipient configuration before observing or sending', () => {
    const base = { OPS_ALERTS_ENABLED: 'true', OPS_EMAIL: { send: vi.fn() }, OPS_ALERT_FROM: 'alerts@example.test', OPS_ALERT_TO: 'operations@example.test' };
    expect(resolveOperationAlerts(base)?.to).toBe(base.OPS_ALERT_TO);
    for (const value of ['', 'a@example.test,b@example.test', 'Ops <a@example.test>', 'a@example.test\r\nBcc:private@example.test', 'a..b@example.test']) {
      expect(() => resolveOperationAlerts({ ...base, OPS_ALERT_TO: value })).toThrow('OPERATION_ALERT_CONFIG_INVALID');
    }
    const { OPS_EMAIL: _binding, ...missingBinding } = base;
    expect(() => resolveOperationAlerts(missingBinding)).toThrow('OPERATION_ALERT_CONFIG_INVALID');
    expect(() => resolveOperationAlerts({ ...base, OPS_ALERTS_ENABLED: 'TRUE' })).toThrow('OPERATION_ALERT_CONFIG_INVALID');
  });
  it('retains one pending incident across repeated observations and sends only failure/recovery transitions', async () => {
    expect(await store.record('hvac', FAILURE, AT)).toBe(1);
    expect(await store.record('hvac', { ...FAILURE, FAILED_JOBS: 3 }, LATER)).toBe(0);
    expect(await factory.driver.query(`SELECT status,observed_count FROM operation_alert_deliveries`)).toEqual([{ status: 'PENDING', observed_count: 2 }]);
    const send = vi.fn(async (_message: Parameters<OperationEmailBinding['send']>[0]) => ({ messageId: 'synthetic-provider-acceptance-do-not-retain' }));
    expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 1, accepted: 1, failed: 0, unknown: 0 });
    expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 0, accepted: 0, failed: 0, unknown: 0 });
    expect(await store.record('hvac', ZERO, '2026-09-08T12:10:00.000Z')).toBe(1);
    expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 1, accepted: 1, failed: 0, unknown: 0 });
    expect(send.mock.calls.map(([message]) => message.subject)).toEqual(['Data Foundry FAILURE: FAILED_JOBS', 'Data Foundry RECOVERY: FAILED_JOBS']);
    expect(send.mock.calls[0]![0].text).toContain('Run pnpm ops status.');
    const rows = await factory.driver.query('SELECT * FROM operation_alert_deliveries');
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row['status'] === 'ACCEPTED' && row['accepted_at'] !== null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('synthetic-provider-acceptance');
    expect(JSON.stringify(rows)).not.toContain('operations@example.test');
  });
  it('does not report a provider refusal as accepted and retains a closed code only', async () => {
    await store.record('hvac', FAILURE, AT);
    const send = vi.fn(async () => { throw Object.assign(new Error('private-customer-secret-response'), { code: 'E_RECIPIENT_NOT_ALLOWED' }); });
    expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 1, accepted: 0, failed: 1, unknown: 0 });
    expect(await factory.driver.query('SELECT status,failure_code,accepted_at FROM operation_alert_deliveries')).toEqual([
      { status: 'FAILED', failure_code: 'PROVIDER_REFUSED', accepted_at: null },
    ]);
    expect(JSON.stringify(await factory.driver.query('SELECT * FROM operation_alert_deliveries'))).not.toContain('private-customer');
  });
  it('retains an unknown send outcome without a second attempt or raw exception in state or messages', async () => {
    await store.record('hvac', FAILURE, AT);
    const send = vi.fn(async (_message: Parameters<OperationEmailBinding['send']>[0]) => { throw new Error('private-source-bytes-and-customer-123'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 1, accepted: 0, failed: 0, unknown: 1 });
      await store.record('hvac', FAILURE, LATER);
      expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 0, accepted: 0, failed: 0, unknown: 0 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      const serialized = JSON.stringify({ rows: await factory.driver.query('SELECT * FROM operation_alert_deliveries'), messages: send.mock.calls });
      expect(serialized).not.toContain('private-source-bytes');
      expect(await factory.driver.query('SELECT status,failure_code,accepted_at FROM operation_alert_deliveries')).toEqual([
        { status: 'UNKNOWN', failure_code: 'PROVIDER_OUTCOME_UNKNOWN', accepted_at: null },
      ]);
    } finally { log.mockRestore(); }
  });
  it('does not repeat a send after acceptance when persisting its acknowledgement failed', async () => {
    await store.record('hvac', FAILURE, AT);
    const send = vi.fn(async () => ({ messageId: 'accepted' }));
    const finish = vi.spyOn(store, 'finish').mockRejectedValueOnce(new Error('synthetic acknowledgement failure'));
    await expect(deliverOperationAlerts(store, 'hvac', config(send))).rejects.toThrow('synthetic acknowledgement failure');
    finish.mockRestore();
    expect(await factory.driver.query('SELECT status FROM operation_alert_deliveries')).toEqual([{ status: 'SENDING' }]);
    await factory.driver.query(`UPDATE operation_alert_deliveries SET attempted_at=clock_timestamp()-interval '11 minutes'`);
    expect(await deliverOperationAlerts(store, 'hvac', config(send))).toEqual({ attempted: 0, accepted: 0, failed: 0, unknown: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await factory.driver.query('SELECT status FROM operation_alert_deliveries')).toEqual([{ status: 'UNKNOWN' }]);
  });
  it('fences concurrent send claims and ignores stale completions', async () => {
    await store.record('hvac', FAILURE, AT);
    const claims = await Promise.all([store.claim('hvac'), store.claim('hvac')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find(item => item !== null)!;
    expect(await store.finish({ ...claim, token: crypto.randomUUID() }, 'ACCEPTED')).toBe(false);
    expect(await store.finish(claim, 'ACCEPTED')).toBe(true);
    expect(await store.finish(claim, 'UNKNOWN')).toBe(false);
  });
  it('cancels superseded pending events and ignores delayed stale observations', async () => {
    await store.record('hvac', FAILURE, AT);
    await store.record('hvac', ZERO, LATER);
    expect(await store.record('hvac', FAILURE, AT)).toBe(0);
    expect(await factory.driver.query('SELECT status,transition FROM operation_alert_deliveries ORDER BY generation')).toEqual([
      { status: 'CANCELLED', transition: 'FAILURE' }, { status: 'PENDING', transition: 'RECOVERY' },
    ]);
    expect(await factory.driver.query(`SELECT active,observed_count FROM operation_incidents WHERE code='FAILED_JOBS'`)).toEqual([{ active: false, observed_count: 0 }]);
  });
  it('uses actual SQL failed-job state for a failure then recovery and excludes raw payloads from email', async () => {
    const [source] = await factory.driver.query('SELECT id,vertical_id FROM sources ORDER BY id LIMIT 1');
    const id = crypto.randomUUID();
    await factory.driver.query(`INSERT INTO ingestion_jobs (id,vertical_id,source_id,job_type,idempotency_key,state,failed_from,retry,payload)
      VALUES ($1,$2,$3,'ARTIFACT_EXTRACT',$4,'FAILED','FETCHED','{}','{"raw":"private-payload-customer-987"}')`, [id, String(source!['vertical_id']), String(source!['id']), id]);
    const send = vi.fn(async (_message: Parameters<OperationEmailBinding['send']>[0]) => ({ messageId: 'accepted' }));
    const env = { OPS_ALERTS_ENABLED: 'true', OPS_EMAIL: { send }, OPS_ALERT_FROM: 'alerts@example.test', OPS_ALERT_TO: 'operations@example.test' };
    expect(await runOperationAlerts(factory.driver, 'hvac', env)).toMatchObject({ transitions: 1, attempted: 1, accepted: 1 });
    await factory.driver.query(`UPDATE ingestion_jobs SET state='PUBLISHED',failed_from=NULL,retry=NULL WHERE id=$1`, [id]);
    expect(await runOperationAlerts(factory.driver, 'hvac', env)).toMatchObject({ transitions: 1, attempted: 1, accepted: 1 });
    expect(JSON.stringify(send.mock.calls)).not.toContain('private-payload');
    expect(send.mock.calls[0]![0].text).toContain('Code: FAILED_JOBS');
    expect(send.mock.calls[1]![0].text).toContain('Transition: RECOVERY');
  });
  it('counts currently controlling rights deadlines and does not mutate rights history', async () => {
    const before = await factory.driver.query('SELECT count(*)::integer AS amount FROM rights_decision_activation_events');
    const health = await readOperationHealth(factory.driver, 'hvac', '2027-05-31T00:00:00.000Z');
    expect(health.RIGHTS_EXPIRY).toBeGreaterThan(0);
    expect(await factory.driver.query('SELECT count(*)::integer AS amount FROM rights_decision_activation_events')).toEqual(before);
    expect(Object.keys(health).sort()).toEqual(Object.keys(ZERO).sort());
  });
  it('observes acquisition failure, aging outbox and publication lag, then clears them after canonical publication', async () => {
    const runtime = await compileIngestionRuntime('hvac');
    const base = ACQUISITION_RUNTIMES['hvac']!;
    const target = base.targets[0]!;
    const [source] = await factory.driver.query('SELECT id,rights_publisher_mapping_evidence_artifact_id FROM sources WHERE domain=$1', [target.source.domain]);
    const [terms] = await factory.driver.query(`SELECT version.id FROM rights_terms_versions version
      JOIN rights_terms_cells cell ON cell.id=version.terms_cell_id WHERE cell.source_id=$1`, [String(source!['id'])]);
    await factory.driver.transaction(async tx => { for (const operation of ['ACQUIRE', 'STORE', 'CACHE']) {
      const cell = crypto.randomUUID(); const decision = crypto.randomUUID();
      await tx.query(`INSERT INTO rights_cells (id,source_id,acquisition_route,asset_class,output_class,operation,channel,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'INTERNAL_PROCESSING','synthetic-test')`,
        [cell,String(source!['id']),target.source.acquisition_policy.method,target.asset_class,target.output_class,operation]);
      await tx.query(`INSERT INTO rights_decisions (id,cell_id,state,controlling_terms_version_id,evidence_artifact_id,clause_ref,
        review_status,reviewer_type,reviewed_by,reviewed_at,effective_from,recheck_at,rationale,created_by)
        VALUES ($1,$2,'ALLOW',$3,$4,'synthetic','APPROVED','HUMAN','synthetic','2026-06-01','2026-06-01','2027-06-01','synthetic','synthetic')`,
        [decision,cell,String(terms!['id']),String(source!['rights_publisher_mapping_evidence_artifact_id'])]);
      await tx.query(`SELECT activate_rights_decision($1,'HUMAN','synthetic','fixture','2026-06-01')`,[decision]);
    } });
    const objects = new InMemoryObjectClient();
    const artifactStore = new R2ArtifactStore({ bucket: 'test-alert-raw', client: objects });
    const input = { driver: factory.driver, runtime: { ...base, targets: [target] }, ingestionRuntimeDigest: runtime.runtime_digest, artifactStore, env: {} };
    const failed = await runScheduledAcquisition({ ...input, scheduledFor: '2026-09-08T00:00:00.000Z', fetch: stubFetch(() => { throw new Error('private-provider-payload'); }).fetch });
    expect(failed.executions[0]?.disposition).toBe('FAILED');
    const healthAt = new Date(Date.now() + 31 * 60_000).toISOString();
    expect((await readOperationHealth(factory.driver, 'hvac', healthAt)).ACQUISITION_FAILURE).toBe(1);
    const fixture = await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8');
    const fetched = await runScheduledAcquisition({ ...input, scheduledFor: '2026-09-10T00:00:00.000Z', fetch: stubFetch(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: fixture })).fetch });
    expect(fetched.executions[0]?.disposition).toBe('SUCCEEDED');
    expect(await readOperationHealth(factory.driver, 'hvac', healthAt)).toMatchObject({ ACQUISITION_FAILURE: 0, OUTBOX_AGE: 1, PUBLICATION_LAG: 1 });
    const [delivery] = await factory.driver.query('SELECT id FROM ingestion_deliveries ORDER BY created_at DESC LIMIT 1');
    const errors: unknown[] = [];
    expect(await processIngestionDelivery({ driver: factory.driver, deliveryId: String(delivery!['id']), runtime, bucketName: 'test-alert-raw', onError: error => errors.push(error), bucket: { get: async key => {
      const object = await objects.getObject({ bucket: 'test-alert-raw', key });
      return object ? { size: object.contentLength, customMetadata: object.metadata ?? {}, bytes: async () => object.body } : null;
    } } })).toBe('PUBLISHED');
    expect(errors).toEqual([]);
    expect(await readOperationHealth(factory.driver, 'hvac', healthAt)).toMatchObject({ ACQUISITION_FAILURE: 0, OUTBOX_AGE: 0, PUBLICATION_LAG: 0 });
  });
  it('clears an older legacy target failure only after matching target or record scope succeeds', async () => {
    const [source] = await factory.driver.query('SELECT id,vertical_id FROM sources ORDER BY id LIMIT 1');
    const insert = async (state: 'FAILED' | 'PUBLISHED', url: string, at: string) => {
      const id = crypto.randomUUID();
      await factory.driver.query(`INSERT INTO ingestion_jobs (id,vertical_id,source_id,job_type,idempotency_key,state,failed_from,retry,payload,updated_at)
        VALUES ($1,$2,$3,'ARTIFACT_FETCH',$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [id, String(source!['vertical_id']), String(source!['id']), id, state,
        state === 'FAILED' ? 'FETCHED' : null, state === 'FAILED' ? '{}' : null, JSON.stringify({ url, source_key: 'synthetic-scope' }), at]);
    };
    await insert('FAILED', 'https://fixture.example.test/target-a', '2026-09-08T01:00:00.000Z');
    await insert('PUBLISHED', 'https://fixture.example.test/target-b', '2026-09-08T02:00:00.000Z');
    expect((await readOperationHealth(factory.driver, 'hvac', AT)).FAILED_JOBS).toBe(1);
    await insert('PUBLISHED', 'https://fixture.example.test/target-a', '2026-09-08T03:00:00.000Z');
    expect((await readOperationHealth(factory.driver, 'hvac', AT)).FAILED_JOBS).toBe(0);
  });
});
