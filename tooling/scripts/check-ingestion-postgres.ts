/** Disposable PostgreSQL proof for the real ingestion role, using fictional fixtures only. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createCanonicalStore, createPostgresDriver, type SqlDriver,
} from '@data-foundry/canonical-store';
import { isLoopbackEndpointHostname } from '@data-foundry/canonical-schema';
import { InMemoryObjectClient, R2ArtifactStore } from '../../packages/acquisition/src/index.js';
import { loadVerticalConfig } from '../../services/ingest-worker/src/index.js';
import { REPO_ROOT, seedSyntheticInternalRights } from '../../tests/support/harness.js';
import { stubFetch } from '../../packages/acquisition/test/helpers.js';
import { ACQUISITION_RUNTIMES } from '../../apps/acquisition-worker/generated/runtime-registry.js';
import { runScheduledAcquisition } from '../../apps/acquisition-worker/src/runner.js';
import { processIngestionDelivery } from '../../apps/ingestion-worker/src/runner.js';
import { compileIngestionRuntime } from './compile-ingestion-runtime.js';
import { isMain } from '../lib/cli-entry.js';

const CONTROL_URL = 'DATA_FOUNDRY_INGESTION_CONTROL_POSTGRES_URL';
const RUNTIME_URL = 'DATA_FOUNDRY_INGESTION_POSTGRES_URL';
export function ingestionControlConnections(env: Readonly<Record<string, string | undefined>>): {
  readonly control: string; readonly runtime: string; readonly allowPlaintextLoopback: boolean;
} {
  if (env['DATA_FOUNDRY_INGESTION_POSTGRES_TEST'] !== '1') throw new Error('Explicit disposable ingestion test mode is required.');
  try {
    const control = new URL(env[CONTROL_URL] ?? '');
    const runtime = new URL(env[RUNTIME_URL] ?? '');
    for (const url of [control, runtime]) {
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !isLoopbackEndpointHostname(url.hostname) ||
          url.search !== '' || url.hash !== '' || url.pathname !== '/data_foundry') throw new Error();
    }
    if (control.hostname !== runtime.hostname || control.port !== runtime.port || runtime.username !== 'df_ingestion') throw new Error();
    return { control: env[CONTROL_URL]!, runtime: env[RUNTIME_URL]!, allowPlaintextLoopback: env['DATA_FOUNDRY_INGESTION_PLAINTEXT_LOOPBACK'] === '1' };
  } catch { throw new Error('Ingestion controls require matching disposable loopback database connections and the df_ingestion runtime identity.'); }
}

export interface IngestionPostgresReceipt {
  readonly kind: 'data-foundry.ingestion-postgres-control.v1';
  readonly published: true;
  readonly duplicateIgnored: true;
  readonly runtimeIdentity: 'df_ingestion';
  readonly activeFacts: number;
  readonly evidence: number;
  readonly rejectedMutations: number;
}

/** The caller supplies already-migrated, already-granted disposable PostgreSQL connections. */
export async function runIngestionPostgresControl(control: SqlDriver, runtimeDriver: SqlDriver): Promise<IngestionPostgresReceipt> {
  assert.equal(control.dialect, 'postgres');
  assert.equal(runtimeDriver.dialect, 'postgres');
  const [identity] = await runtimeDriver.query('SELECT current_user, session_user');
  assert.equal(identity?.['current_user'], 'df_ingestion');
  assert.equal(identity?.['session_user'], 'df_ingestion');
  const [capabilities] = await runtimeDriver.query(`SELECT count(*)::integer AS private_functions FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='data_foundry' AND has_function_privilege(current_user,routine.oid,'EXECUTE')`);
  assert.equal(capabilities?.['private_functions'], 0, 'PUBLIC or inherited function privileges must not mask the runtime grant policy.');
  const config = await loadVerticalConfig('hvac');
  // Refuse a database containing any non-fixture source before synthetic seeding.
  const allowedDomains = new Set(['catalog.acme-climate.example.com', 'docs.acme-climate.example.com', 'ratings-directory.example.org', 'www.coolsupply.example.com']);
  assert.ok(config.sources.every(source => allowedDomains.has(source.domain)));
  const existing = await control.query<{domain: string}>('SELECT domain FROM sources');
  assert.ok(existing.every(source => allowedDomains.has(source.domain)));
  if (existing.length === 0) await control.transaction(async tx => {
    // Fixture helper's transaction markers stay inside this one pinned connection.
    const pinned: SqlDriver = { label: 'synthetic seed', dialect: 'postgres', query: tx.query.bind(tx),
      exec: async sql => { if (!/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) await tx.query(sql); },
      transaction: async work => work(tx), close: async () => undefined };
    await seedSyntheticInternalRights(pinned, createCanonicalStore(pinned), config);
  });
  const target = ACQUISITION_RUNTIMES['hvac']!.targets[0]!;
  const [source] = await control.query('SELECT id, rights_publisher_mapping_evidence_artifact_id FROM sources WHERE domain=$1', [target.source.domain]);
  assert.ok(source);
  const [terms] = await control.query(`SELECT version.id FROM rights_terms_versions version
    JOIN rights_terms_cells cell ON cell.id=version.terms_cell_id WHERE cell.source_id=$1`, [source['id'] as string]);
  const narrow = await control.query(`SELECT 1 FROM rights_cells WHERE source_id=$1 AND asset_class=$2
    AND output_class=$3 AND operation='ACQUIRE'`, [source['id'] as string, target.asset_class, target.output_class]);
  if (narrow.length === 0) await control.transaction(async tx => {
    for (const operation of ['ACQUIRE', 'STORE', 'CACHE']) {
      const cell = crypto.randomUUID(); const decision = crypto.randomUUID();
      await tx.query(`INSERT INTO rights_cells (id,source_id,acquisition_route,asset_class,output_class,operation,channel,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,'INTERNAL_PROCESSING','synthetic-test')`,
      [cell,source['id'] as string,target.source.acquisition_policy.method,target.asset_class,target.output_class,operation]);
      await tx.query(`INSERT INTO rights_decisions (id,cell_id,state,controlling_terms_version_id,evidence_artifact_id,clause_ref,
        review_status,reviewer_type,reviewed_by,reviewed_at,effective_from,recheck_at,rationale,created_by)
        VALUES ($1,$2,'ALLOW',$3,$4,'synthetic','APPROVED','HUMAN','synthetic','2026-06-01','2026-06-01','2027-06-01','synthetic','synthetic')`,
      [decision,cell,terms!['id'] as string,source['rights_publisher_mapping_evidence_artifact_id'] as string]);
      await tx.query(`SELECT activate_rights_decision($1,'HUMAN','synthetic','fixture','2026-06-01')`,[decision]);
    }
  });
  const objects = new InMemoryObjectClient();
  const runtime = await compileIngestionRuntime('hvac');
  const fixture = await readFile(join(REPO_ROOT, 'verticals/hvac/fixtures/acme-catalog.json'), 'utf8');
  const acquisition = await runScheduledAcquisition({
    driver: control, runtime: { ...ACQUISITION_RUNTIMES['hvac']!, targets: [target] },
    // A future synthetic slot bypasses a prior control's freshness cache; the
    // provider observation and rights evaluation still use actual database time.
    scheduledFor: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    ingestionRuntimeDigest: runtime.runtime_digest,
    artifactStore: new R2ArtifactStore({ bucket: 'test-raw', client: objects }), env: {},
    fetch: stubFetch(() => ({ status: 200, headers: { 'content-type': 'application/json', etag: '"fixture-v1"' }, body: fixture })).fetch,
  });
  assert.equal(acquisition.executions[0]?.disposition, 'SUCCEEDED');
  const [delivery] = await control.query<{id: string}>(
    'SELECT id FROM ingestion_deliveries WHERE acquisition_run_id=$1', [acquisition.executions[0]!.runId!]);
  assert.ok(delivery);
  const input = {
    driver: runtimeDriver, deliveryId: delivery.id, runtime, bucketName: 'test-raw',
    bucket: { get: async (key: string) => {
      const object = await objects.getObject({ bucket: 'test-raw', key });
      return object ? { size: object.contentLength, customMetadata: object.metadata ?? {}, bytes: async () => object.body } : null;
    } },
  };
  assert.equal(await processIngestionDelivery(input), 'PUBLISHED');
  const [counts] = await control.query<{facts: number; evidence: number}>(`SELECT
    (SELECT count(*)::integer FROM facts WHERE status='ACTIVE') AS facts,
    (SELECT count(*)::integer FROM fact_evidence) AS evidence`);
  assert.ok(counts && counts.facts > 0 && counts.evidence > 0);
  assert.equal(await processIngestionDelivery(input), 'TERMINAL');
  const rejected = [
    // UPDATE(id) is needed solely for the trigger's row lock; mutation remains forbidden.
    ["UPDATE source_stream_snapshot_acceptances SET id=gen_random_uuid() WHERE id=(SELECT id FROM source_stream_snapshot_acceptances LIMIT 1)", '23514'],
    ['UPDATE source_stream_snapshot_acceptances SET id=id', '23514'],
    ["UPDATE fact_dependencies SET transformation_ref='control-mutation'", '55000'],
    ['UPDATE fact_dependencies SET transformation_ref=transformation_ref', '55000'],
    ['DELETE FROM fact_dependencies', '42501'],
    ['TRUNCATE fact_dependencies', '42501'],
    ['SELECT last_value FROM ingestion_job_transitions_id_seq', '42501'],
    ['UPDATE sources SET status=status WHERE FALSE', '42501'],
    ['UPDATE source_artifacts SET mime_type=mime_type WHERE FALSE', '42501'],
    ["SELECT activate_rights_decision(NULL::uuid,'HUMAN','synthetic','fixture',clock_timestamp())", '42501'],
  ] as const;
  for (const [sql, code] of rejected) {
    await assert.rejects(runtimeDriver.query(sql), error => (error as {code?: unknown}).code === code);
  }
  return { kind: 'data-foundry.ingestion-postgres-control.v1', published: true,
    duplicateIgnored: true, runtimeIdentity: 'df_ingestion', activeFacts: counts.facts,
    evidence: counts.evidence, rejectedMutations: rejected.length };
}

export async function run(env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  let control: SqlDriver | undefined; let runtime: SqlDriver | undefined;
  try {
    const connections = ingestionControlConnections(env);
    control = await createPostgresDriver(connections.control, { schema: 'data_foundry', allowPlaintextLoopback: connections.allowPlaintextLoopback });
    runtime = await createPostgresDriver(connections.runtime, { schema: 'data_foundry', allowPlaintextLoopback: connections.allowPlaintextLoopback });
    process.stdout.write(`${JSON.stringify(await runIngestionPostgresControl(control, runtime))}\n`);
    return 0;
  } catch {
    process.stderr.write('Disposable ingestion PostgreSQL control failed.\n');
    return 1;
  } finally { await runtime?.close().catch(() => undefined); await control?.close().catch(() => undefined); }
}
if (isMain(import.meta.url)) run().then(code => { process.exitCode = code; });
