import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryObjectClient, R2ArtifactStore } from '@data-foundry/acquisition';
import { createIngestionDeliveryStore, enqueueIngestionDelivery, parseIngestionEnvelope,
  IngestionOwnershipError, IngestionSupersededError, readOperationHealth, type IngestionClaim, type SqlDriver } from '@data-foundry/canonical-store';
import { createFactory, type Factory, REPO_ROOT } from '../../../tests/support/harness.js';
import { stubFetch } from '../../../packages/acquisition/test/helpers.js';
import { ACQUISITION_RUNTIMES } from '../../acquisition-worker/generated/runtime-registry.js';
import { runScheduledAcquisition } from '../../acquisition-worker/src/runner.js';
import { compileIngestionRuntime } from '../../../tooling/scripts/compile-ingestion-runtime.js';
import { processIngestionDelivery, type IngestionBucket } from '../src/runner.js';
import { loadIngestionRuntime, ingestionRuntimeDigest, INGESTION_LIMITS, type IngestionRuntime } from '../../../services/ingest-worker/src/runtime.js';

let factory: Factory;
let objects: InMemoryObjectClient;
let runtime: IngestionRuntime;
let bucket: IngestionBucket;
beforeEach(async () => {
  factory = await createFactory();
  await seedExactAcquisitionRights(0);
  objects = new InMemoryObjectClient();
  runtime = await compileIngestionRuntime('hvac');
  bucket = { get: async key => {
    const found = await objects.getObject({ bucket: 'test-raw', key });
    return found ? { size: found.contentLength, customMetadata: found.metadata ?? {}, bytes: async () => found.body } : null;
  } };
});
afterEach(async () => factory?.close());
async function seedExactAcquisitionRights(targetIndex: number): Promise<void> {
  const target = ACQUISITION_RUNTIMES['hvac']!.targets[targetIndex]!;
  const [source] = await factory.driver.query<{ id: string; rights_publisher_mapping_evidence_artifact_id: string }>(
    'SELECT id,rights_publisher_mapping_evidence_artifact_id FROM sources WHERE domain=$1', [target.source.domain]);
  const [terms] = await factory.driver.query<{ id: string }>(`SELECT version.id FROM rights_terms_versions version
    JOIN rights_terms_cells cell ON cell.id=version.terms_cell_id WHERE cell.source_id=$1`, [source!.id]);
  await factory.driver.transaction(async tx => {
    for (const operation of ['ACQUIRE', 'STORE', 'CACHE']) {
      const cell = crypto.randomUUID(); const decision = crypto.randomUUID();
      await tx.query(`INSERT INTO rights_cells (id,source_id,acquisition_route,asset_class,output_class,operation,channel,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'INTERNAL_PROCESSING','synthetic-test')`,
        [cell,source!.id,target.source.acquisition_policy.method,target.asset_class,target.output_class,operation]);
      await tx.query(`INSERT INTO rights_decisions (id,cell_id,state,controlling_terms_version_id,evidence_artifact_id,clause_ref,
        review_status,reviewer_type,reviewed_by,reviewed_at,effective_from,recheck_at,rationale,created_by)
        VALUES ($1,$2,'ALLOW',$3,$4,'synthetic','APPROVED','HUMAN','synthetic','2026-06-01','2026-06-01','2027-06-01','synthetic','synthetic')`,
        [decision,cell,terms!.id,source!.rights_publisher_mapping_evidence_artifact_id]);
      await tx.query(`SELECT activate_rights_decision($1,'HUMAN','synthetic','fixture','2026-06-01')`,[decision]);
    }
  });
}
async function acquire(body?: string | Uint8Array, slot = '2026-09-08T00:00:00.000Z', options: { driver?: SqlDriver; targetIndex?: number; expected?: 'SUCCEEDED' | 'FAILED' } = {}) {
  const driver=options.driver ?? factory.driver;
  const targetIndex=options.targetIndex ?? 0;
  const base = ACQUISITION_RUNTIMES['hvac']!;
  const fixtureBody = body ?? await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/${targetIndex === 2 ? 'ahri-export.csv' : 'acme-catalog.json'}`, 'utf8');
  const result = await runScheduledAcquisition({ driver,
    runtime: { ...base, targets: [base.targets[targetIndex]!] }, scheduledFor: slot,
    ingestionRuntimeDigest: runtime.runtime_digest,
    artifactStore: new R2ArtifactStore({ bucket: 'test-raw', client: objects }), env: {},
    fetch: stubFetch(() => ({ status: 200, headers: { 'content-type': targetIndex === 2 ? 'text/csv' : 'application/json', etag: '"fixture-v1"' }, body: fixtureBody })).fetch,
  });
  expect(result.executions[0]?.disposition).toBe(options.expected ?? 'SUCCEEDED');
  if (options.expected === 'FAILED') return '';
  const [delivery] = await factory.driver.query<{ id: string }>('SELECT id FROM ingestion_deliveries ORDER BY created_at DESC LIMIT 1');
  if (!delivery) throw new Error('no atomic delivery');
  return delivery.id;
}
function process(id: string, overrides: Partial<Parameters<typeof processIngestionDelivery>[0]> = {}) {
  return processIngestionDelivery({ driver: factory.driver, deliveryId: id, runtime, bucket, bucketName: 'test-raw', ...overrides });
}
async function owned(id: string): Promise<IngestionClaim> {
  const claimed = await createIngestionDeliveryStore(factory.driver).claim(id);
  if (claimed.disposition !== 'ACQUIRED') throw new Error('missing claim');
  return claimed.claim;
}
function replacementRuntime(): IngestionRuntime {
  const { runtime_digest: _digest, ...payload } = runtime;
  const next = { ...payload, config: { ...payload.config, name: 'Reviewed replacement processing runtime' } };
  return { ...next, runtime_digest: ingestionRuntimeDigest(next) };
}
async function enqueueReplacement(id: string, next: IngestionRuntime): Promise<string> {
  const [row] = await factory.driver.query('SELECT artifact_run_id FROM ingestion_deliveries WHERE id=$1', [id]);
  return enqueueIngestionDelivery(factory.driver, { acquisitionRunId: String(row!['artifact_run_id']),
    artifactRunId: String(row!['artifact_run_id']), runtimeDigest: next.runtime_digest, workKind: 'PROCESS_ARTIFACTS' });
}
async function unchanged(): Promise<string> {
  const base = ACQUISITION_RUNTIMES['hvac']!;
  const result = await runScheduledAcquisition({ driver: factory.driver,
    runtime: { ...base, targets: [base.targets[0]!] },
    scheduledFor: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    ingestionRuntimeDigest: runtime.runtime_digest,
    artifactStore: new R2ArtifactStore({ bucket: 'test-raw', client: objects }), env: {},
    fetch: stubFetch(() => ({ status: 304, headers: { etag: '"fixture-v1"' }, body: '' })).fetch,
  });
  expect(result.executions[0]?.disposition).toBe('SUCCEEDED');
  const [delivery] = await factory.driver.query<{ id: string }>(`SELECT id FROM ingestion_deliveries WHERE work_kind='VERIFY_UNCHANGED'`);
  return delivery!.id;
}

async function independentRecord() {
  const [source] = await factory.driver.query<{ id: string }>("SELECT id FROM sources WHERE domain='www.coolsupply.example.com'");
  if (!source) throw new Error('missing independent synthetic source');
  const artifact = await factory.store.recordSourceArtifact({
    source_id: source.id as never, url: 'https://www.coolsupply.example.com/synthetic-independent.json',
    retrieved_at: '2026-07-01T00:00:00.000Z' as never, content_hash: 'a'.repeat(64) as never,
    mime_type: 'application/json', r2_uri: 'r2://test-raw/synthetic-independent' as never,
    http_status: 200, extractor_version: 'synthetic-independent@1', policy_snapshot_id: null,
    byte_size: 2, acquisition_provider: 'fixture', acquisition_route: 'BROWSER_RUN',
    account_or_product_plan: null, acquisition_jurisdiction: null,
  });
  const record = await factory.store.recordSourceRecord({
    source_id: artifact.source_id as never, artifact_id: artifact.id as never,
    source_record_key: `independent-${crypto.randomUUID()}` as never, source_stream: 'independent_stream',
    entity_type: 'equipment_model' as never, raw_payload: {}, normalized_payload: {},
    extraction_confidence: 1 as never, extractor_version: 'synthetic-independent@1',
  });
  return { artifact, record };
}

async function seedCataloguePairs(count: number, sourceRecordId?: string): Promise<string> {
  const { artifact, record } = await independentRecord();
  const evidenceArtifact = sourceRecordId === undefined ? artifact : (await factory.driver.query<{ id: string; retrieved_at: string }>(
    `SELECT artifact.id,artifact.retrieved_at FROM source_artifacts artifact JOIN source_records record ON record.artifact_id=artifact.id
      WHERE record.id=$1`, [sourceRecordId]))[0]!;
  const [entity] = await factory.driver.query<{ id: string }>(`INSERT INTO entities
    (vertical_id,entity_type,canonical_name,canonical_slug,status,first_seen_at)
    SELECT id,'equipment_model','Unrelated catalogue','unrelated-catalogue','ACTIVE','2026-07-01' FROM verticals
    WHERE slug='hvac' RETURNING id`);
  if (!entity) throw new Error('missing unrelated entity');
  await factory.driver.query(`WITH inserted AS (
    INSERT INTO facts (entity_id,property,normalized_value,value_type,status,confidence,valid_from,recorded_at,output_kind)
    SELECT $1,'unrelated_' || n,to_jsonb(n),'integer','ACTIVE',1,'2026-07-01','2026-07-01','NORMALIZED_FACT'
      FROM generate_series(1,$2::integer) n RETURNING id,property
    ) INSERT INTO fact_evidence (fact_id,artifact_id,source_record_id,source_value,locator_type,locator_value,observed_at)
      SELECT id,$3,$4,property,'JSON_POINTER','/' || property,$5 FROM inserted`,
    [entity.id,count,evidenceArtifact.id,sourceRecordId ?? record.id,evidenceArtifact.retrieved_at]);
  return entity.id;
}

describe('durable artifact-first ingestion', () => {
  it('publishes and verifies a small delivery despite over 10000 unrelated vertical pairs', async () => {
    const base = JSON.parse(await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8')) as { products: Record<string, unknown>[] };
    expect(await process(await acquire(JSON.stringify({ products: [base.products[0]] })))).toBe('PUBLISHED');
    const unrelatedId = await seedCataloguePairs(10_001);
    const id = await acquire(JSON.stringify({ products: [{ ...base.products[0], net_weight_lb: 181 }] }), new Date(Date.now() + 40 * 86_400_000).toISOString());
    const errors: unknown[] = [];
    const result = await process(id, { onError: error => errors.push(error) });
    expect(errors).toEqual([]);
    expect(result).toBe('PUBLISHED');
    expect(await factory.driver.query(`SELECT selected_value FROM fact_verifications WHERE property='weight_lb' ORDER BY evaluated_at DESC LIMIT 1`))
      .toEqual([{ selected_value: 181 }]);
    expect(await factory.driver.query('SELECT id FROM fact_verifications WHERE entity_id=$1', [unrelatedId])).toEqual([]);
    expect((await factory.driver.query('SELECT count(*)::integer AS n FROM facts WHERE entity_id=$1 AND status=\'ACTIVE\'', [unrelatedId]))[0])
      .toEqual({ n: 10_001 });
    expect(await process(await unchanged())).toBe('PUBLISHED');
  });

  it('still refuses excessive affected pairs and rolls back the complete snapshot and publication', async () => {
    const base = JSON.parse(await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8')) as { products: Record<string, unknown>[] };
    expect(await process(await acquire(JSON.stringify({ products: [base.products[0]] })))).toBe('PUBLISHED');
    const [previous] = await factory.driver.query<{ id: string }>('SELECT id FROM source_records WHERE source_record_key=$1 AND is_current', [String(base.products[0]!['sku'])]);
    if (!previous) throw new Error('missing initial source revision');
    await seedCataloguePairs(10_001, previous.id);
    const id = await acquire(JSON.stringify({ products: [{ ...base.products[0], net_weight_lb: 181 }] }), new Date(Date.now() + 40 * 86_400_000).toISOString());
    expect(await process(id)).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM source_records WHERE source_record_key=$1 AND is_current', [String(base.products[0]!['sku'])]))
      .toEqual([previous]);
    expect(await factory.driver.query('SELECT id FROM source_stream_snapshot_acceptances')).toHaveLength(1);
    expect((await factory.driver.query('SELECT status,published_at FROM ingestion_deliveries WHERE id=$1', [id]))[0])
      .toEqual({ status: 'REFUSED', published_at: null });
    expect(await factory.driver.query(`SELECT normalized_value FROM facts WHERE property='weight_lb' AND status='ACTIVE' AND valid_to IS NULL`))
      .toEqual([{ normalized_value: 178 }]);
  });

  it.each(['omission', 'field removal'] as const)('reselects and verifies a fallback affected by snapshot %s', async mode => {
    const base = JSON.parse(await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8')) as { products: Record<string, unknown>[] };
    const products = base.products.slice(0,2);
    expect(await process(await acquire(JSON.stringify({ products })))).toBe('PUBLISHED');
    const [previous] = await factory.driver.query<{ entity_id: string }>(`SELECT fact.entity_id FROM facts fact
      JOIN fact_evidence evidence ON evidence.fact_id=fact.id JOIN source_records record ON record.id=evidence.source_record_id
      WHERE record.source_record_key=$1 AND fact.property='weight_lb' AND fact.status='ACTIVE'`, [String(products[0]!['sku'])]);
    if (!previous) throw new Error('missing old weight');
    const { artifact, record } = await independentRecord();
    await factory.store.appendFactWithEvidence({ entity_id: previous.entity_id as never, property: 'weight_lb' as never,
      normalized_value: 999, value_type: 'number', unit: 'lb', status: 'PROPOSED', confidence: 0.9 as never,
      valid_from: '2026-07-01T00:00:00.000Z' as never, recorded_at: '2026-07-01T00:00:00.000Z' as never },
    [{ artifact_id: artifact.id as never, source_record_id: record.id, source_value: '999',
      locator_type: 'JSON_POINTER', locator_value: '/fallback/weight', observed_at: artifact.retrieved_at as never }]);
    if (mode === 'omission') products.shift();
    else delete products[0]!['net_weight_lb'];
    expect(await process(await acquire(JSON.stringify({ products }), new Date(Date.now() + 40 * 86_400_000).toISOString()))).toBe('PUBLISHED');
    expect(await factory.driver.query(`SELECT normalized_value FROM facts
      WHERE entity_id=$1 AND property='weight_lb' AND status='ACTIVE' AND valid_to IS NULL`, [previous.entity_id]))
      .toEqual([{ normalized_value: 999 }]);
    expect(await factory.driver.query(`SELECT selected_value FROM fact_verifications
      WHERE entity_id=$1 AND property='weight_lb' ORDER BY evaluated_at DESC LIMIT 1`, [previous.entity_id]))
      .toEqual([{ selected_value: 999 }]);
  });

  it('publishes the fictional CSV rating fixture with exact table-cell provenance', async () => {
    await seedExactAcquisitionRights(2);
    const id=await acquire(undefined,undefined,{targetIndex:2});
    const errors:unknown[]=[];
    const result=await process(id,{onError:error=>errors.push(error)});
    expect(errors).toEqual([]);
    expect(result).toBe('PUBLISHED');
    expect((await factory.driver.query(`SELECT id FROM fact_evidence WHERE locator_type='TABLE_CELL'`)).length).toBeGreaterThan(0);
    expect((await factory.driver.query(`SELECT id FROM entities WHERE entity_type='certification'`)).length).toBeGreaterThan(0);
  });
  it('publishes real JSON fixture facts with provenance before acknowledging; duplicate is a no-op', async () => {
    const id = await acquire();
    const errors: unknown[] = [];
    const result = await process(id, { onError: error => errors.push(error) });
    expect(errors).toEqual([]);
    expect(result).toBe('PUBLISHED');
    const state = await factory.driver.query('SELECT status,published_at,verified_at FROM ingestion_deliveries WHERE id=$1', [id]);
    expect(state[0]).toMatchObject({ status: 'PUBLISHED' });
    const facts = await factory.driver.query('SELECT id FROM facts WHERE status = \'ACTIVE\'');
    expect(facts.length).toBeGreaterThan(0);
    expect((await factory.driver.query('SELECT id FROM fact_evidence')).length).toBeGreaterThan(0);
    expect(await process(id)).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM facts WHERE status = \'ACTIVE\'')).toEqual(facts);
  });
  it('keeps the outbox durable when Queue enqueue fails and dispatches an exact opaque envelope on retry', async () => {
    const id = await acquire();
    const store = createIngestionDeliveryStore(factory.driver);
    await expect(store.dispatch({ send: async () => { throw new Error('queue unavailable'); } })).rejects.toThrow();
    expect((await factory.driver.query('SELECT dispatched_at FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['dispatched_at']).toBeNull();
    const send = vi.fn(async () => undefined);
    expect(await store.dispatch({ send })).toBe(1);
    expect(send).toHaveBeenCalledWith({ version: 1, deliveryId: id });
  });
  it('rolls back acquisition completion and artifact links when durable outbox insertion fails', async () => {
    const underlying = factory.driver;
    const failing: SqlDriver = { ...underlying,
      transaction: callback => underlying.transaction(tx => callback({ ...tx, query: async (sql,params) => {
        if (sql.includes('INSERT INTO ingestion_deliveries')) throw new Error('synthetic outbox write failure');
        return tx.query(sql,params);
      }})),
    };
    await acquire(undefined,'2026-09-08T00:00:00.000Z',{ driver:failing, expected:'FAILED' });
    expect(await underlying.query('SELECT id FROM scheduled_acquisition_runs WHERE status=\'SUCCEEDED\'')).toEqual([]);
    expect(await underlying.query('SELECT run_id FROM scheduled_acquisition_run_artifacts')).toEqual([]);
    expect(await underlying.query('SELECT id FROM ingestion_deliveries')).toEqual([]);
  });
  it('does not consume a processing attempt when a rolling deployment delivers work to an older runtime', async () => {
    const id = await acquire();
    const { runtime_digest: _digest, ...payload } = runtime;
    const changed = { ...payload, config: { ...payload.config, name: 'Older consumer' } };
    const old = { ...changed, runtime_digest: ingestionRuntimeDigest(changed) };
    expect(await process(id, { runtime: old })).toBe('RETRY');
    expect((await factory.driver.query('SELECT status,attempt FROM ingestion_deliveries WHERE id=$1',[id]))[0]).toEqual({status:'QUEUED',attempt:0});
  });
  it('refuses extra Queue fields before I/O', () => {
    expect(parseIngestionEnvelope({ version: 1, deliveryId: crypto.randomUUID(), url: 'https://secret.example' })).toBeNull();
    expect(parseIngestionEnvelope({ version: 1, deliveryId: crypto.randomUUID() })).not.toBeNull();
  });
  it('reclaims an expired lease and fences the prior claimant from checkpointing or publishing', async () => {
    const id = await acquire();
    const store = createIngestionDeliveryStore(factory.driver);
    const old = await owned(id);
    expect(await store.claim(id)).toEqual({ disposition: 'ACTIVE' });
    await factory.driver.query(`UPDATE ingestion_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);
    const current = await owned(id);
    expect(current.token).not.toBe(old.token);
    await expect(store.publishOwned(old, async tx => { await tx.query('SELECT 1'); })).rejects.toBeInstanceOf(IngestionOwnershipError);
    await store.releaseOwned(old, 'INPUT_REFUSED', true);
    expect((await factory.driver.query('SELECT status FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['status']).toBe('PROCESSING');
  });
  it('rolls back every callback write when the lease expires before publication', async () => {
    const id = await acquire(); const claim = await owned(id);
    const store = createIngestionDeliveryStore(factory.driver);
    await expect(store.publishOwned(claim, async tx => {
      await tx.query(`UPDATE ingestion_deliveries SET dispatch_attempt=999,
        lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);
    })).rejects.toBeInstanceOf(IngestionOwnershipError);
    expect((await factory.driver.query('SELECT dispatch_attempt FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['dispatch_attempt']).toBe(0);
  });
  it('records terminal retry exhaustion and never returns an old fencing token', async () => {
    const id=await acquire(); const store=createIngestionDeliveryStore(factory.driver);
    for (let i=0;i<5;i++) await store.releaseOwned(await owned(id),'PROCESSING_ERROR');
    expect(await store.claim(id)).toEqual({disposition:'TERMINAL'});
    expect((await factory.driver.query('SELECT status,failure_code,lease_token FROM ingestion_deliveries WHERE id=$1',[id]))[0])
      .toEqual({status:'FAILED',failure_code:'RETRY_EXHAUSTED',lease_token:null});
  });
  it('permits explicit retained-byte replay under a different runtime without changing prior identity', async () => {
    const id = await acquire();
    const [row] = await factory.driver.query<{ acquisition_run_id: string }>('SELECT acquisition_run_id FROM ingestion_deliveries WHERE id=$1', [id]);
    const replay = await enqueueIngestionDelivery(factory.driver, { acquisitionRunId: row!.acquisition_run_id,
      artifactRunId: row!.acquisition_run_id, runtimeDigest: 'e'.repeat(64), workKind: 'PROCESS_ARTIFACTS' });
    expect(replay).not.toBe(id);
    await expect(factory.driver.query('UPDATE ingestion_deliveries SET runtime_digest=$2 WHERE id=$1', [id, 'e'.repeat(64)])).rejects.toThrow('immutable');
  });
  it('reprocesses retained bytes under a new runtime with a new processing generation and original observation time', async () => {
    const id = await acquire(); expect(await process(id)).toBe('PUBLISHED');
    const [prior] = await factory.driver.query<{ observed_at: string }>('SELECT observed_at FROM source_stream_snapshot_acceptances');
    const [row] = await factory.driver.query<{ acquisition_run_id: string }>('SELECT acquisition_run_id FROM ingestion_deliveries WHERE id=$1', [id]);
    const { runtime_digest: _digest, ...payload } = runtime;
    const nextPayload = { ...payload, config: { ...payload.config, name: 'Runtime reprocessing fixture' } };
    const next = { ...nextPayload, runtime_digest: ingestionRuntimeDigest(nextPayload) };
    const replay = await enqueueIngestionDelivery(factory.driver, { acquisitionRunId: row!.acquisition_run_id,
      artifactRunId: row!.acquisition_run_id, runtimeDigest: next.runtime_digest, workKind: 'PROCESS_ARTIFACTS' });
    const errors: unknown[] = [];
    expect(await process(replay, { runtime: next, onError: error => errors.push(error) })).toBe('PUBLISHED');
    expect(errors).toEqual([]);
    const snapshots = await factory.driver.query('SELECT observed_at,processing_generation FROM source_stream_snapshot_acceptances ORDER BY processing_generation');
    expect(snapshots.map(s => s['processing_generation'])).toEqual([0,1]);
    expect(snapshots.every(s => new Date(s['observed_at'] as string).getTime() === new Date(prior!.observed_at).getTime())).toBe(true);
  });
  it('304 verification preserves acquisition and publication times while advancing current entity verification', async () => {
    const id = await acquire(); expect(await process(id)).toBe('PUBLISHED');
    const [prior] = await factory.driver.query('SELECT published_at,processed_at FROM ingestion_deliveries WHERE id=$1',[id]);
    const entities = await factory.driver.query('SELECT id,last_verified_at FROM entities ORDER BY id');
    const verification = await unchanged();
    const errors: unknown[] = [];
    expect(await process(verification, { onError: error => errors.push(error) })).toBe('PUBLISHED');
    expect(errors).toEqual([]);
    const [after] = await factory.driver.query('SELECT published_at,processed_at,verified_at FROM ingestion_deliveries WHERE id=$1',[verification]);
    expect(after).toMatchObject(prior!);
    const [validation] = await factory.driver.query('SELECT fresh_at FROM scheduled_acquisition_runs WHERE outcome=\'NOT_MODIFIED\'');
    expect(after!['verified_at']).toEqual(validation!['fresh_at']);
    const refreshed = await factory.driver.query('SELECT id,last_verified_at FROM entities ORDER BY id');
    expect(refreshed.some((entity,i) => new Date(entity['last_verified_at'] as string).getTime() > new Date(entities[i]!['last_verified_at'] as string).getTime())).toBe(true);
    expect(await factory.driver.query('SELECT id FROM source_stream_snapshot_acceptances')).toHaveLength(1);
  });
  it('does not inflate evidence verification dates during delayed processing', async () => {
    const id = await acquire();
    const [acquisition] = await factory.driver.query('SELECT fresh_at FROM scheduled_acquisition_runs WHERE outcome=\'FETCHED\'');
    expect(await process(id)).toBe('PUBLISHED');
    const entities = await factory.driver.query('SELECT last_verified_at FROM entities');
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every(e => new Date(e['last_verified_at'] as string).getTime() <= new Date(acquisition!['fresh_at'] as string).getTime())).toBe(true);
    const [delivery] = await factory.driver.query('SELECT verified_at,processed_at FROM ingestion_deliveries WHERE id=$1',[id]);
    expect(delivery!['verified_at']).toEqual(acquisition!['fresh_at']);
    expect(new Date(delivery!['processed_at'] as string).getTime()).toBeGreaterThan(new Date(delivery!['verified_at'] as string).getTime());
  });
  it('refuses an older incremental acquisition after a newer acquisition has published', async () => {
    const { runtime_digest: _digest, ...payload } = runtime;
    const sourceMappings = structuredClone(payload.config.sourceMappings);
    sourceMappings.sources.find((s: {source_key:string}) => s.source_key==='acme-hvac-catalog').records[0].refresh_mode='incremental';
    const changed = {...payload,config:{...payload.config,sourceMappings}};
    runtime={...changed,runtime_digest:ingestionRuntimeDigest(changed)};
    const body = JSON.parse(await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8')) as {products: Record<string,unknown>[]};
    const older = await acquire(JSON.stringify({products:[body.products[0]]}));
    const newer = await acquire(JSON.stringify({products:[{...body.products[0],cooling_capacity_btuh:72000}]}),new Date(Date.now()+40*86_400_000).toISOString());
    expect(await process(newer)).toBe('PUBLISHED');
    const facts=await factory.driver.query('SELECT id,normalized_value FROM facts WHERE status=\'ACTIVE\' ORDER BY id');
    expect(await process(older)).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id,normalized_value FROM facts WHERE status=\'ACTIVE\' ORDER BY id')).toEqual(facts);
    expect(await factory.driver.query('SELECT id FROM source_stream_snapshot_acceptances')).toEqual([]);
  });
  it('304 cannot make an unpublished artifact manifest fresh and schedules processing first', async () => {
    const id = await acquire(); const verification = await unchanged();
    expect(await process(verification)).toBe('RETRY');
    expect((await factory.driver.query('SELECT published_at FROM ingestion_deliveries WHERE id=$1',[verification]))[0]!['published_at']).toBeNull();
    expect(await process(id)).toBe('PUBLISHED');
    expect(await process(verification)).toBe('PUBLISHED');
  });
  it('refuses a corrupted content object without publishing or finalizing any record', async () => {
    const id = await acquire();
    const bad: IngestionBucket = { get: async key => {
      const found = await bucket.get(key);
      if (!found || !key.includes('/content/')) return found;
      return { ...found, bytes: async () => new Uint8Array(found.size).fill(1) };
    }};
    expect(await process(id, { bucket: bad })).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM source_records')).toEqual([]);
    expect((await factory.driver.query('SELECT failure_code FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['failure_code']).toBe('INPUT_REFUSED');
  });
  it('retires stale queued runtime work only after its exact artifact replacement publishes and stops redispatch', async () => {
    const id = await acquire(); const next = replacementRuntime(); const replacement = await enqueueReplacement(id, next);
    expect(await process(id, { runtime: next })).toBe('RETRY');
    expect((await factory.driver.query('SELECT status,attempt FROM ingestion_deliveries WHERE id=$1', [id]))[0]).toEqual({ status: 'QUEUED', attempt: 0 });
    expect(await process(replacement, { runtime: next })).toBe('PUBLISHED');
    const facts = await factory.driver.query('SELECT id FROM facts ORDER BY id');
    const get = vi.fn(async () => { throw new Error('retired delivery must not read R2'); });
    expect(await process(id, { bucket: { get } })).toBe('TERMINAL');
    expect(get).not.toHaveBeenCalled();
    expect((await factory.driver.query('SELECT status,failure_code,attempt FROM ingestion_deliveries WHERE id=$1', [id]))[0])
      .toEqual({ status: 'REFUSED', failure_code: 'RUNTIME_MISMATCH', attempt: 0 });
    const send = vi.fn(async () => undefined);
    expect(await createIngestionDeliveryStore(factory.driver).dispatch({ send })).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(await factory.driver.query('SELECT id FROM facts ORDER BY id')).toEqual(facts);
    expect(await factory.driver.query('SELECT id FROM source_artifacts')).toHaveLength(1);
    expect((await readOperationHealth(factory.driver, 'hvac', new Date().toISOString())).FAILED_JOBS).toBe(0);
    // An unrelated later runtime refusal has no successful replacement proof.
    const [scope] = await factory.driver.query('SELECT artifact_run_id FROM ingestion_deliveries WHERE id=$1', [replacement]);
    const unresolved = await enqueueIngestionDelivery(factory.driver, { acquisitionRunId: String(scope!['artifact_run_id']),
      artifactRunId: String(scope!['artifact_run_id']), runtimeDigest: 'c'.repeat(64), workKind: 'PROCESS_ARTIFACTS' });
    await createIngestionDeliveryStore(factory.driver).releaseOwned(await owned(unresolved), 'RUNTIME_MISMATCH', true);
    expect((await readOperationHealth(factory.driver, 'hvac', new Date().toISOString())).FAILED_JOBS).toBe(1);
  });
  it('preserves active ownership and published history while fencing an old owner from overwriting its replacement', async () => {
    const id = await acquire(); const claim = await owned(id); const next = replacementRuntime();
    const replacement = await enqueueReplacement(id, next);
    expect(await process(replacement, { runtime: next })).toBe('PUBLISHED');
    const store = createIngestionDeliveryStore(factory.driver);
    expect(await store.claim(id, next.runtime_digest)).toEqual({ disposition: 'INCOMPATIBLE' });
    expect((await factory.driver.query('SELECT status,lease_token FROM ingestion_deliveries WHERE id=$1', [id]))[0])
      .toEqual({ status: 'PROCESSING', lease_token: claim.token });
    const callback = vi.fn(async () => undefined);
    await expect(store.publishOwned(claim, callback)).rejects.toBeInstanceOf(IngestionSupersededError);
    expect(callback).not.toHaveBeenCalled();
    await factory.driver.query(`UPDATE ingestion_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [id]);
    expect(await store.claim(id, runtime.runtime_digest)).toEqual({ disposition: 'TERMINAL' });
    expect((await factory.driver.query('SELECT status FROM ingestion_deliveries WHERE id=$1', [replacement]))[0]!['status']).toBe('PUBLISHED');
    expect(await process(replacement, { runtime: next })).toBe('TERMINAL');
  });
  it('recreates an old-runtime 304 under a published replacement and retires it only after verification succeeds', async () => {
    const id = await acquire(); expect(await process(id)).toBe('PUBLISHED');
    const verification = await unchanged(); const next = replacementRuntime(); const replacement = await enqueueReplacement(id, next);
    expect(await process(replacement, { runtime: next })).toBe('PUBLISHED');
    expect(await process(verification, { runtime: next })).toBe('RETRY');
    expect(await process(verification, { runtime: next })).toBe('RETRY');
    const rows = await factory.driver.query(`SELECT id FROM ingestion_deliveries WHERE runtime_digest=$1 AND work_kind='VERIFY_UNCHANGED'`, [next.runtime_digest]);
    expect(rows).toHaveLength(1);
    expect((await factory.driver.query('SELECT status,attempt FROM ingestion_deliveries WHERE id=$1', [verification]))[0]).toEqual({ status: 'QUEUED', attempt: 0 });
    expect(await process(String(rows[0]!['id']), { runtime: next })).toBe('PUBLISHED');
    expect(await process(verification, { runtime: next })).toBe('TERMINAL');
    expect((await factory.driver.query('SELECT status FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['status']).toBe('PUBLISHED');
    expect((await readOperationHealth(factory.driver, 'hvac', new Date().toISOString())).FAILED_JOBS).toBe(0);
  });
  it('refuses hash-valid structured bytes with invalid UTF-8 before extraction or checkpoints', async () => {
    const body = new Uint8Array([...new TextEncoder().encode('{"products":[{"name":"'), 0x80, ...new TextEncoder().encode('"}]}')]);
    const id = await acquire(body);
    expect(await process(id)).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM source_records')).toEqual([]);
    expect(await factory.driver.query('SELECT delivery_id FROM ingestion_delivery_parts')).toEqual([]);
    expect((await factory.driver.query('SELECT failure_code FROM ingestion_deliveries WHERE id=$1', [id]))[0]!['failure_code']).toBe('INPUT_REFUSED');
  });
  it('refuses a source target outside the compiled snapshot qualification before R2 access', async () => {
    const { runtime_digest: _digest, ...payload } = runtime;
    const changed = { ...payload, source_targets: payload.source_targets.map(target => target.source_key === 'acme-hvac-catalog'
      ? { ...target, target_id: 'different-target' } : target) };
    runtime = { ...changed, runtime_digest: ingestionRuntimeDigest(changed) };
    const id = await acquire();
    const get = vi.fn(async () => { throw new Error('R2 must not be read'); });
    expect(await process(id, { bucket: { get } })).toBe('TERMINAL');
    expect(get).not.toHaveBeenCalled();
  });
  it('rechecks stored rights before reading R2 and leaves prior dataset unchanged on revocation', async () => {
    const id = await acquire();
    await factory.driver.query(`UPDATE sources SET kill_switch_engaged=TRUE WHERE domain='catalog.acme-climate.example.com'`);
    const get = vi.fn(async () => { throw new Error('R2 must not be reached'); });
    expect(await process(id, { bucket: { get } })).toBe('TERMINAL');
    expect(get).not.toHaveBeenCalled();
    expect(await factory.driver.query('SELECT id FROM source_records')).toEqual([]);
  });
  it('refuses a kill switch engaged during R2 verification before any canonical writes', async () => {
    const id=await acquire(); let revoked=false;
    const revoking: IngestionBucket={get:async key=>{
      const found=await bucket.get(key);
      if (!revoked && key.includes('/content/')) {
        revoked=true;
        await factory.driver.query(`UPDATE sources SET kill_switch_engaged=TRUE WHERE domain='catalog.acme-climate.example.com'`);
      }
      return found;
    }};
    expect(await process(id,{bucket:revoking})).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM facts')).toEqual([]);
    expect(await factory.driver.query('SELECT id FROM source_stream_snapshot_acceptances')).toEqual([]);
  });
  it('refuses oversized R2 objects before allocating their bytes', async () => {
    const id = await acquire(); const bytes = vi.fn(async () => new Uint8Array());
    const oversized: IngestionBucket = { get: async key => key.includes('/content/')
      ? { size: INGESTION_LIMITS.maxArtifactBytes + 1, bytes } : bucket.get(key) };
    expect(await process(id, { bucket: oversized })).toBe('TERMINAL');
    expect(bytes).not.toHaveBeenCalled();
    expect(await factory.driver.query('SELECT id FROM source_records')).toEqual([]);
  });
  it('refuses record overflow atomically without accepting a partial full snapshot', async () => {
    const base = JSON.parse(await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/acme-catalog.json`, 'utf8')) as { products: Record<string, unknown>[] };
    const products = Array.from({length: 1001}, (_, i) => ({ ...base.products[0], sku: `TEST-${i}`, model: `MODEL${i}AAA` }));
    const id = await acquire(JSON.stringify({ products }));
    expect(await process(id)).toBe('TERMINAL');
    expect(await factory.driver.query('SELECT id FROM source_stream_snapshot_acceptances')).toEqual([]);
    expect(await factory.driver.query('SELECT id FROM source_records')).toEqual([]);
  });
  it('pins the compiled config and lists HTML/PDF as unsupported instead of loading default extractors', () => {
    expect(runtime.supported_source_keys).toEqual(['acme-hvac-catalog', 'ahri-directory-export']);
    expect(runtime.unsupported_sources.map(row => row.source_key).sort()).toEqual(['acme-spec-sheets', 'coolsupply-distributor']);
    expect(() => loadIngestionRuntime({ ...runtime, config: { ...runtime.config, name: 'tampered' } })).toThrow('RUNTIME_INVALID');
  });
});
