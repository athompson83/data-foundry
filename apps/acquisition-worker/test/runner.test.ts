import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryObjectClient,
  ManualClock,
  R2ArtifactStore,
  artifactRetrievalReceiptId,
  type AcquisitionRuntime,
  type Clock,
  type FetchLike,
} from '@data-foundry/acquisition';
import {
  createCanonicalStore,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
} from '@data-foundry/canonical-store';
import { toSourceInsert } from '@data-foundry/source-registry';
import { createFixtures, type Fixtures } from '../../../packages/canonical-store/test/support.js';
import { stubFetch } from '../../../packages/acquisition/test/helpers.js';
import { seedAcquisitionRights } from '../../../tests/support/acquisition-rights.js';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import { runScheduledAcquisition } from '../src/runner.js';

const SLOT = '2026-08-28T17:00:00.000Z';
const NEXT_SLOT = '2026-08-28T18:00:00.000Z';
const REFRESH_SLOT = '2026-09-28T17:00:00.000Z';
const BASE_RUNTIME = ACQUISITION_RUNTIMES['hvac']!;
let fixtures: Fixtures;

beforeEach(async () => {
  fixtures = await createFixtures({ trigram: false });
});

afterEach(async () => fixtures?.driver.close());

function runtimeFor(index = 0): AcquisitionRuntime {
  const target = BASE_RUNTIME.targets[index];
  if (target === undefined) throw new Error(`missing synthetic runtime target ${index}`);
  return { ...BASE_RUNTIME, targets: [target] };
}

async function authorizeRuntime(runtime: AcquisitionRuntime): Promise<string> {
  const target = runtime.targets[0]!;
  const canonical = createCanonicalStore(fixtures.driver);
  const vertical = await canonical.upsertVertical({
    slug: runtime.vertical_slug,
    name: runtime.vertical_name,
    schema_version: runtime.vertical_schema_version,
    status: runtime.vertical_status,
    default_refresh_policy: runtime.default_refresh_policy,
  });
  const source = await canonical.upsertSource(toSourceInsert(target.source, vertical.id));
  await seedAcquisitionRights({
    driver: fixtures.driver,
    sourceId: source.id,
    acquisitionRoute: target.source.acquisition_policy.method,
    assetClass: target.asset_class,
    outputClass: target.output_class,
  });
  return source.id;
}

class SteppingClock implements Clock {
  #now: number;
  lastIso: string;

  constructor(start: string) {
    this.#now = Date.parse(start);
    this.lastIso = new Date(this.#now).toISOString();
  }

  now(): number {
    return this.#now;
  }

  nowIso(): string {
    this.lastIso = new Date(this.#now).toISOString();
    this.#now += 1_000;
    return this.lastIso;
  }

  sleep(ms: number): Promise<void> {
    this.#now += Math.max(0, ms);
    return Promise.resolve();
  }
}

async function activateStickyDeny(
  driver: SqlDriver,
  sourceId: string,
  occurredAt: string,
): Promise<void> {
  const current = await driver.query<{ cell_id: string; decision_id: string }>(
    `SELECT cell.id AS cell_id, active.decision_id
       FROM rights_cells cell
       JOIN LATERAL (
         SELECT event.decision_id
           FROM rights_decision_activation_events event
          WHERE event.cell_id = cell.id
          ORDER BY event.sequence_no DESC LIMIT 1
       ) active ON TRUE
      WHERE cell.source_id = $1
        AND cell.operation = 'ACQUIRE'
        AND cell.channel = 'INTERNAL_PROCESSING'`,
    [sourceId],
  );
  const prior = current[0];
  if (prior === undefined) throw new Error('test fixture has no active ACQUIRE decision');
  const decisionId = crypto.randomUUID();
  await driver.query(
    `INSERT INTO rights_decisions
       (id, cell_id, state, review_status, reviewer_type, reviewed_by, reviewed_at,
        effective_from, recheck_at, rationale, supersedes_decision_id, created_by)
     VALUES ($1, $2, 'DENY', 'APPROVED', 'HUMAN', 'test-fixture', $3,
             $3, '2027-08-01T00:00:00.000Z', 'explicit scheduler revocation test',
             $4, 'test-fixture')`,
    [decisionId, prior.cell_id, occurredAt, prior.decision_id],
  );
  await driver.query(
    `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture',
                                     'activate scheduler revocation test', $2)`,
    [decisionId, occurredAt],
  );
}

function denyOnRightsLoad(
  driver: SqlDriver,
  sourceId: string,
  loadNumber: number,
  clock: SteppingClock,
): SqlDriver {
  let rightsLoads = 0;
  return {
    label: driver.label,
    dialect: driver.dialect,
    exec: (sql) => driver.exec(sql),
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<R[]> {
      if (sql.includes('FROM sources s')) {
        rightsLoads += 1;
        if (rightsLoads === loadNumber) {
          await activateStickyDeny(driver, sourceId, clock.lastIso);
        }
      }
      return driver.query<R>(sql, params);
    },
    transaction: (fn) => driver.transaction(fn),
    close: () => Promise.resolve(),
  };
}

const artifactStore = (objects: InMemoryObjectClient) =>
  new R2ArtifactStore({ bucket: 'test-raw', client: objects });

describe('scheduled acquisition runner', () => {
  it('durably refuses all four synthetic targets without grants and makes duplicate Cron a no-op', async () => {
    const objects = new InMemoryObjectClient();
    const network = vi.fn<FetchLike>(() => Promise.reject(new Error('network must not run')));
    const input = {
      driver: fixtures.driver,
      runtime: BASE_RUNTIME,
      scheduledFor: SLOT,
      clock: new ManualClock(SLOT),
      artifactStore: artifactStore(objects),
      env: {},
      fetch: network,
    } as const;
    const first = await runScheduledAcquisition(input);
    const duplicate = await runScheduledAcquisition(input);

    expect(first.executions).toHaveLength(4);
    expect(first.executions.every(({ disposition }) => disposition === 'REFUSED')).toBe(true);
    expect(duplicate.executions.every(({ disposition }) => disposition === 'DUPLICATE')).toBe(true);
    expect(network).not.toHaveBeenCalled();
    expect(objects.writes).toEqual([]);
    expect(await fixtures.driver.query<{ status: string; count: number }>(
      `SELECT status, count(*)::INTEGER AS count
         FROM scheduled_acquisition_runs
        WHERE scheduled_for = $1 GROUP BY status`,
      [SLOT],
    )).toEqual([{ status: 'REFUSED', count: 4 }]);
  });

  it('refuses an initial sticky DENY before lazy provider secrets, transport, or R2', async () => {
    const runtime = runtimeFor(3);
    const sourceId = await authorizeRuntime(runtime);
    await activateStickyDeny(fixtures.driver, sourceId, '2026-08-28T16:59:59.000Z');
    const objects = new InMemoryObjectClient();
    const network = vi.fn<FetchLike>(() => Promise.reject(new Error('network must not run')));
    let secretReads = 0;
    const env = {
      get CLOUDFLARE_ACCOUNT_ID() { secretReads += 1; return 'test-account'; },
      get CLOUDFLARE_API_TOKEN() { secretReads += 1; return 'test-token'; },
    };
    const result = await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: SLOT,
      clock: new ManualClock(SLOT),
      artifactStore: artifactStore(objects),
      env,
      fetch: network,
    });
    expect(result.executions[0]?.disposition).toBe('REFUSED');
    expect(secretReads).toBe(0);
    expect(network).not.toHaveBeenCalled();
    expect(objects.writes).toEqual([]);
    const rows = await fixtures.driver.query<{ rights_receipt: unknown }>(
      `SELECT rights_receipt FROM scheduled_acquisition_runs WHERE id = $1`,
      [result.executions[0]!.runId],
    );
    expect(JSON.stringify(rows[0]?.rights_receipt)).toContain('STICKY_DENY');
  });

  it('rechecks a sticky DENY before lazy provider secrets or transport', async () => {
    const runtime = runtimeFor(3);
    const sourceId = await authorizeRuntime(runtime);
    const clock = new SteppingClock(SLOT);
    const driver = denyOnRightsLoad(fixtures.driver, sourceId, 2, clock);
    const objects = new InMemoryObjectClient();
    const network = vi.fn<FetchLike>(() => Promise.reject(new Error('network must not run')));
    let secretReads = 0;
    const env = {
      get CLOUDFLARE_ACCOUNT_ID() { secretReads += 1; return 'test-account'; },
      get CLOUDFLARE_API_TOKEN() { secretReads += 1; return 'test-token'; },
    };
    const result = await runScheduledAcquisition({
      driver,
      runtime,
      scheduledFor: SLOT,
      clock,
      artifactStore: artifactStore(objects),
      env,
      fetch: network,
    });
    expect(result.executions[0]?.disposition).toBe('REFUSED');
    expect(secretReads).toBe(0);
    expect(network).not.toHaveBeenCalled();
    expect(objects.writes).toEqual([]);
  });

  it.each([
    ['PAUSED', 'GREEN'],
    ['SUSPENDED', 'GREEN'],
    ['PAUSED', 'RED'],
    ['UNDER_REVIEW', 'UNREVIEWED'],
  ] as const)(
    'does not clear stored source governance status=%s rights=%s',
    async (status, rightsClassification) => {
      const runtime = runtimeFor();
      const sourceId = await authorizeRuntime(runtime);
      await fixtures.driver.query(
        `UPDATE sources SET status = $2, rights_classification = $3 WHERE id = $1`,
        [sourceId, status, rightsClassification],
      );
      const network = vi.fn<FetchLike>(() => Promise.reject(new Error('network must not run')));
      const objects = new InMemoryObjectClient();

      const result = await runScheduledAcquisition({
        driver: fixtures.driver,
        runtime,
        scheduledFor: SLOT,
        clock: new ManualClock(SLOT),
        artifactStore: artifactStore(objects),
        env: {},
        fetch: network,
      });

      expect(result.executions[0]?.disposition).toBe('REFUSED');
      expect(network).not.toHaveBeenCalled();
      expect(objects.writes).toEqual([]);
      expect(await fixtures.driver.query<{ status: string; rights_classification: string }>(
        `SELECT status, rights_classification FROM sources WHERE id = $1`,
        [sourceId],
      )).toEqual([{ status, rights_classification: rightsClassification }]);
    },
  );

  it('rechecks a sticky DENY at pre-transport and performs no network or R2 write', async () => {
    const runtime = runtimeFor();
    const sourceId = await authorizeRuntime(runtime);
    const clock = new SteppingClock(SLOT);
    const driver = denyOnRightsLoad(fixtures.driver, sourceId, 3, clock);
    const network = vi.fn<FetchLike>(() => Promise.reject(new Error('network must not run')));
    const objects = new InMemoryObjectClient();
    const result = await runScheduledAcquisition({
      driver,
      runtime,
      scheduledFor: SLOT,
      clock,
      artifactStore: artifactStore(objects),
      env: {},
      fetch: network,
    });
    expect(result.executions[0]?.disposition).toBe('REFUSED');
    expect(network).not.toHaveBeenCalled();
    expect(objects.writes).toEqual([]);
  });

  it('persists a successful canonical provider run with exact ordered receipts and a per-run retrieval id', async () => {
    const runtime = runtimeFor();
    await authorizeRuntime(runtime);
    const api = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"catalog-v1"' },
      body: '{"models":["SYNTHETIC-1"]}',
    }));
    const objects = new InMemoryObjectClient();
    const result = await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: SLOT,
      clock: new ManualClock(SLOT),
      artifactStore: artifactStore(objects),
      env: {},
      fetch: api.fetch,
    });
    expect(result.executions[0]?.disposition).toBe('SUCCEEDED');
    expect(api.calls).toHaveLength(1);
    expect(objects.writes).toHaveLength(2);
    const runId = result.executions[0]!.runId!;
    const rows = await fixtures.driver.query<{
      status: string;
      provider: string;
      rights_receipt: { stage: string }[];
      retrieval_receipt_id: string;
      retrieval_key: string;
      result_url: string;
    }>(
      `SELECT run.status, run.provider, run.rights_receipt,
              link.retrieval_receipt_id, link.retrieval_key, link.result_url
         FROM scheduled_acquisition_runs run
         JOIN scheduled_acquisition_run_artifacts link ON link.run_id = run.id
        WHERE run.id = $1`,
      [runId],
    );
    expect(rows[0]).toMatchObject({ status: 'SUCCEEDED', provider: 'http' });
    expect(rows[0]?.rights_receipt.map(({ stage }) => stage)).toEqual([
      'INITIAL',
      'PRE_PROVIDER',
      'PRE_TRANSPORT',
    ]);
    expect(rows[0]?.retrieval_receipt_id).toBe(
      artifactRetrievalReceiptId(runId, runtime.targets[0]!.target_url, 'http'),
    );
    expect(rows[0]?.retrieval_key).toMatch(
      new RegExp(`\\.${rows[0]!.retrieval_receipt_id}\\.json$`),
    );
  });

  it('records transport failure without freshness and retries safely in the next slot', async () => {
    const runtime = runtimeFor();
    await authorizeRuntime(runtime);
    const objects = new InMemoryObjectClient();
    const failed = await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: SLOT,
      clock: new ManualClock(SLOT),
      artifactStore: artifactStore(objects),
      env: {},
      fetch: () => Promise.reject(new Error('synthetic upstream outage')),
    });
    expect(failed.executions[0]?.disposition).toBe('FAILED');
    expect(objects.writes).toEqual([]);
    expect(await fixtures.driver.query<{ failure_code: string; fresh_at: string | null }>(
      `SELECT failure_code, fresh_at FROM scheduled_acquisition_runs WHERE id = $1`,
      [failed.executions[0]!.runId],
    )).toEqual([{ failure_code: 'TRANSPORT_FAILED', fresh_at: null }]);

    const recovered = await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: NEXT_SLOT,
      clock: new ManualClock(NEXT_SLOT),
      artifactStore: artifactStore(objects),
      env: {},
      fetch: stubFetch(() => ({ status: 200, body: '{}', headers: { 'content-type': 'application/json' } })).fetch,
    });
    expect(recovered.executions[0]?.disposition).toBe('SUCCEEDED');
  });

  it('publishes NOT_MODIFIED freshness only after an exact prior artifact-backed fetch', async () => {
    const runtime = runtimeFor();
    await authorizeRuntime(runtime);
    const api = stubFetch((_url, _init, call) => call === 0
      ? {
          status: 200,
          body: '{"models":["SYNTHETIC-1"]}',
          headers: { 'content-type': 'application/json', etag: '"catalog-v1"' },
        }
      : { status: 304, headers: { etag: '"catalog-v1"' } });
    const objects = new InMemoryObjectClient();
    const store = artifactStore(objects);
    await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: SLOT,
      clock: new ManualClock(SLOT),
      artifactStore: store,
      env: {},
      fetch: api.fetch,
    });
    const writesAfterFetch = [...objects.writes];
    const second = await runScheduledAcquisition({
      driver: fixtures.driver,
      runtime,
      scheduledFor: REFRESH_SLOT,
      clock: new ManualClock(REFRESH_SLOT),
      artifactStore: store,
      env: {},
      fetch: api.fetch,
    });
    expect(second.executions[0]?.disposition).toBe('SUCCEEDED');
    expect(api.calls[1]?.init?.headers?.['if-none-match']).toBe('"catalog-v1"');
    expect(objects.writes).toEqual(writesAfterFetch);
    const rows = await fixtures.driver.query<{
      outcome: string;
      artifact_count: number;
      fresh_at: string | Date | null;
    }>(
      `SELECT outcome, artifact_count, fresh_at FROM scheduled_acquisition_runs WHERE id = $1`,
      [second.executions[0]!.runId],
    );
    expect(rows[0]).toMatchObject({ outcome: 'NOT_MODIFIED', artifact_count: 0 });
    expect(new Date(rows[0]!.fresh_at!).toISOString()).toBe(REFRESH_SLOT);
  });
});
