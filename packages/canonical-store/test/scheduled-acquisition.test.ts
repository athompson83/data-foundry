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

const claim = (
  slot = '2026-08-28T17:00:00.000Z',
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
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
  ...overrides,
});

const rightsReceipt = (permitted = true) => [
  {
    stage: 'INITIAL' as const,
    evaluatedAt: ts('2026-08-28T17:00:00.000Z'),
    decisions: (['ACQUIRE', 'STORE', 'CACHE'] as const).map((operation, index) => ({
      operation,
      permitted,
      state: permitted ? ('ALLOW' as const) : ('UNKNOWN' as const),
      reasonCode: permitted ? ('ALLOW' as const) : ('NO_GRANT' as const),
      cellId: permitted ? `71000000-0000-4000-8000-00000000000${index}` : null,
      decisionId: permitted ? `72000000-0000-4000-8000-00000000000${index}` : null,
      termsVersionId: permitted ? `73000000-0000-4000-8000-00000000000${index}` : null,
    })),
  },
];

const artifact = (suffix: string) => ({
  source_id: fixtures.sources.manufacturer.source.id,
  url: 'https://catalog.acme-climate.example.com/api/v2/catalog',
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
      rightsReceipt: rightsReceipt(),
      artifacts: [artifact('b'), artifact('c')],
    });

    expect(completed).toMatchObject({
      status: 'SUCCEEDED',
      outcome: 'FETCHED',
      expectedArtifactCount: 2,
      artifactCount: 2,
    });
    expect(await scheduler.latestSuccessAt(run!)).toBe(
      ts('2026-08-28T18:00:59.000Z'),
    );
    expect(await countRows(fixtures.driver, 'scheduled_acquisition_run_artifacts')).toBe(2);
  });

  it.each([
    ['target URL', { targetUrl: 'https://catalog.acme-climate.example.com/api/v2/changed' }],
    ['route', { acquisitionRoute: 'VENDOR_API' }],
    ['plan', { accountOrProductPlan: 'paid-plan' }],
    ['jurisdiction', { jurisdiction: 'US' }],
    ['asset class', { assetClass: 'DOCUMENT' }],
    ['output class', { outputClass: 'NORMALIZED_FACT' }],
    ['runtime digest', { runtimeDigest: 'b'.repeat(64) }],
  ] as const)('does not reuse freshness across a neighboring %s', async (_dimension, override) => {
    const exact = await scheduler.get(
      (await fixtures.driver.query<{ id: string }>(
        `SELECT id FROM scheduled_acquisition_runs WHERE scheduled_for = $1`,
        [ts('2026-08-28T18:00:00.000Z')],
      ))[0]!.id,
    );
    expect(exact).not.toBeNull();
    expect(await scheduler.latestSuccessAt({ ...exact!, ...override } as never)).toBeNull();
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
        rightsReceipt: rightsReceipt(),
        artifacts: [artifact('d'), { ...artifact('e'), content_hash: 'not-a-hash' }],
      }),
    ).rejects.toThrow();

    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
    expect(await scheduler.latestSuccessAt(run!)).toBe(
      ts('2026-08-28T18:00:59.000Z'),
    );
  });

  it.each([
    [
      'target URL',
      '2026-08-28T19:30:00.000Z',
      { url: 'https://catalog.acme-climate.example.com/api/v2/neighbor' },
    ],
    ['route', '2026-08-28T19:31:00.000Z', { acquisition_route: 'VENDOR_API' }],
    ['nullable plan', '2026-08-28T19:32:00.000Z', { account_or_product_plan: 'neighbor' }],
    ['nullable jurisdiction', '2026-08-28T19:33:00.000Z', { acquisition_jurisdiction: 'US' }],
  ] as const)('refuses an artifact from a neighboring %s', async (_scope, slot, override) => {
    const run = await scheduler.claim(claim(slot));
    const before = await countRows(fixtures.driver, 'source_artifacts');
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T19:40:00.000Z'),
        freshAt: ts('2026-08-28T19:39:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(),
        artifacts: [{ ...artifact('f'), ...override }],
      }),
    ).rejects.toThrow(/target or acquisition scope/i);
    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('rolls back when an artifact provider differs from the completion provider', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:34:00.000Z'));
    const before = await countRows(fixtures.driver, 'source_artifacts');
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T19:40:00.000Z'),
        freshAt: ts('2026-08-28T19:39:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(),
        artifacts: [{ ...artifact('f'), acquisition_provider: 'neighbor-provider' }],
      }),
    ).rejects.toThrow(/artifact provider does not match/i);
    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('enforces the exact artifact scope in the database trigger too', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:45:00.000Z'));
    const neighboring = await fixtures.store.recordSourceArtifact({
      ...artifact('9'),
      url: 'https://catalog.acme-climate.example.com/api/v2/neighbor',
    });
    await expect(
      fixtures.driver.query(
        `INSERT INTO scheduled_acquisition_run_artifacts (run_id, artifact_id, ordinal)
         VALUES ($1, $2, 0)`,
        [run!.id, neighboring.id],
      ),
    ).rejects.toThrow(/target or acquisition scope/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('validates linked artifact providers again at the database terminal boundary', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:46:00.000Z'));
    const neighboring = await fixtures.store.recordSourceArtifact({
      ...artifact('8'),
      acquisition_provider: 'neighbor-provider',
    });
    await fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_run_artifacts (run_id, artifact_id, ordinal)
       VALUES ($1, $2, 0)`,
      [run!.id, neighboring.id],
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs
            SET status = 'SUCCEEDED', outcome = 'FETCHED',
                completed_at = $2, fresh_at = $2, provider = 'http',
                expected_artifact_count = 1, artifact_count = 1
          WHERE id = $1`,
        [run!.id, ts('2026-08-28T19:47:00.000Z')],
      ),
    ).rejects.toThrow(/artifact provider does not match/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
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
      rightsReceipt: rightsReceipt(),
      artifacts: [],
    });

    expect(completed).toMatchObject({ status: 'SUCCEEDED', outcome: 'NOT_MODIFIED' });
    expect(await scheduler.latestSuccessAt(run!)).toBe(
      ts('2026-08-28T20:00:59.000Z'),
    );
  });

  it('does not manufacture freshness from a first-ever NOT_MODIFIED response', async () => {
    const run = await scheduler.claim(
      claim('2026-08-28T20:10:00.000Z', { targetId: 'never-fetched' }),
    );
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'NOT_MODIFIED',
        completedAt: ts('2026-08-28T20:11:00.000Z'),
        freshAt: ts('2026-08-28T20:10:59.000Z'),
        provider: 'http',
        validators: { etag: '"v1"' },
        rightsReceipt: rightsReceipt(),
        artifacts: [],
      }),
    ).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('does not reuse FETCHED history from a neighboring acquisition scope for NOT_MODIFIED', async () => {
    const run = await scheduler.claim(
      claim('2026-08-28T20:12:00.000Z', { acquisitionRoute: 'VENDOR_API' }),
    );
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'NOT_MODIFIED',
        completedAt: ts('2026-08-28T20:13:00.000Z'),
        freshAt: ts('2026-08-28T20:12:59.000Z'),
        provider: 'http',
        validators: { etag: '"v1"' },
        rightsReceipt: rightsReceipt(),
        artifacts: [],
      }),
    ).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('enforces the prior FETCHED requirement at the database terminal boundary', async () => {
    const run = await scheduler.claim(
      claim('2026-08-28T20:14:00.000Z', { targetId: 'never-fetched-db' }),
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs
            SET status = 'SUCCEEDED', outcome = 'NOT_MODIFIED',
                completed_at = $2, fresh_at = $2, provider = 'http',
                validators = $3::jsonb, rights_receipt = $4::jsonb
          WHERE id = $1`,
        [
          run!.id,
          ts('2026-08-28T20:15:00.000Z'),
          JSON.stringify({ etag: '"v1"' }),
          JSON.stringify(rightsReceipt()),
        ],
      ),
    ).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it.each([
    ['unknown validator key', 'unsafe-validator', '2026-08-28T20:20:00.000Z', { validators: { authorization: 'Bearer plaintext' } }],
    ['empty successful receipt', 'empty-receipt', '2026-08-28T20:21:00.000Z', { rightsReceipt: [] }],
    ['unknown provider', 'unknown-provider', '2026-08-28T20:22:00.000Z', { provider: 'raw-provider-error' }],
    [
      'raw receipt field',
      'raw-receipt',
      '2026-08-28T20:23:00.000Z',
      {
        rightsReceipt: [
          { ...rightsReceipt()[0], rawError: 'Authorization: Bearer plaintext' },
        ],
      },
    ],
  ] as const)('rejects privacy-unsafe terminal DTO data: %s', async (_label, targetId, slot, override) => {
    const run = await scheduler.claim(
      claim(slot, { targetId }),
    );
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T20:59:00.000Z'),
        freshAt: ts('2026-08-28T20:58:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(),
        artifacts: [artifact('7')],
        ...override,
      } as never),
    ).rejects.toThrow(/validator|receipt|provider/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('rejects unenumerated failure text rather than persisting it', async () => {
    const run = await scheduler.claim(claim('2026-08-28T20:50:00.000Z', { targetId: 'bad-failure' }));
    await expect(
      scheduler.fail({
        runId: run!.id,
        status: 'FAILED',
        outcome: null,
        failureCode: 'upstream said Authorization: Bearer plaintext',
        completedAt: ts('2026-08-28T20:51:00.000Z'),
        rightsReceipt: [],
      } as never),
    ).rejects.toThrow(/failure code/i);
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
      failureCode: 'RIGHTS_REFUSED',
      completedAt: ts('2026-08-28T22:01:00.000Z'),
      rightsReceipt: rightsReceipt(false),
    });

    expect(await scheduler.latestSuccessAt(empty!)).toBe(
      ts('2026-08-28T20:00:59.000Z'),
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs SET failure_code = 'CHANGED' WHERE id = $1`,
        [refused!.id],
      ),
    ).rejects.toThrow(/terminal scheduled acquisition run is immutable/i);
  });

  it.each([
    ['target_id', "'rewritten'", '2026-08-28T23:00:00.000Z'],
    ['runtime_digest', `'${'b'.repeat(64)}'`, '2026-08-28T23:01:00.000Z'],
    ['scheduled_for', "'2026-08-29T00:00:00.000Z'", '2026-08-28T23:02:00.000Z'],
    ['claimed_at', "'2026-08-29T00:00:00.000Z'", '2026-08-28T23:03:00.000Z'],
  ] as const)('does not permit claimed %s to mutate', async (column, value, slot) => {
    const run = await scheduler.claim(claim(slot));
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs SET ${column} = ${value} WHERE id = $1`,
        [run!.id],
      ),
    ).rejects.toThrow(/claim identity and scope are immutable/i);
  });
});
