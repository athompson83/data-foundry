/**
 * Real-PostgreSQL race regression for source-record reconciliation.
 *
 * This is intentionally not a PGlite test: two independent PostgreSQL pools
 * hold and contend on the transaction-scoped advisory key. It writes only
 * uniquely-named synthetic rows, but must still be pointed at a dedicated test
 * database and explicitly armed by its operator.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createCanonicalStore,
  createPostgresDriver,
  type SqlDriver,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  applyMigrations,
  createPostgresDriver as createMigrationPostgresDriver,
  loadMigrations,
  resolveOperationalSchema,
} from './migrate.js';
import {
  EntityResolver,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import { isMain } from '../lib/cli-entry.js';

const ATTRIBUTION = { required: false, text: null, url: null };
const ROBOTS = {
  respect_robots: true,
  user_agent: 'data-foundry-postgres-regression',
  crawl_delay_seconds: 1,
  disallowed_paths: [],
  allowed_paths: [],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resume) => {
    resolve = resume;
  });
  return {
    promise,
    resolve(value) {
      resolve?.(value);
    },
  };
}

async function waitForAdvisoryLockWait(monitor: SqlDriver): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await monitor.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%pg_advisory_xact_lock%'
       ) AS waiting`,
    );
    if (rows[0]?.waiting === true) return;
    await new Promise<void>((resume) => setTimeout(resume, 20));
  }
  throw new Error('second operation did not block on the PostgreSQL advisory transaction lock');
}

interface SnapshotAcceptanceProbe {
  readonly sourceId: string;
  readonly stream: string;
  readonly observedAt: string;
  readonly snapshotDigest: string;
  readonly artifactId: string;
  readonly retrievalKey: string;
  readonly retrievalReceiptId: string;
}

async function acceptSnapshotProbe(
  driver: SqlDriver,
  candidate: SnapshotAcceptanceProbe,
  onAccepted: (
    tx: SqlTransactionExecutor,
    acceptanceId: string,
  ) => Promise<void> = async () => undefined,
): Promise<boolean> {
  return driver.transaction(async (tx) => {
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtext('source-stream-refresh'), hashtext($1))`,
      [JSON.stringify([candidate.sourceId, candidate.stream])],
    );
    const [latest] = await tx.query<{
      candidate_is_newer: boolean;
    }>(
      `SELECT ($3::timestamptz > observed_at OR
               ($3::timestamptz = observed_at AND
                $4 COLLATE "C" > snapshot_digest COLLATE "C")) AS candidate_is_newer
         FROM source_stream_snapshot_acceptances
        WHERE source_id = $1 AND source_stream = $2
        ORDER BY observed_at DESC, snapshot_digest COLLATE "C" DESC
        LIMIT 1`,
      [candidate.sourceId, candidate.stream, candidate.observedAt, candidate.snapshotDigest],
    );
    if (latest !== undefined && !latest.candidate_is_newer) return false;
    const [acceptance] = await tx.query<{ id: string }>(
      `INSERT INTO source_stream_snapshot_acceptances
         (source_id, source_stream, observed_at, snapshot_digest,
          artifact_set_digest, mapping_digest, record_set_digest, retrieval_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
       RETURNING id`,
      [
        candidate.sourceId,
        candidate.stream,
        candidate.observedAt,
        candidate.snapshotDigest,
        'a'.repeat(64),
        'b'.repeat(64),
        'c'.repeat(64),
      ],
    );
    if (acceptance === undefined) throw new Error('snapshot probe acceptance insert returned no row');
    await tx.query(
      `INSERT INTO source_stream_snapshot_acceptance_artifacts
         (acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id)
       VALUES ($1, $2, $3, $4)`,
      [
        acceptance.id,
        candidate.artifactId,
        candidate.retrievalKey,
        candidate.retrievalReceiptId,
      ],
    );
    await onAccepted(tx, acceptance.id);
    return true;
  });
}

async function artifact(
  store: ReturnType<typeof createCanonicalStore>,
  sourceId: string,
  suffix: string,
) {
  return store.recordSourceArtifact({
    source_id: sourceId as never,
    url: `https://postgres-regression.invalid/${suffix}.json`,
    retrieved_at: '2026-08-30T00:00:00.000Z' as never,
    content_hash: suffix[0]!.repeat(64),
    mime_type: 'application/json',
    r2_uri: `r2://postgres-regression/${suffix}.json`,
    http_status: 200,
    extractor_version: 'postgres-regression@1',
    policy_snapshot_id: null,
    byte_size: 2,
    acquisition_provider: 'http',
    acquisition_route: 'DIRECT_HTTP',
    account_or_product_plan: null,
    acquisition_jurisdiction: null,
  });
}

export async function run(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const connectionString = env['POSTGRES_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error('POSTGRES_URL is required for the real PostgreSQL source-record reconciliation check.');
  }
  if (env['DATA_FOUNDRY_POSTGRES_CONCURRENCY_TEST'] !== '1') {
    throw new Error('Set DATA_FOUNDRY_POSTGRES_CONCURRENCY_TEST=1 for a dedicated synthetic test database.');
  }
  const schema = resolveOperationalSchema(env);

  // The migration ledger transaction spans BEGIN, DDL, INSERT, and COMMIT.
  // Bootstrap with its dedicated single Client, never through an app pool.
  const migrationDriver = await createMigrationPostgresDriver(connectionString, schema);
  try {
    await applyMigrations(migrationDriver, await loadMigrations(), { schema });
  } finally {
    await migrationDriver.close();
  }

  const primaryDriver = await createPostgresDriver(connectionString, { schema });
  const firstDriver = await createPostgresDriver(connectionString, { schema });
  const secondDriver = await createPostgresDriver(connectionString, { schema });
  const monitor = await createPostgresDriver(connectionString, { schema });
  try {
    const primary = createCanonicalStore(primaryDriver);
    const first = createCanonicalStore(firstDriver);
    const second = createCanonicalStore(secondDriver);
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const vertical = await primary.upsertVertical({
      slug: `pg-reconcile-${suffix}`,
      name: 'Synthetic PostgreSQL reconciliation control',
      schema_version: '1.0.0',
      status: 'ACTIVE',
      default_refresh_policy: { cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 },
    });
    const source = await primary.upsertSource({
      vertical_id: vertical.id,
      publisher: 'Synthetic PostgreSQL control publisher',
      domain: `pg-reconcile-${suffix}.invalid`,
      source_type: 'MANUFACTURER',
      authority_rank: 1,
      rights_classification: 'GREEN',
      attribution_requirement: ATTRIBUTION,
      robots_policy: ROBOTS,
      refresh_cadence: 'WEEKLY',
      status: 'ACTIVE',
      kill_switch_engaged: false,
    });
    const entity = await primary.upsertEntity({
      vertical_id: vertical.id,
      entity_type: 'equipment_model',
      canonical_name: `PostgreSQL reconciliation ${suffix}`,
      canonical_slug: `postgresql-reconciliation-${suffix}` as never,
      status: 'ACTIVE',
      quality_score: 0.5 as never,
      first_seen_at: '2026-08-30T00:00:00.000Z' as never,
      last_verified_at: null,
    });
    const initialArtifact = await artifact(primary, source.id, `0${suffix}`);
    const firstArtifact = await artifact(primary, source.id, `1${suffix}`);
    const secondArtifact = await artifact(primary, source.id, `2${suffix}`);
    const key = `concurrent-${suffix}`;
    const initial = await primary.recordSourceRecord({
      source_id: source.id,
      artifact_id: initialArtifact.id,
      source_record_key: key,
      source_stream: 'postgres_records',
      entity_type: 'equipment_model',
      raw_payload: { model: 'INITIAL' },
      normalized_payload: { model: 'INITIAL' },
      extraction_confidence: 1 as never,
      extractor_version: 'postgres-regression@1',
    });
    await primary.recordEntityEvidence({
      entity_id: entity.id,
      artifact_id: initialArtifact.id,
      source_record_id: initial.id,
      contribution_role: 'EXISTENCE',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0',
      observed_at: '2026-08-30T00:00:00.000Z' as never,
    });
    const trackedAlias = await primary.stageSourceAlias({
      entity_id: entity.id,
      alias_type: 'external_id' as never,
      alias_value: `PG-ALIAS-${suffix}`,
      normalized_value: `pg-alias-${suffix}`,
      source_id: source.id,
      identity_confidence: 1 as never,
      valid_from: '2026-08-30T00:00:00.000Z' as never,
      valid_to: null,
    });
    const initialAliasClaim = await primary.recordSourceAliasClaim({
      entity_alias_id: trackedAlias.id,
      asserted_alias_value: `PG-ALIAS-${suffix}`,
      asserted_normalized_value: `pg-alias-${suffix}`,
      identity_confidence: 1 as never,
      source_record_id: initial.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    await primary.recordEntityEvidence({
      entity_id: entity.id,
      artifact_id: initialArtifact.id,
      source_record_id: initial.id,
      entity_alias_claim_id: initialAliasClaim.id,
      contribution_role: 'ALIAS',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
      observed_at: '2026-08-30T00:00:00.000Z' as never,
    });

    const firstReady = deferred<void>();
    const releaseFirst = deferred<void>();
    const firstTransaction = firstDriver.transaction(async (tx) => {
      const revision = await first.reconcileSourceRecord({
        source_id: source.id,
        artifact_id: firstArtifact.id,
        source_record_key: key,
        source_stream: 'postgres_records',
        entity_type: 'equipment_model',
        raw_payload: { model: 'FIRST' },
        normalized_payload: { model: 'FIRST' },
        extraction_confidence: 1 as never,
        extractor_version: 'postgres-regression@1',
      }, tx, '1'.repeat(64), '2026-08-30T00:00:00.000Z' as never);
      await first.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: firstArtifact.id,
        source_record_id: revision.id,
        contribution_role: 'EXISTENCE',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0',
        observed_at: '2026-08-30T00:00:00.000Z' as never,
      }, tx);
      const aliasClaim = await first.recordSourceAliasClaim({
        entity_alias_id: trackedAlias.id,
        asserted_alias_value: `PG-ALIAS-${suffix}`,
        asserted_normalized_value: `pg-alias-${suffix}`,
        identity_confidence: 1 as never,
        source_record_id: revision.id,
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0/model',
      }, tx);
      await first.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: firstArtifact.id,
        source_record_id: revision.id,
        entity_alias_claim_id: aliasClaim.id,
        contribution_role: 'ALIAS',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0/model',
        observed_at: '2026-08-30T00:00:00.000Z' as never,
      }, tx);
      firstReady.resolve();
      await releaseFirst.promise;
      return revision;
    });
    await firstReady.promise;

    const secondTransaction = secondDriver.transaction(async (tx) => {
      const revision = await second.reconcileSourceRecord({
        source_id: source.id,
        artifact_id: secondArtifact.id,
        source_record_key: key,
        source_stream: 'postgres_records',
        entity_type: 'equipment_model',
        raw_payload: { model: 'SECOND' },
        normalized_payload: { model: 'SECOND' },
        extraction_confidence: 1 as never,
        extractor_version: 'postgres-regression@1',
      }, tx, '2'.repeat(64), '2026-08-30T00:00:00.000Z' as never);
      await second.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: secondArtifact.id,
        source_record_id: revision.id,
        contribution_role: 'EXISTENCE',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0',
        observed_at: '2026-08-30T00:00:00.000Z' as never,
      }, tx);
      const aliasClaim = await second.recordSourceAliasClaim({
        entity_alias_id: trackedAlias.id,
        asserted_alias_value: `PG-ALIAS-${suffix}`,
        asserted_normalized_value: `pg-alias-${suffix}`,
        identity_confidence: 1 as never,
        source_record_id: revision.id,
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0/model',
      }, tx);
      await second.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: secondArtifact.id,
        source_record_id: revision.id,
        entity_alias_claim_id: aliasClaim.id,
        contribution_role: 'ALIAS',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0/model',
        observed_at: '2026-08-30T00:00:00.000Z' as never,
      }, tx);
      return revision;
    });
    await waitForAdvisoryLockWait(monitor);
    releaseFirst.resolve();
    const [firstRevision, secondRevision] = await Promise.all([firstTransaction, secondTransaction]);

    // A newer complete snapshot that reaches the stream lock first must make a
    // delayed older snapshot harmless. The rejected candidate's callback would
    // reintroduce membership, so absence here proves the lock/classify boundary
    // rather than merely proving the acceptance ledger order.
    const snapshotKey = `snapshot-concurrent-${suffix}`;
    const snapshotInitial = await primary.recordSourceRecord({
      source_id: source.id,
      artifact_id: initialArtifact.id,
      source_record_key: snapshotKey,
      source_stream: 'snapshot_concurrency',
      entity_type: 'equipment_model',
      raw_payload: { model: 'SNAPSHOT-INITIAL' },
      normalized_payload: { model: 'SNAPSHOT-INITIAL' },
      extraction_confidence: 1 as never,
      extractor_version: 'postgres-regression@1',
    });
    const newerReady = deferred<void>();
    const releaseNewer = deferred<void>();
    const newerSnapshot = acceptSnapshotProbe(firstDriver, {
      sourceId: source.id,
      stream: 'snapshot_concurrency',
      observedAt: '2026-09-02T00:00:00.000Z',
      snapshotDigest: 'e'.repeat(64),
      artifactId: secondArtifact.id,
      retrievalKey: `snapshot/${suffix}/newer`,
      retrievalReceiptId: 'e'.repeat(64),
    }, async (tx, acceptanceId) => {
      await tx.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [snapshotInitial.id]);
      await tx.query(
        `INSERT INTO source_record_snapshot_retirements
           (source_record_id, snapshot_acceptance_id, artifact_id,
            source_id, source_stream, retired_at)
         VALUES ($1, $2, $3, $4, 'snapshot_concurrency', $5)`,
        [
          snapshotInitial.id,
          acceptanceId,
          secondArtifact.id,
          source.id,
          '2026-09-02T00:00:00.000Z',
        ],
      );
      newerReady.resolve();
      await releaseNewer.promise;
    });
    await newerReady.promise;
    const delayedOlderSnapshot = acceptSnapshotProbe(secondDriver, {
      sourceId: source.id,
      stream: 'snapshot_concurrency',
      observedAt: '2026-09-01T00:00:00.000Z',
      snapshotDigest: 'f'.repeat(64),
      artifactId: firstArtifact.id,
      retrievalKey: `snapshot/${suffix}/delayed-older`,
      retrievalReceiptId: 'f'.repeat(64),
    }, async (tx) => {
      await second.reconcileSourceRecord({
        source_id: source.id,
        artifact_id: firstArtifact.id,
        source_record_key: snapshotKey,
        source_stream: 'snapshot_concurrency',
        entity_type: 'equipment_model',
        raw_payload: { model: 'STALE-REINTRODUCTION' },
        normalized_payload: { model: 'STALE-REINTRODUCTION' },
        extraction_confidence: 1 as never,
        extractor_version: 'postgres-regression@1',
      }, tx, 'f'.repeat(64), '2026-09-01T00:00:00.000Z' as never);
    });
    await waitForAdvisoryLockWait(monitor);
    releaseNewer.resolve();
    assert.deepEqual(
      await Promise.all([newerSnapshot, delayedOlderSnapshot]),
      [true, false],
      'newer snapshot must commit while the delayed older candidate is rejected',
    );
    assert.equal(
      (await primaryDriver.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM source_records
          WHERE source_id = $1 AND source_record_key = $2 AND is_current`,
        [source.id, snapshotKey],
      ))[0]?.count,
      0,
      'the delayed older snapshot must not reintroduce retired membership',
    );

    // Equal observation times converge on the greatest C-collated digest in
    // both lock arrival orders.
    for (const highArrivesFirst of [false, true]) {
      const stream = highArrivesFirst ? 'snapshot_tie_high_first' : 'snapshot_tie_low_first';
      const heldReady = deferred<void>();
      const releaseHeld = deferred<void>();
      const low = {
        sourceId: source.id,
        stream,
        observedAt: '2026-09-03T00:00:00.000Z',
        snapshotDigest: '1'.repeat(64),
        artifactId: firstArtifact.id,
        retrievalKey: `snapshot/${suffix}/${stream}/low`,
        retrievalReceiptId: '1'.repeat(64),
      };
      const high = {
        ...low,
        snapshotDigest: 'f'.repeat(64),
        artifactId: secondArtifact.id,
        retrievalKey: `snapshot/${suffix}/${stream}/high`,
        retrievalReceiptId: '2'.repeat(64),
      };
      const held = acceptSnapshotProbe(
        firstDriver,
        highArrivesFirst ? high : low,
        async () => {
          heldReady.resolve();
          await releaseHeld.promise;
        },
      );
      await heldReady.promise;
      const waiter = acceptSnapshotProbe(secondDriver, highArrivesFirst ? low : high);
      await waitForAdvisoryLockWait(monitor);
      releaseHeld.resolve();
      await Promise.all([held, waiter]);
      const [latest] = await primaryDriver.query<{ snapshot_digest: string }>(
        `SELECT snapshot_digest FROM source_stream_snapshot_acceptances
          WHERE source_id = $1 AND source_stream = $2
          ORDER BY observed_at DESC, snapshot_digest COLLATE "C" DESC
          LIMIT 1`,
        [source.id, stream],
      );
      assert.equal(
        latest?.snapshot_digest,
        high.snapshotDigest,
        `equal-time ${stream} candidates must converge on the greatest digest`,
      );
    }

    // Two independent clients racing the same natural claim key must converge
    // on one immutable row rather than producing duplicates or rewriting it.
    const racedAlias = await primary.stageSourceAlias({
      entity_id: entity.id,
      alias_type: 'external_id' as never,
      alias_value: `PG-RACED-${suffix}`,
      normalized_value: `pg-raced-${suffix}`,
      source_id: source.id,
      identity_confidence: 1 as never,
      valid_from: '2026-08-30T00:00:00.000Z' as never,
      valid_to: null,
    });
    const raceInput = {
      entity_alias_id: racedAlias.id,
      asserted_alias_value: `PG-RACED-${suffix}`,
      asserted_normalized_value: `pg-raced-${suffix}`,
      identity_confidence: 1 as never,
      source_record_id: secondRevision.id,
      locator_type: 'JSON_POINTER' as const,
      locator_value: '/products/0/model',
    };
    const [firstClaim, secondClaim] = await Promise.all([
      first.recordSourceAliasClaim(raceInput),
      second.recordSourceAliasClaim(raceInput),
    ]);
    await primary.recordEntityEvidence({
      entity_id: entity.id,
      artifact_id: secondArtifact.id,
      source_record_id: secondRevision.id,
      entity_alias_claim_id: firstClaim.id,
      contribution_role: 'ALIAS',
      locator_type: raceInput.locator_type,
      locator_value: raceInput.locator_value,
      observed_at: '2026-08-30T00:00:00.000Z' as never,
    });

    // A curated assertion is also a retried natural-key write. Both callers
    // must observe the same alias even when one statement waits on the other's
    // claim insertion; a statement-start snapshot must not turn that wait into
    // a false "RETURNING produced no row" failure.
    const curatedInput = {
      entity_id: entity.id,
      alias_type: 'external_id' as never,
      alias_value: `PG-CURATED-${suffix}`,
      normalized_value: `pg-curated-${suffix}`,
      source_id: null,
      identity_confidence: 1 as never,
      valid_from: '2026-08-30T00:00:00.000Z' as never,
      valid_to: null,
    } as const;
    const [firstCuratedAlias, secondCuratedAlias] = await Promise.all([
      first.addAlias(curatedInput),
      second.addAlias(curatedInput),
    ]);

    const resolverConfig = await loadVerticalConfig('hvac');
    const resolverAlias = {
      aliasType: 'model_number' as never,
      aliasValue: `CONCURRENT-RESOLVER-${suffix}`,
      normalizedValue: `CONCURRENT-RESOLVER-${suffix}`,
      strong: true,
      locatorType: 'JSON_POINTER' as never,
      locatorValue: '/model',
    } as const;
    const primaryResolver = new EntityResolver({
      store: primary,
      config: resolverConfig,
      verticalId: vertical.id,
      now: '2026-08-30T00:00:00.000Z' as never,
      authorityBySourceId: new Map(),
    });
    const occupiedSlug = primaryResolver.previewCanonicalSlug(
      'equipment_model' as never,
      [resolverAlias],
      null,
    );
    await primary.upsertEntity({
      vertical_id: vertical.id,
      entity_type: 'equipment_model' as never,
      canonical_name: `Historical slug owner ${suffix}`,
      canonical_slug: occupiedSlug as never,
      status: 'ACTIVE',
      quality_score: 0.5 as never,
      first_seen_at: '2026-08-01T00:00:00.000Z' as never,
      last_verified_at: null,
    });
    const firstResolverRecord = await primary.recordSourceRecord({
      source_id: source.id,
      artifact_id: firstArtifact.id,
      source_record_key: `resolver-race-a-${suffix}`,
      source_stream: 'postgres_records',
      entity_type: 'equipment_model',
      raw_payload: { model: resolverAlias.aliasValue },
      normalized_payload: { model: resolverAlias.normalizedValue },
      extraction_confidence: 1 as never,
      extractor_version: 'postgres-regression@1',
    });
    const secondResolverRecord = await primary.recordSourceRecord({
      source_id: source.id,
      artifact_id: secondArtifact.id,
      source_record_key: `resolver-race-b-${suffix}`,
      source_stream: 'postgres_records',
      entity_type: 'equipment_model',
      raw_payload: { model: resolverAlias.aliasValue },
      normalized_payload: { model: resolverAlias.normalizedValue },
      extraction_confidence: 1 as never,
      extractor_version: 'postgres-regression@1',
    });
    const firstResolver = new EntityResolver({
      store: first,
      config: resolverConfig,
      verticalId: vertical.id,
      now: '2026-08-30T00:00:00.000Z' as never,
      authorityBySourceId: new Map(),
    });
    const secondResolver = new EntityResolver({
      store: second,
      config: resolverConfig,
      verticalId: vertical.id,
      now: '2026-08-30T00:00:00.000Z' as never,
      authorityBySourceId: new Map(),
    });
    const [firstResolved, secondResolved] = await Promise.all([
      firstResolver.resolveRecord({
        entityType: 'equipment_model' as never,
        aliases: [resolverAlias],
        manufacturer: null,
        sourceId: source.id,
        sourceRecordId: firstResolverRecord.id,
      }),
      secondResolver.resolveRecord({
        entityType: 'equipment_model' as never,
        aliases: [resolverAlias],
        manufacturer: null,
        sourceId: source.id,
        sourceRecordId: secondResolverRecord.id,
      }),
    ]);

    const revisions = await primaryDriver.query<{
      id: string;
      artifact_id: string;
      is_current: boolean;
      revision_state: string;
    }>(
      `SELECT id, artifact_id, is_current, revision_state
         FROM source_records WHERE source_id = $1 AND source_record_key = $2
         ORDER BY created_at, id`,
      [source.id, key],
    );
    const links = await primaryDriver.query<{
      superseded_source_record_id: string;
      replacement_source_record_id: string;
    }>(
      `SELECT superseded_source_record_id, replacement_source_record_id
         FROM source_record_reconciliations
        WHERE superseded_source_record_id IN ($1, $2)
        ORDER BY CASE superseded_source_record_id
          WHEN $1 THEN 0
          WHEN $2 THEN 1
        END`,
      [initial.id, firstRevision.id],
    );
    const evidence = await primaryDriver.query<{
      expected_artifact_id: string;
      artifact_id: string;
    }>(
      `SELECT record.artifact_id AS expected_artifact_id, evidence.artifact_id
       FROM entity_evidence evidence
         JOIN source_records record ON record.id = evidence.source_record_id
        WHERE record.source_id = $1
          AND record.source_record_key = $2
          AND evidence.contribution_role = 'EXISTENCE'`,
      [source.id, key],
    );
    const aliasClaims = await primaryDriver.query<{
      entity_alias_id: string;
      source_record_id: string;
    }>(
      `SELECT entity_alias_id, source_record_id
         FROM entity_alias_claims
        WHERE entity_alias_id IN ($1, $2)
        ORDER BY entity_alias_id, created_at, id`,
      [trackedAlias.id, racedAlias.id],
    );
    const currentAliases = await primaryDriver.query<{ id: string }>(
      `SELECT id FROM current_entity_aliases WHERE id IN ($1, $2) ORDER BY id`,
      [trackedAlias.id, racedAlias.id],
    );
    const curatedClaims = await primaryDriver.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM entity_alias_claims
        WHERE entity_alias_id = $1 AND claim_kind = 'CURATED'`,
      [firstCuratedAlias.id],
    );

    assert.equal(revisions.length, 3, 'two concurrent replacements must retain the initial and both immutable successors');
    assert.equal(revisions.filter((row) => row.is_current).length, 1, 'exactly one revision must remain current');
    assert.equal(revisions.find((row) => row.is_current)?.id, secondRevision.id);
    assert.deepEqual(revisions.map((row) => row.revision_state), ['FINALIZED', 'FINALIZED', 'FINALIZED']);
    assert.deepEqual(links, [
      { superseded_source_record_id: initial.id, replacement_source_record_id: firstRevision.id },
      { superseded_source_record_id: firstRevision.id, replacement_source_record_id: secondRevision.id },
    ]);
    assert.equal(evidence.length, 3, 'each immutable revision must retain its own evidence');
    assert.ok(evidence.every((row) => row.artifact_id === row.expected_artifact_id));
    assert.equal(firstClaim.id, secondClaim.id, 'concurrent retries must return one natural claim row');
    assert.equal(
      firstCuratedAlias.id,
      secondCuratedAlias.id,
      'concurrent curated retries must return one natural alias row',
    );
    assert.equal(curatedClaims[0]?.count, 1, 'concurrent curated retries must insert one claim');
    assert.equal(
      firstResolved.entity.id,
      secondResolved.entity.id,
      'concurrent exact resolver claims must converge behind a historical slug owner',
    );
    assert.equal(
      aliasClaims.filter((claim) => claim.entity_alias_id === trackedAlias.id).length,
      3,
      'each immutable source-record revision must retain its own alias claim',
    );
    assert.equal(
      aliasClaims.filter((claim) => claim.entity_alias_id === racedAlias.id).length,
      1,
      'the concurrent natural-key retry must insert exactly one claim',
    );
    assert.deepEqual(
      currentAliases.map((alias) => alias.id).sort(),
      [trackedAlias.id, racedAlias.id].sort(),
      'only exact evidence-linked claims backed by the surviving current source-record revision should keep aliases current',
    );
    process.stdout.write(
      'OK: PostgreSQL serialized source-record revisions and snapshot watermarks, rejected delayed membership, resolved equal-time inversions, and converged concurrent alias and resolver retries.\n',
    );
    return 0;
  } finally {
    await Promise.all([primaryDriver.close(), firstDriver.close(), secondDriver.close(), monitor.close()]);
  }
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
