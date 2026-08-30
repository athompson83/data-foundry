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
} from '@data-foundry/canonical-store';
import {
  applyMigrations,
  loadMigrations,
  type MigrationDriver,
} from './migrate.js';
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

function migrationDriver(driver: SqlDriver): MigrationDriver {
  return {
    label: driver.label,
    exec: (sql) => driver.exec(sql),
    query: async <T>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await driver.query(sql, params as never)) as T[],
    close: async () => undefined,
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
  throw new Error('second reconciliation did not block on the PostgreSQL advisory transaction lock');
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

  const primaryDriver = await createPostgresDriver(connectionString);
  const firstDriver = await createPostgresDriver(connectionString);
  const secondDriver = await createPostgresDriver(connectionString);
  const monitor = await createPostgresDriver(connectionString);
  try {
    await applyMigrations(migrationDriver(primaryDriver), await loadMigrations());
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

    const firstReady = deferred<void>();
    const releaseFirst = deferred<void>();
    const firstTransaction = firstDriver.transaction(async (tx) => {
      const revision = await first.reconcileSourceRecord({
        source_id: source.id,
        artifact_id: firstArtifact.id,
        source_record_key: key,
        entity_type: 'equipment_model',
        raw_payload: { model: 'FIRST' },
        normalized_payload: { model: 'FIRST' },
        extraction_confidence: 1 as never,
        extractor_version: 'postgres-regression@1',
      }, tx, '1'.repeat(64));
      await first.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: firstArtifact.id,
        source_record_id: revision.id,
        contribution_role: 'EXISTENCE',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0',
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
        entity_type: 'equipment_model',
        raw_payload: { model: 'SECOND' },
        normalized_payload: { model: 'SECOND' },
        extraction_confidence: 1 as never,
        extractor_version: 'postgres-regression@1',
      }, tx, '2'.repeat(64));
      await second.recordEntityEvidence({
        entity_id: entity.id,
        artifact_id: secondArtifact.id,
        source_record_id: revision.id,
        contribution_role: 'EXISTENCE',
        locator_type: 'JSON_POINTER',
        locator_value: '/products/0',
        observed_at: '2026-08-30T00:00:00.000Z' as never,
      }, tx);
      return revision;
    });
    await waitForAdvisoryLockWait(monitor);
    releaseFirst.resolve();
    const [firstRevision, secondRevision] = await Promise.all([firstTransaction, secondTransaction]);

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
        WHERE record.source_id = $1 AND record.source_record_key = $2`,
      [source.id, key],
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
    process.stdout.write(
      'OK: PostgreSQL serialized two source-record reconciliations and retained one current revision, a complete immutable chain, and artifact-consistent evidence.\n',
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
