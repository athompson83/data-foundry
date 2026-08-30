/** Real-PostgreSQL controls for the scheduled acquisition ledger. */
import assert from 'node:assert/strict';
import type { SourceArtifactInsert } from '@data-foundry/canonical-schema';
import {
  createCanonicalStore,
  createPostgresDriver,
  createScheduledAcquisitionStore,
  ScheduledAcquisitionClaimOwnershipError,
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

async function observedDatabaseTime(
  driver: SqlDriver,
  strictlyAfter?: ScheduledAcquisitionRun['claimedAt'],
): Promise<ScheduledAcquisitionRun['claimedAt']> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const rows = await driver.query<{ observed_at: string | Date }>(
      'SELECT statement_timestamp() AS observed_at',
    );
    const raw = rows[0]?.observed_at;
    if (raw === undefined) throw new Error('PostgreSQL returned no server-clock observation');
    const observed = iso(
      new Date(raw instanceof Date ? raw.getTime() : raw).toISOString(),
    );
    if (strictlyAfter === undefined || Date.parse(observed) > Date.parse(strictlyAfter)) {
      return observed;
    }
  }
  throw new Error('PostgreSQL server clock did not advance beyond the claim timestamp');
}

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
  const initialAt = await observedDatabaseTime(driver, run.claimLeaseAcquiredAt);
  const admitted = await authorizeStoredAcquisition(
    driver,
    scope,
    initialAt,
  );
  return [
    admitted.receipt,
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      await observedDatabaseTime(driver),
      'PRE_PROVIDER',
    ),
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      await observedDatabaseTime(driver),
      'PRE_TRANSPORT',
    ),
    await recheckStoredAcquisition(
      admitted.capability,
      driver,
      await observedDatabaseTime(driver),
      'PRE_PERSISTENCE',
    ),
  ];
}

function artifactFor(
  run: ScheduledAcquisitionRun,
  contentHash: string,
  retrievedAt: ScheduledAcquisitionRun['claimedAt'],
): SourceArtifactInsert {
  return {
    source_id: run.sourceId,
    url: run.targetUrl,
    retrieved_at: retrievedAt,
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

async function assertLeaseRecoveryAndFencing(
  driver: SqlDriver,
  scheduler: ScheduledAcquisitionStore,
  source: Awaited<ReturnType<typeof registeredSource>>,
  suffix: string,
): Promise<void> {
  const input = claimFor(
    `${suffix}-lease-recovery`,
    source,
    '2026-08-28T17:15:00.000Z',
  );
  const acquired = await scheduler.acquire(input);
  assert.equal(acquired.disposition, 'ACQUIRED');
  assert.equal(acquired.run.claimAttempt, 1);

  const repeated = await scheduler.acquire(input);
  assert.equal(repeated.disposition, 'ACTIVE');
  assert.deepEqual(Object.keys(repeated.run).sort(), ['claimAttempt', 'id', 'retryAt', 'status']);
  assert.deepEqual(repeated.run, {
    id: acquired.run.id,
    status: 'CLAIMED',
    claimAttempt: acquired.run.claimAttempt,
    retryAt: acquired.run.claimLeaseExpiresAt,
  });
  assert.equal(JSON.stringify(repeated).includes(acquired.run.claimToken), false);
  const recovered = await scheduler.get(repeated.run.id);
  assert.ok(recovered);
  assert.equal(Object.hasOwn(recovered, 'claimToken'), false);
  assert.equal(JSON.stringify(recovered).includes(acquired.run.claimToken), false);
  const exposedUuidValues = [
    ...new Set(
      JSON.stringify([repeated.run, recovered]).match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      ) ?? [],
    ),
  ];
  assert.ok(exposedUuidValues.includes(acquired.run.id));
  assert.equal(exposedUuidValues.includes(acquired.run.claimToken), false);
  const attemptedAt = await observedDatabaseTime(driver);
  for (const exposedValue of exposedUuidValues) {
    await assert.rejects(
      scheduler.assertLease(acquired.run.id, exposedValue),
      ScheduledAcquisitionClaimOwnershipError,
    );
    assert.equal(await scheduler.release({
      runId: acquired.run.id,
      claimToken: exposedValue,
      reason: 'UNEXPECTED_ERROR',
    }), null);
    await assert.rejects(
      scheduler.fail({
        runId: acquired.run.id,
        claimToken: exposedValue,
        status: 'FAILED',
        outcome: null,
        failureCode: 'INTERNAL_ERROR',
        completedAt: attemptedAt,
        rightsReceipt: [],
        provider: null,
      }),
      ScheduledAcquisitionClaimOwnershipError,
    );
    await assert.rejects(
      scheduler.complete({
        runId: acquired.run.id,
        claimToken: exposedValue,
        outcome: 'NOT_MODIFIED',
        completedAt: attemptedAt,
        freshAt: attemptedAt,
        provider: 'http',
        validators: { etag: '"redaction-control"' },
        rightsReceipt: [],
        artifacts: [],
      }),
      ScheduledAcquisitionClaimOwnershipError,
    );
  }
  await scheduler.assertLease(acquired.run.id, acquired.run.claimToken);

  const released = await scheduler.release({
    runId: acquired.run.id,
    claimToken: acquired.run.claimToken,
    reason: 'UNEXPECTED_ERROR',
  });
  assert.ok(released);
  assert.equal(released.id, acquired.run.id);
  assert.equal(released.claimToken, acquired.run.claimToken);
  assert.equal(released.claimAttempt, acquired.run.claimAttempt);
  assert.equal(released.lastReleasedAttempt, acquired.run.claimAttempt);
  assert.equal(released.lastClaimReleaseReason, 'UNEXPECTED_ERROR');
  assert.equal(released.lastClaimReleasedAt, released.claimLeaseExpiresAt);
  await assert.rejects(
    scheduler.assertLease(acquired.run.id, acquired.run.claimToken),
    ScheduledAcquisitionClaimOwnershipError,
  );

  const reacquired = await scheduler.acquire(input);
  assert.equal(reacquired.disposition, 'ACQUIRED');
  assert.equal(reacquired.run.id, acquired.run.id);
  assert.notEqual(reacquired.run.claimToken, acquired.run.claimToken);
  assert.equal(reacquired.run.claimAttempt, acquired.run.claimAttempt + 1);
  assert.equal(reacquired.run.lastReleasedAttempt, acquired.run.claimAttempt);
  assert.equal(reacquired.run.lastClaimReleaseReason, 'UNEXPECTED_ERROR');
  await scheduler.assertLease(reacquired.run.id, reacquired.run.claimToken);

  const rightsReceipt = await receiptsFor(driver, reacquired.run);
  const staleAttemptedAt = await observedDatabaseTime(driver);
  await assert.rejects(
    scheduler.assertLease(reacquired.run.id, acquired.run.claimToken),
    ScheduledAcquisitionClaimOwnershipError,
  );
  assert.equal(
    await scheduler.release({
      runId: reacquired.run.id,
      claimToken: acquired.run.claimToken,
      reason: 'UNEXPECTED_ERROR',
    }),
    null,
  );
  await assert.rejects(
    scheduler.fail({
      runId: reacquired.run.id,
      claimToken: acquired.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: staleAttemptedAt,
      rightsReceipt,
      provider: null,
    }),
    ScheduledAcquisitionClaimOwnershipError,
  );
  await assert.rejects(
    scheduler.complete({
      runId: reacquired.run.id,
      claimToken: acquired.run.claimToken,
      outcome: 'NOT_MODIFIED',
      completedAt: staleAttemptedAt,
      freshAt: staleAttemptedAt,
      provider: 'http',
      validators: { etag: '"lease-control"' },
      rightsReceipt,
      artifacts: [],
    }),
    ScheduledAcquisitionClaimOwnershipError,
  );
  await scheduler.assertLease(reacquired.run.id, reacquired.run.claimToken);

  const terminalAt = await observedDatabaseTime(driver);
  const terminal = await scheduler.fail({
    runId: reacquired.run.id,
    claimToken: reacquired.run.claimToken,
    status: 'FAILED',
    outcome: null,
    failureCode: 'INTERNAL_ERROR',
    completedAt: terminalAt,
    rightsReceipt,
    provider: null,
  });
  assert.equal(terminal.status, 'FAILED');
  assert.equal(terminal.id, acquired.run.id);
  assert.equal(terminal.claimToken, reacquired.run.claimToken);
  assert.equal(terminal.claimAttempt, acquired.run.claimAttempt + 1);

  const terminalObservation = await scheduler.acquire(input);
  assert.equal(terminalObservation.disposition, 'TERMINAL');
  assert.deepEqual(Object.keys(terminalObservation.run).sort(), ['claimAttempt', 'id', 'retryAt', 'status']);
  assert.deepEqual(terminalObservation.run, {
    id: terminal.id,
    status: 'FAILED',
    claimAttempt: terminal.claimAttempt,
    retryAt: null,
  });
  assert.equal(JSON.stringify(terminalObservation).includes(terminal.claimToken), false);

  const concurrentInput = claimFor(
    `${suffix}-concurrent-reclaim`,
    source,
    '2026-08-28T17:30:00.000Z',
  );
  const concurrentInitial = await scheduler.acquire(concurrentInput);
  assert.equal(concurrentInitial.disposition, 'ACQUIRED');
  assert.ok(await scheduler.release({
    runId: concurrentInitial.run.id,
    claimToken: concurrentInitial.run.claimToken,
    reason: 'UNEXPECTED_ERROR',
  }));

  const concurrentResults = await Promise.all(
    Array.from({ length: 8 }, () => scheduler.acquire(concurrentInput)),
  );
  const winners = concurrentResults.filter((result) => result.disposition === 'ACQUIRED');
  const active = concurrentResults.filter((result) => result.disposition === 'ACTIVE');
  assert.equal(winners.length, 1, 'exactly one concurrent post-release claimant must reacquire');
  assert.equal(active.length, 7, 'all losing post-release claimants must observe the active owner');
  const winner = winners[0]!;
  assert.equal(winner.run.id, concurrentInitial.run.id);
  assert.notEqual(winner.run.claimToken, concurrentInitial.run.claimToken);
  assert.equal(winner.run.claimAttempt, concurrentInitial.run.claimAttempt + 1);
  for (const observed of active) {
    assert.deepEqual(observed.run, {
      id: winner.run.id,
      status: 'CLAIMED',
      claimAttempt: winner.run.claimAttempt,
      retryAt: winner.run.claimLeaseExpiresAt,
    });
    assert.equal(JSON.stringify(observed).includes(winner.run.claimToken), false);
  }
  const winnerReceipt = await receiptsFor(driver, winner.run);
  const winnerTerminalAt = await observedDatabaseTime(driver);
  const winnerTerminal = await scheduler.fail({
    runId: winner.run.id,
    claimToken: winner.run.claimToken,
    status: 'FAILED',
    outcome: null,
    failureCode: 'INTERNAL_ERROR',
    completedAt: winnerTerminalAt,
    rightsReceipt: winnerReceipt,
    provider: null,
  });
  assert.equal(winnerTerminal.status, 'FAILED');
  await assert.rejects(
    scheduler.assertLease(winner.run.id, winner.run.claimToken),
    ScheduledAcquisitionClaimOwnershipError,
  );
  const stored = await driver.query<{ count: number; claimed_count: number }>(
    `SELECT count(*)::INTEGER AS count,
            count(*) FILTER (WHERE status = 'CLAIMED')::INTEGER AS claimed_count
       FROM scheduled_acquisition_runs WHERE idempotency_key = $1`,
    [concurrentInput.idempotencyKey],
  );
  assert.equal(stored[0]?.count, 1, 'reclaim must retain exactly one durable run row');
  assert.equal(stored[0]?.claimed_count, 0, 'the concurrent reclaim winner must be terminal');
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
  const failedFreshAt = await observedDatabaseTime(driver);
  const failedCompletedAt = await observedDatabaseTime(driver);
  const before = await driver.query<{ count: number }>(
    'SELECT count(*)::INTEGER AS count FROM source_artifacts',
  );
  await assert.rejects(
    scheduler.complete({
      runId: failedRun.id,
      claimToken: failedRun.claimToken,
      outcome: 'FETCHED',
      completedAt: failedCompletedAt,
      freshAt: failedFreshAt,
      provider: 'http',
      validators: {},
      rightsReceipt: failedReceipts,
      artifacts: [
        scheduledArtifact(failedRun, artifactFor(failedRun, 'b'.repeat(64), failedFreshAt)),
        scheduledArtifact(failedRun, artifactFor(failedRun, 'not-a-content-hash', failedFreshAt)),
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
  const successfulReceipt = await receiptsFor(driver, successfulRun);
  const successfulFreshAt = await observedDatabaseTime(driver);
  const successfulCompletedAt = await observedDatabaseTime(driver);
  const completed = await scheduler.complete({
    runId: successfulRun.id,
    claimToken: successfulRun.claimToken,
    outcome: 'FETCHED',
    completedAt: successfulCompletedAt,
    freshAt: successfulFreshAt,
    provider: 'http',
    validators: { etag: '"postgres-v1"' },
    rightsReceipt: successfulReceipt,
    artifacts: [scheduledArtifact(
      successfulRun,
      artifactFor(successfulRun, 'c'.repeat(64), successfulFreshAt),
    )],
  });
  assert.equal(completed.status, 'SUCCEEDED');
  assert.equal(completed.artifactCount, 1);
  const latest = await scheduler.latestSuccess(successfulRun);
  assert.ok(latest);
  assert.equal(Object.hasOwn(latest, 'claimToken'), false);
  assert.equal(JSON.stringify(latest).includes(successfulRun.claimToken), false);
  assert.equal(
    await scheduler.latestSuccessAt(successfulRun),
    successfulFreshAt,
  );

  const legacyRun = await scheduler.claim({
    ...claimFor(`${suffix}-legacy-literal-dot`, source, '2026-08-28T20:00:00.000Z'),
    acquisitionRoute: 'BROWSER_RUN',
  });
  assert.ok(legacyRun);
  const legacyArtifactAt = await observedDatabaseTime(driver, legacyRun.claimLeaseAcquiredAt);
  const maliciousArtifact = artifactFor(legacyRun, 'd'.repeat(64), legacyArtifactAt);
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
  const legacyReceipt = await receiptsFor(driver, legacyRun);
  const legacyFreshAt = await observedDatabaseTime(driver);
  const legacyCompletedAt = await observedDatabaseTime(driver);
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
        legacyCompletedAt,
        legacyFreshAt,
        JSON.stringify(legacyReceipt),
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
    await assertLeaseRecoveryAndFencing(driver, scheduler, source, suffix);
    process.stdout.write(
      'OK: PostgreSQL 16 proved literal-dot function/terminal refusal, the monotone kill switch, one-winner claims, server-clock lease recovery, stale-owner fencing, transactional rollback, and durable freshness.\n',
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
