import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScheduledAcquisitionStore, type ScheduledAcquisitionStore } from '../src/index.js';
import { countRows, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;
let scheduler: ScheduledAcquisitionStore;

beforeAll(async () => {
  fixtures = await createFixtures();
  scheduler = createScheduledAcquisitionStore(fixtures.driver);
});

afterAll(async () => {
  await fixtures?.driver.close();
});

const claim = (slot = '2026-08-28T17:00:00.000Z') => ({
  idempotencyKey: `hvac:acme-hvac-catalog:${slot}`,
  verticalSlug: 'hvac',
  sourceId: fixtures.sources.manufacturer.source.id,
  sourceKey: 'acme-hvac-catalog',
  targetId: 'catalog-api',
  targetUrl: 'https://catalog.acme-climate.example.com/api/v2/catalog',
  acquisitionRoute: 'DIRECT_HTTP' as const,
  accountOrProductPlan: null,
  jurisdiction: null,
  assetClass: 'DATA' as const,
  outputClass: 'RAW_RECORD' as const,
  scheduledFor: ts(slot),
  runtimeDigest: 'a'.repeat(64),
  claimedAt: ts('2026-08-28T17:00:01.000Z'),
});

const artifact = (suffix: string) => ({
  source_id: fixtures.sources.manufacturer.source.id,
  url: `https://catalog.acme-climate.example.com/api/v2/catalog/${suffix}`,
  retrieved_at: ts('2026-08-28T17:01:00.000Z'),
  content_hash: suffix.repeat(64).slice(0, 64),
  mime_type: 'application/json',
  r2_uri: `r2://data-foundry-raw-artifacts/hvac/acme-hvac-catalog/${suffix}`,
  http_status: 200,
  extractor_version: 'http@1.0.0',
  policy_snapshot_id: null,
  byte_size: 128,
  acquisition_provider: 'http',
  acquisition_route: 'DIRECT_HTTP' as const,
  account_or_product_plan: null,
  acquisition_jurisdiction: null,
});

describe('scheduled acquisition claims', () => {
  it('atomically claims an idempotency key only once', async () => {
    const input = claim();
    const [first, duplicate] = await Promise.all([
      scheduler.claim(input),
      scheduler.claim(input),
    ]);

    expect([first, duplicate].filter((run) => run !== null)).toHaveLength(1);
    expect(await countRows(fixtures.driver, 'scheduled_acquisition_runs')).toBe(1);
  });
});

describe('terminal outcomes and freshness', () => {
  it('commits every artifact link before publishing FETCHED success', async () => {
    const run = await scheduler.claim(claim('2026-08-28T18:00:00.000Z'));
    expect(run).not.toBeNull();

    const completed = await scheduler.complete({
      runId: run!.id,
      outcome: 'FETCHED',
      completedAt: ts('2026-08-28T18:01:00.000Z'),
      freshAt: ts('2026-08-28T18:00:59.000Z'),
      provider: 'http',
      validators: { etag: '"v1"' },
      rightsReceipt: [{ operation: 'ACQUIRE', decision: 'ALLOW' }],
      artifacts: [artifact('b'), artifact('c')],
    });

    expect(completed).toMatchObject({
      status: 'SUCCEEDED',
      outcome: 'FETCHED',
      expectedArtifactCount: 2,
      artifactCount: 2,
    });
    expect(await scheduler.latestSuccessAt(run!.sourceId, run!.targetId)).toBe(
      ts('2026-08-28T18:00:59.000Z'),
    );
    expect(await countRows(fixtures.driver, 'scheduled_acquisition_run_artifacts')).toBe(2);
  });

  it('rolls back every artifact and leaves no freshness on a partial failure', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:00:00.000Z'));
    const before = await countRows(fixtures.driver, 'source_artifacts');

    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T19:01:00.000Z'),
        freshAt: ts('2026-08-28T19:00:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: [],
        artifacts: [artifact('d'), { ...artifact('e'), content_hash: 'not-a-hash' }],
      }),
    ).rejects.toThrow();

    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
    expect(await scheduler.latestSuccessAt(run!.sourceId, run!.targetId)).toBe(
      ts('2026-08-28T18:00:59.000Z'),
    );
  });

  it('treats NOT_MODIFIED as successful freshness without inventing artifacts', async () => {
    const run = await scheduler.claim(claim('2026-08-28T20:00:00.000Z'));
    const completed = await scheduler.complete({
      runId: run!.id,
      outcome: 'NOT_MODIFIED',
      completedAt: ts('2026-08-28T20:01:00.000Z'),
      freshAt: ts('2026-08-28T20:00:59.000Z'),
      provider: 'http',
      validators: { etag: '"v1"' },
      rightsReceipt: [],
      artifacts: [],
    });

    expect(completed).toMatchObject({ status: 'SUCCEEDED', outcome: 'NOT_MODIFIED' });
    expect(await scheduler.latestSuccessAt(run!.sourceId, run!.targetId)).toBe(
      ts('2026-08-28T20:00:59.000Z'),
    );
  });

  it('never advances freshness for EMPTY, refused, failed, or claimed runs', async () => {
    const empty = await scheduler.claim(claim('2026-08-28T21:00:00.000Z'));
    const refused = await scheduler.claim(claim('2026-08-28T22:00:00.000Z'));
    await scheduler.fail({
      runId: empty!.id,
      status: 'FAILED',
      outcome: 'EMPTY',
      failureCode: 'EMPTY_RESPONSE',
      completedAt: ts('2026-08-28T21:01:00.000Z'),
      rightsReceipt: [],
    });
    await scheduler.fail({
      runId: refused!.id,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'NO_GRANT',
      completedAt: ts('2026-08-28T22:01:00.000Z'),
      rightsReceipt: [{ operation: 'ACQUIRE', decision: 'NO_GRANT' }],
    });

    expect(await scheduler.latestSuccessAt(empty!.sourceId, empty!.targetId)).toBe(
      ts('2026-08-28T20:00:59.000Z'),
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs SET failure_code = 'CHANGED' WHERE id = $1`,
        [refused!.id],
      ),
    ).rejects.toThrow(/terminal scheduled acquisition run is immutable/i);
  });
});
