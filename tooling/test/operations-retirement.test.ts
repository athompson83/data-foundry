import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryObjectClient, R2ArtifactStore } from '../../packages/acquisition/src/index.js';
import { createIngestionDeliveryStore, enqueueIngestionDelivery } from '@data-foundry/canonical-store';
import { createFactory, type Factory, REPO_ROOT } from '../../tests/support/harness.js';
import { stubFetch } from '../../packages/acquisition/test/helpers.js';
import { ACQUISITION_RUNTIMES } from '../../apps/acquisition-worker/generated/runtime-registry.js';
import { runScheduledAcquisition } from '../../apps/acquisition-worker/src/runner.js';
import { applyOperatorAction, parseOperationsArgs } from '../scripts/operations.js';

let factory: Factory;
let oldRun: string; let newerRun: string; let otherTargetRun: string; let otherSourceRun: string;
let replacement: string; let digest = 16;
const nextDigest = () => (++digest).toString(16).padStart(64, '0');
const action = (targetId: string, replacementDeliveryId = replacement) => ({ requestId: crypto.randomUUID(),
  action: 'RETIRE_DELIVERY', targetId, replacementDeliveryId, actorRef: 'ops.owner', reasonCode: 'RECOVERY' });
async function delivery(run: string, status = 'QUEUED', runtimeDigest = nextDigest()) {
  const id = await enqueueIngestionDelivery(factory.driver, { acquisitionRunId: run, artifactRunId: run, runtimeDigest, workKind: 'PROCESS_ARTIFACTS' });
  if (status === 'PUBLISHED') {
    const store = createIngestionDeliveryStore(factory.driver);
    const owned = await store.claim(id);
    if (owned.disposition !== 'ACQUIRED') throw new Error('missing fixture claim');
    await store.publishOwned(owned.claim, async tx => { await tx.query('SELECT 1'); });
  } else if (status !== 'QUEUED') {
    await factory.driver.query(`UPDATE ingestion_deliveries SET status=$2,
      lease_token=CASE WHEN $2='PROCESSING' THEN gen_random_uuid() ELSE NULL END,
      lease_expires_at=CASE WHEN $2='PROCESSING' THEN clock_timestamp()+interval '10 minutes' ELSE NULL END
      WHERE id=$1`, [id, status]);
  }
  return id;
}
async function acquire(index: number, slot: string, targetId?: string) {
  const base = ACQUISITION_RUNTIMES['hvac']!;
  const target = { ...base.targets[index]!, ...(targetId === undefined ? {} : { target_id: targetId }) };
  const body = await readFile(`${REPO_ROOT}/verticals/hvac/fixtures/${index === 2 ? 'ahri-export.csv' : 'acme-catalog.json'}`, 'utf8');
  const result = await runScheduledAcquisition({ driver: factory.driver, runtime: { ...base, targets: [target] }, scheduledFor: slot,
    ingestionRuntimeDigest: nextDigest(), artifactStore: new R2ArtifactStore({ bucket: 'retirement-test', client: new InMemoryObjectClient() }), env: {},
    fetch: stubFetch(() => ({ status: 200, headers: { 'content-type': index === 2 ? 'text/csv' : 'application/json' }, body: body + (index === 0 ? `\n${' '.repeat(digest)}` : '') })).fetch });
  expect(result.executions[0]?.disposition).toBe('SUCCEEDED');
  const [row] = await factory.driver.query<{ id: string }>('SELECT id FROM scheduled_acquisition_runs WHERE status=\'SUCCEEDED\' ORDER BY completed_at DESC,id DESC LIMIT 1');
  return row!.id;
}
beforeAll(async () => {
  factory = await createFactory();
  for (const index of [0, 2]) {
    const target = ACQUISITION_RUNTIMES['hvac']!.targets[index]!;
    const [source] = await factory.driver.query<{ id: string; rights_publisher_mapping_evidence_artifact_id: string }>('SELECT id,rights_publisher_mapping_evidence_artifact_id FROM sources WHERE domain=$1',[target.source.domain]);
    const [terms] = await factory.driver.query<{ id: string }>('SELECT v.id FROM rights_terms_versions v JOIN rights_terms_cells c ON c.id=v.terms_cell_id WHERE c.source_id=$1',[source!.id]);
    await factory.driver.transaction(async tx => {
    for (const operation of ['ACQUIRE','STORE','CACHE']) {
      const cell=crypto.randomUUID(); const decision=crypto.randomUUID();
      await tx.query(`INSERT INTO rights_cells (id,source_id,acquisition_route,asset_class,output_class,operation,channel,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'INTERNAL_PROCESSING','synthetic-test')`,[cell,source!.id,target.source.acquisition_policy.method,target.asset_class,target.output_class,operation]);
      await tx.query(`INSERT INTO rights_decisions (id,cell_id,state,controlling_terms_version_id,evidence_artifact_id,clause_ref,review_status,reviewer_type,reviewed_by,reviewed_at,effective_from,recheck_at,rationale,created_by)
        VALUES ($1,$2,'ALLOW',$3,$4,'synthetic','APPROVED','HUMAN','synthetic','2026-06-01','2026-06-01','2027-06-01','synthetic','synthetic')`,[decision,cell,terms!.id,source!.rights_publisher_mapping_evidence_artifact_id]);
      await tx.query(`SELECT activate_rights_decision($1,'HUMAN','synthetic','fixture','2026-06-01')`,[decision]);
    }
    });
  }
  oldRun=await acquire(0,'2026-09-08T00:00:00.000Z');
  newerRun=await acquire(0,'2026-10-18T00:00:00.000Z');
  otherTargetRun=await acquire(0,'2026-10-19T00:00:00.000Z','another-target');
  otherSourceRun=await acquire(2,'2026-10-20T00:00:00.000Z','catalog-api');
  replacement=await delivery(newerRun,'PUBLISHED');
});
afterAll(async () => factory?.close());

describe('explicit obsolete delivery retirement', () => {
  it.each(['QUEUED','EXPIRED'])('retires %s work with different retained bytes only by explicit audited replacement', async status => {
    const id=await delivery(oldRun,status==='EXPIRED'?'PROCESSING':'QUEUED');
    if(status==='EXPIRED') await factory.driver.query(`UPDATE ingestion_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[id]);
    await factory.driver.query(`INSERT INTO ingestion_delivery_parts (delivery_id,ordinal,artifact_id,content_hash,byte_size)
      SELECT $1,0,a.id,a.content_hash,0 FROM source_artifacts a JOIN scheduled_acquisition_run_artifacts l ON l.artifact_id=a.id WHERE l.run_id=$2 LIMIT 1`,[id,oldRun]);
    const parts=await factory.driver.query('SELECT * FROM ingestion_delivery_parts WHERE delivery_id=$1',[id]);
    const artifacts=await factory.driver.query('SELECT artifact_id FROM scheduled_acquisition_run_artifacts WHERE run_id=$1',[oldRun]);
    const newerArtifacts=await factory.driver.query('SELECT artifact_id FROM scheduled_acquisition_run_artifacts WHERE run_id=$1',[newerRun]);
    expect(newerArtifacts).not.toEqual(artifacts);
    const intent=action(id,replacement.toUpperCase());
    expect(await applyOperatorAction(factory.driver,intent)).toEqual({applied:true,affectedRows:1,resultId:replacement});
    expect((await factory.driver.query('SELECT status,failure_code,lease_token,lease_expires_at FROM ingestion_deliveries WHERE id=$1',[id]))[0]).toEqual({status:'REFUSED',failure_code:'RUNTIME_MISMATCH',lease_token:null,lease_expires_at:null});
    expect(await factory.driver.query('SELECT * FROM ingestion_delivery_parts WHERE delivery_id=$1',[id])).toEqual(parts);
    expect(await factory.driver.query('SELECT artifact_id FROM scheduled_acquisition_run_artifacts WHERE run_id=$1',[oldRun])).toEqual(artifacts);
    expect((await factory.driver.query('SELECT result_id FROM operator_actions WHERE request_id=$1',[intent.requestId]))[0]).toEqual({result_id:replacement});
    expect(await applyOperatorAction(factory.driver,{...intent,replacementDeliveryId:replacement})).toMatchObject({applied:false});
    await expect(applyOperatorAction(factory.driver,{...intent,replacementDeliveryId:crypto.randomUUID()})).rejects.toThrow('OPERATOR_REQUEST_CONFLICT');
  });
  it.each(['PROCESSING','PUBLISHED','FAILED','REFUSED'])('preserves %s work and never steals an active lease',async status=>{
    const id=await delivery(oldRun,status); const before=await factory.driver.query('SELECT * FROM ingestion_deliveries WHERE id=$1',[id]);
    await expect(applyOperatorAction(factory.driver,action(id))).rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    expect(await factory.driver.query('SELECT * FROM ingestion_deliveries WHERE id=$1',[id])).toEqual(before);
  });
  it.each(['unpublished','same-runtime','older','other-target','other-source'])('refuses a %s replacement without changing work or audit',async kind=>{
    const runtimeDigest=nextDigest();
    const id=await delivery(kind==='older'?newerRun:oldRun,'QUEUED',runtimeDigest);
    const run=kind==='older'?oldRun:kind==='other-target'?otherTargetRun:kind==='other-source'?otherSourceRun:newerRun;
    const candidate=await delivery(run,kind==='unpublished'?'QUEUED':'PUBLISHED',kind==='same-runtime'?runtimeDigest:nextDigest());
    const intent=action(id,candidate);
    await expect(applyOperatorAction(factory.driver,intent)).rejects.toThrow('OPERATOR_TARGET_NOT_ELIGIBLE');
    expect((await factory.driver.query('SELECT status FROM ingestion_deliveries WHERE id=$1',[id]))[0]?.['status']).toBe('QUEUED');
    expect(await factory.driver.query('SELECT request_id FROM operator_actions WHERE request_id=$1',[intent.requestId])).toEqual([]);
  });
  it('rolls retirement back when the append-only audit cannot record it',async()=>{
    const id=await delivery(oldRun); const intent=action(id);
    await factory.driver.exec(`CREATE FUNCTION test_retirement_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
      CREATE TRIGGER test_retirement_audit_failure BEFORE INSERT ON operator_actions FOR EACH ROW EXECUTE FUNCTION test_retirement_audit_failure();`);
    try {
      await expect(applyOperatorAction(factory.driver,intent)).rejects.toThrow('synthetic audit failure');
      expect((await factory.driver.query('SELECT status FROM ingestion_deliveries WHERE id=$1',[id]))[0]?.['status']).toBe('QUEUED');
    } finally { await factory.driver.exec('DROP TRIGGER test_retirement_audit_failure ON operator_actions; DROP FUNCTION test_retirement_audit_failure();'); }
  });
  it('requires the normalized replacement ID exclusively on retirement and exposes both IDs in dry-run intent',()=>{
    const args=['action','--action','RETIRE_DELIVERY','--target-id',crypto.randomUUID(),'--replacement-delivery-id',replacement.toUpperCase(),'--request-id',crypto.randomUUID(),'--actor-ref','ops.owner','--reason-code','RECOVERY'];
    expect(parseOperationsArgs(args)).toMatchObject({apply:false,input:{targetId:args[4],replacementDeliveryId:replacement}});
    expect(()=>parseOperationsArgs(args.filter((_,i)=>i!==5&&i!==6))).toThrow();
    expect(()=>parseOperationsArgs(args.map(value=>value==='RETIRE_DELIVERY'?'REPLAY_DELIVERY':value))).toThrow();
  });
});

