/** Real-PostgreSQL controls for the scheduled acquisition ledger. */
import assert from 'node:assert/strict';
import type { SourceArtifactInsert } from '@data-foundry/canonical-schema';
import {
  createCanonicalStore,
  createPostgresDriver,
  createScheduledAcquisitionStore,
  type ScheduledAcquisitionClaim,
  type ScheduledAcquisitionRun,
  type ScheduledAcquisitionStore,
  type ScheduledRightsReceipt,
  type SqlDriver,
} from '../../packages/canonical-store/src/index.js';
import { artifactRetrievalReceiptId } from '../../packages/acquisition/src/index.js';
import {
  authorizeStoredAcquisition,
  recheckStoredAcquisition,
} from '../../apps/acquisition-worker/src/admission.js';
import { seedAcquisitionRightsScopes } from '../../tests/support/acquisition-rights.js';
import { isMain } from '../lib/cli-entry.js';

const iso = (value: string): ScheduledAcquisitionRun['claimedAt'] =>
  value as ScheduledAcquisitionRun['claimedAt'];

const ATTRIBUTION = { required: false, text: null, url: null };
const ROBOTS = {
  respect_robots: true,
  user_agent: 'DataFoundryPostgresControl',
  crawl_delay_seconds: null,
  disallowed_paths: [],
  allowed_paths: ['/api/catalog'],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
};

async function registeredSource(
  driver: SqlDriver,
  suffix: string,
  killSwitchEngaged = false,
) {
  const canonical = createCanonicalStore(driver);
  const vertical = await canonical.registerVertical({
    slug: `postgres-acquisition-${suffix}`,
    name: `Postgres acquisition control ${suffix}`,
    schema_version: '1.0.0',
    status: 'ACTIVE',
    default_refresh_policy: { cadence: 'HOURLY', max_staleness_hours: 1, priority: 100 },
  });
  const domain = `catalog-${suffix}.example.invalid`;
  const source = await canonical.registerSource({
    vertical_id: vertical.id,
    publisher: 'Synthetic PostgreSQL control publisher',
    domain,
    source_type: 'MANUFACTURER',
    authority_rank: 50,
    rights_classification: 'GREEN',
    attribution_requirement: ATTRIBUTION,
    robots_policy: ROBOTS,
    refresh_cadence: 'HOURLY',
    status: 'ACTIVE',
    kill_switch_engaged: killSwitchEngaged,
  });
  return { canonical, vertical, source, domain };
}

function claimFor(
  runKey: string,
  source: Awaited<ReturnType<typeof registeredSource>>,
  slot = '2026-08-28T17:00:00.000Z',
): ScheduledAcquisitionClaim {
  const targetUrl = `https://${source.domain}/api/catalog`;
  return {
    idempotencyKey: `postgres-acquisition:${runKey}`,
    verticalSlug: source.vertical.slug,
    sourceId: source.source.id,
    sourceKey: `postgres-source-${runKey}`,
    targetId: 'catalog-api',
    targetUrl,
    acquisitionRoute: 'DIRECT_HTTP',
    accountOrProductPlan: null,
    jurisdiction: null,
    assetClass: 'DATA',
    outputClass: 'RAW_RECORD',
    resultUrlPolicy: {
      allowedOrigins: [`https://${source.domain}`],
      allowedPathPrefixes: ['/api/catalog'],
    },
    scheduledFor: iso(slot),
    runtimeDigest: 'a'.repeat(64),
    claimedAt: iso('2026-08-28T17:00:01.000Z'),
  };
}

async function receiptsFor(
  driver: SqlDriver,
  run: ScheduledAcquisitionRun,
): Promise<readonly ScheduledRightsReceipt[]> {
  const scope = {
    sourceId: run.sourceId,
    sourceKey: run.sourceKey,
    targetId: run.targetId,
    targetUrl: run.targetUrl,
    acquisitionRoute: run.acquisitionRoute,
    accountOrProductPlan: run.accountOrProductPlan,
    jurisdiction: run.jurisdiction,
    assetClass: run.assetClass,
    outputClass: run.outputClass,
    rightsScopeDigest: run.rightsScopeDigest,
  } as const;
  const admitted = await authorizeStoredAcquisition(
    driver,
    scope,
    '2026-08-28T17:00:01.000Z',
  );
  return [
    admitted.receipt,
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      '2026-08-28T17:00:02.000Z',
      'PRE_PROVIDER',
    ),
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      '2026-08-28T17:00:03.000Z',
      'PRE_TRANSPORT',
    ),
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      '2026-08-28T17:00:04.000Z',
      'PRE_PERSISTENCE',
    ),
  ];
}

function artifactFor(
  run: ScheduledAcquisitionRun,
  contentHash: string,
): SourceArtifactInsert {
  return {
    source_id: run.sourceId,
    url: run.targetUrl,
    retrieved_at: iso('2026-08-28T17:00:03.000Z'),
    content_hash: contentHash,
    mime_type: 'application/json',
    r2_uri: `r2://postgres-control/${run.id}/${contentHash}`,
    http_status: 200,
    extractor_version: 'postgres-control@1',
    policy_snapshot_id: null,
    byte_size: 2,
    acquisition_provider: 'http',
    acquisition_route: run.acquisitionRoute,
    account_or_product_plan: run.accountOrProductPlan,
    acquisition_jurisdiction: run.jurisdiction,
  };
}

function scheduledArtifact(run: ScheduledAcquisitionRun, artifact: SourceArtifactInsert) {
  const receiptId = artifactRetrievalReceiptId(run.id, artifact.url, 'http');
  return {
    artifact,
    retrievalKey: `raw/postgres-control/${run.id}/${artifact.content_hash}.${receiptId}.json`,
    resultRelation: 'TARGET' as const,
  };
}

async function assertKillSwitchTruthTable(driver: SqlDriver, suffix: string): Promise<void> {
  const rows = [
    [null, false, false],
    [null, true, true],
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ] as const;
  for (const [index, [stored, bundled, expected]] of rows.entries()) {
    const source = await registeredSource(driver, `${suffix}-kill-${index}`);
    await driver.query(
      'UPDATE sources SET kill_switch_engaged = $2 WHERE id = $1',
      [source.source.id, stored],
    );
    const synchronized = await source.canonical.registerSource({
      vertical_id: source.vertical.id,
      publisher: 'Stale bundled publisher must not overwrite storage',
      domain: source.domain,
      source_type: source.source.source_type,
      authority_rank: 1,
      rights_classification: 'GREEN',
      attribution_requirement: ATTRIBUTION,
      robots_policy: ROBOTS,
      refresh_cadence: 'HOURLY',
      status: 'ACTIVE',
      kill_switch_engaged: bundled,
    });
    assert.equal(synchronized.kill_switch_engaged, expected);
  }
}

async function assertLiteralDotTraversalRejected(driver: SqlDriver): Promise<void> {
  const policy = JSON.stringify({
    allowedOrigins: ['https://catalog.example.invalid'],
    allowedPathPrefixes: ['/api/catalog'],
  });
  for (const [relation, route, resultUrl] of [
    ['TARGET', 'DIRECT_HTTP', 'https://catalog.example.invalid/api/catalog/../admin'],
    ['TARGET', 'DIRECT_HTTP', 'https://catalog.example.invalid/api/catalog/./page'],
    ['CHILD_RESOURCE', 'BROWSER_RUN', 'https://catalog.example.invalid/api/catalog/../admin'],
    ['CHILD_RESOURCE', 'BROWSER_RUN', 'https://catalog.example.invalid/api/catalog/./page'],
  ] as const) {
    const targetUrl = relation === 'TARGET'
      ? resultUrl
      : 'https://catalog.example.invalid/api/catalog';
    const rows = await driver.query<{ allowed: boolean }>(
      `SELECT scheduled_acquisition_result_url_allowed(
         $1, $2, $3::jsonb, $4, $5
       ) AS allowed`,
      [targetUrl, route, policy, resultUrl, relation],
    );
    assert.equal(rows[0]?.allowed, false, `${relation} must reject ${resultUrl}`);
  }
}

async function assertAtomicClaim(
  driver: SqlDriver,
  scheduler: ScheduledAcquisitionStore,
  source: Awaited<ReturnType<typeof registeredSource>>,
  suffix: string,
): Promise<void> {
  const input = claimFor(`${suffix}-concurrent`, source);
  const results = await Promise.all(Array.from({ length: 8 }, () => scheduler.claim(input)));
  const claimed = results.filter((run): run is ScheduledAcquisitionRun => run !== null);
  assert.equal(claimed.length, 1, 'exactly one concurrent claimant must win');
  assert.match(claimed[0]!.rightsScopeDigest, /^[0-9a-f]{64}$/);
  const stored = await driver.query<{ count: number }>(
    'SELECT count(*)::INTEGER AS count FROM scheduled_acquisition_runs WHERE idempotency_key = $1',
    [input.idempotencyKey],
  );
  assert.equal(stored[0]?.count, 1);
}

async function assertAtomicTerminalPersistence(
  driver: SqlDriver,
  scheduler: ScheduledAcquisitionStore,
  source: Awaited<ReturnType<typeof registeredSource>>,
  suffix: string,
): Promise<void> {
  await seedAcquisitionRightsScopes({
    driver,
    sourceId: source.source.id,
    scopes: ['DIRECT_HTTP', 'BROWSER_RUN'].map((acquisitionRoute) => ({
      acquisitionRoute,
      assetClass: 'DATA',
      outputClass: 'RAW_RECORD',
    })),
  });

  const failedRun = await scheduler.claim(
    claimFor(`${suffix}-rollback`, source, '2026-08-28T18:00:00.000Z'),
  );
  assert.ok(failedRun);
  const failedReceipts = await receiptsFor(driver, failedRun);
  const before = await driver.query<{ count: number }>(
    'SELECT count(*)::INTEGER AS count FROM source_artifacts',
  );
  await assert.rejects(
    scheduler.complete({
      runId: failedRun.id,
      outcome: 'FETCHED',
      completedAt: iso('2026-08-28T18:00:05.000Z'),
      freshAt: iso('2026-08-28T18:00:04.000Z'),
      provider: 'http',
      validators: {},
      rightsReceipt: failedReceipts,
      artifacts: [
        scheduledArtifact(failedRun, artifactFor(failedRun, 'b'.repeat(64))),
        scheduledArtifact(failedRun, artifactFor(failedRun, 'not-a-content-hash')),
      ],
    }),
  );
  const after = await driver.query<{ count: number }>(
    'SELECT count(*)::INTEGER AS count FROM source_artifacts',
  );
  assert.equal(after[0]?.count, before[0]?.count, 'partial artifacts must roll back');
  const storedFailure = await scheduler.get(failedRun.id);
  assert.equal(storedFailure?.status, 'CLAIMED');
  assert.equal(storedFailure?.freshAt, null);
  assert.equal(await scheduler.latestSuccessAt(failedRun), null);

  const successfulRun = await scheduler.claim(
    claimFor(`${suffix}-success`, source, '2026-08-28T19:00:00.000Z'),
  );
  assert.ok(successfulRun);
  const completed = await scheduler.complete({
    runId: successfulRun.id,
    outcome: 'FETCHED',
    completedAt: iso('2026-08-28T19:00:05.000Z'),
    freshAt: iso('2026-08-28T19:00:04.000Z'),
    provider: 'http',
    validators: { etag: '"postgres-v1"' },
    rightsReceipt: await receiptsFor(driver, successfulRun),
    artifacts: [scheduledArtifact(successfulRun, artifactFor(successfulRun, 'c'.repeat(64)))],
  });
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.artifactCount, 1);
  assert.equal(await scheduler.latestSuccessAt(successfulRun), iso('2026-08-28T19:00:04.000Z'));

  const legacyRun = await scheduler.claim({
    ...claimFor(`${suffix}-legacy-literal-dot`, source, '2026-08-28T20:00:00.000Z'),
    acquisitionRoute: 'BROWSER_RUN',
  });
  assert.ok(legacyRun);
  const maliciousArtifact = artifactFor(legacyRun, 'd'.repeat(64));
  const maliciousUrl = `${legacyRun.targetUrl}/../admin`;
  const persisted = await createCanonicalStore(driver).recordSourceArtifact({
    ...maliciousArtifact,
    url: maliciousUrl,
  });
  const retrieval = scheduledArtifact(legacyRun, { ...maliciousArtifact, url: maliciousUrl });
  const retrievalReceiptId = artifactRetrievalReceiptId(legacyRun.id, maliciousUrl, 'http');
  await driver.exec(
    'ALTER TABLE scheduled_acquisition_run_artifacts DISABLE TRIGGER scheduled_acquisition_run_artifact_insert_guard',
  );
  try {
    await driver.query(
      `INSERT INTO scheduled_acquisition_run_artifacts
         (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
          retrieval_key, retrieval_receipt_id, acquisition_provider)
       VALUES ($1, $2, 0, $3, $4, 'CHILD_RESOURCE', $5, $6, 'http')`,
      [
        legacyRun.id,
        persisted.id,
        legacyRun.targetUrl,
        maliciousUrl,
        retrieval.retrievalKey,
        retrievalReceiptId,
      ],
    );
  } finally {
    await driver.exec(
      'ALTER TABLE scheduled_acquisition_run_artifacts ENABLE TRIGGER scheduled_acquisition_run_artifact_insert_guard',
    );
  }
  await assert.rejects(
    driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = 'SUCCEEDED', outcome = 'FETCHED',
              completed_at = $2, fresh_at = $3, provider = 'http',
              expected_artifact_count = 1, artifact_count = 1,
              rights_receipt = $4::jsonb
        WHERE id = $1`,
      [
        legacyRun.id,
        iso('2026-08-28T20:00:05.000Z'),
        iso('2026-08-28T20:00:04.000Z'),
        JSON.stringify(await receiptsFor(driver, legacyRun)),
      ],
    ),
    /target policy/i,
  );
  const storedLegacy = await scheduler.get(legacyRun.id);
  assert.equal(storedLegacy?.status, 'CLAIMED');
  assert.equal(storedLegacy?.freshAt, null);
}

export async function run(): Promise<number> {
  const connectionString = process.env['POSTGRES_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error('POSTGRES_URL is required for the real PostgreSQL scheduled-acquisition check.');
  }
  const driver = await createPostgresDriver(connectionString);
  try {
    const version = await driver.query<{ server_version: string }>(
      `SELECT current_setting('server_version') AS server_version`,
    );
    assert.match(version[0]?.server_version ?? '', /^16\./, 'PostgreSQL 16 is required');
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    await assertLiteralDotTraversalRejected(driver);
    await assertKillSwitchTruthTable(driver, suffix);
    const source = await registeredSource(driver, `${suffix}-ledger`);
    const scheduler = createScheduledAcquisitionStore(driver);
    await assertAtomicClaim(driver, scheduler, source, suffix);
    await assertAtomicTerminalPersistence(driver, scheduler, source, suffix);
    process.stdout.write(
      'OK: PostgreSQL 16 proved literal-dot function/terminal refusal, the monotone kill switch, one-winner concurrent claim, transactional rollback, and durable freshness.\n',
    );
    return 0;
  } finally {
    await driver.close();
  }
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
