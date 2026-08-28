import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SourceArtifactInsert } from '@data-foundry/canonical-schema';
import {
  createScheduledAcquisitionStore,
  type ScheduledAcquisitionRun,
  type ScheduledAcquisitionStore,
  type ScheduledRightsReceipt,
  type ScheduledRightsReceiptStage,
} from '../src/index.js';
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
  resultUrlPolicy: {
    allowedOrigins: ['https://catalog.acme-climate.example.com'],
    allowedPathPrefixes: ['/api/v2/catalog'],
  },
  scheduledFor: ts(slot),
  runtimeDigest: 'a'.repeat(64),
  claimedAt: ts('2026-08-28T17:00:01.000Z'),
  ...overrides,
});

const checkpoint = (
  run: ScheduledAcquisitionRun,
  stage: ScheduledRightsReceiptStage,
  index: number,
  permitted: boolean,
  basis: ScheduledRightsReceipt['basis'],
): ScheduledRightsReceipt => ({
    stage,
    basis,
    scopeDigest: run.rightsScopeDigest,
    evaluatedAt: ts(new Date(Date.parse(run.claimedAt) + index).toISOString()),
    decisions: (['ACQUIRE', 'STORE', 'CACHE'] as const).map((operation, decisionIndex) => ({
      operation,
      permitted,
      state: permitted ? ('ALLOW' as const) : ('UNKNOWN' as const),
      reasonCode: permitted ? ('ALLOW' as const) : ('NO_GRANT' as const),
      cellId: permitted ? `71000000-0000-4000-8000-00000000000${decisionIndex}` : null,
      decisionId: permitted ? `72000000-0000-4000-8000-00000000000${decisionIndex}` : null,
      termsVersionId: permitted ? `73000000-0000-4000-8000-00000000000${decisionIndex}` : null,
    })),
  });

const rightsReceipt = (
  run: ScheduledAcquisitionRun,
  permitted = true,
): readonly ScheduledRightsReceipt[] => permitted
  ? [
      checkpoint(run, 'INITIAL', 0, true, 'ADMITTED'),
      checkpoint(run, 'PRE_PROVIDER', 1, true, 'ADMITTED'),
      checkpoint(run, 'PRE_TRANSPORT', 2, true, 'ADMITTED'),
    ]
  : [checkpoint(run, 'INITIAL', 0, false, 'RIGHTS_REFUSED')];

const notDueReceipt = (run: ScheduledAcquisitionRun): readonly ScheduledRightsReceipt[] => [
  checkpoint(run, 'INITIAL', 0, true, 'NOT_DUE'),
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

const scheduledArtifact = (
  value: SourceArtifactInsert,
  resultRelation: 'TARGET' | 'CHILD_RESOURCE' = 'TARGET',
) => ({
  artifact: value,
  retrievalKey: `raw/hvac/acme-hvac-catalog/retrieved/2026/08/28/${value.content_hash}.json`,
  resultRelation,
});

async function linkRawArtifact(
  run: ScheduledAcquisitionRun,
  value: SourceArtifactInsert,
  acquisitionProvider = 'http',
  resultRelation: 'TARGET' | 'CHILD_RESOURCE' = 'TARGET',
): Promise<void> {
  const persisted = await fixtures.store.recordSourceArtifact(value);
  await fixtures.driver.query(
    `INSERT INTO scheduled_acquisition_run_artifacts
       (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
        retrieval_key, acquisition_provider)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7)`,
    [
      run.id, persisted.id, run.targetUrl, value.url, resultRelation,
      scheduledArtifact(value, resultRelation).retrievalKey, acquisitionProvider,
    ],
  );
}

async function rawFetchedSuccess(
  run: ScheduledAcquisitionRun,
  receipt: unknown,
  completedAt = ts('2026-08-28T23:59:00.000Z'),
  freshAt = completedAt,
): Promise<void> {
  await fixtures.driver.query(
    `UPDATE scheduled_acquisition_runs
        SET status = 'SUCCEEDED', outcome = 'FETCHED',
            completed_at = $2, fresh_at = $3, provider = 'http',
            expected_artifact_count = 1, artifact_count = 1,
            rights_receipt = $4::jsonb
      WHERE id = $1`,
    [run.id, completedAt, freshAt, JSON.stringify(receipt)],
  );
}

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
  it.each([
    ['missing checkpoints', '2026-08-28T17:11:00.000Z', '1'],
    ['duplicate checkpoints', '2026-08-28T17:12:00.000Z', '2'],
    ['out-of-order checkpoints', '2026-08-28T17:13:00.000Z', '3'],
    ['a denied checkpoint', '2026-08-28T17:14:00.000Z', '4'],
  ] as const)('rejects raw-SQL success with %s', async (_label, slot, suffix) => {
    const run = await scheduler.claim(claim(slot, {
      targetId: `receipt-negative-${_label.replaceAll(' ', '-')}`,
    }));
    const valid = rightsReceipt(run!);
    const receipt = _label === 'missing checkpoints'
      ? [valid[0]]
      : _label === 'duplicate checkpoints'
        ? [valid[0], valid[1], valid[1]]
        : _label === 'out-of-order checkpoints'
          ? [valid[0], valid[2], valid[1]]
          : [valid[0], valid[1], checkpoint(run!, 'PRE_TRANSPORT', 2, false, 'RIGHTS_REFUSED')];
    const persisted = await fixtures.store.recordSourceArtifact(artifact(suffix));
    await fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_run_artifacts
         (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
          retrieval_key, acquisition_provider)
       VALUES ($1, $2, 0, $3, $3, 'TARGET', $4, 'http')`,
      [run!.id, persisted.id, run!.targetUrl, scheduledArtifact(artifact(suffix)).retrievalKey],
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs
            SET status = 'SUCCEEDED', outcome = 'FETCHED',
                completed_at = $2, fresh_at = $2, provider = 'http',
                expected_artifact_count = 1, artifact_count = 1,
                validators = $3::jsonb, rights_receipt = $4::jsonb
          WHERE id = $1`,
        [
          run!.id,
          ts('2026-08-28T17:20:00.000Z'),
          JSON.stringify({ etag: '"v1"' }),
          JSON.stringify(receipt),
        ],
      ),
    ).rejects.toThrow(/receipt|checkpoint|permission/i);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
  });

  it.each([
    [
      'unknown reason code',
      '2026-08-28T17:21:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].reasonCode = 'FUTURE_ALLOW'; },
    ],
    [
      'malformed UUID',
      '2026-08-28T17:22:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].cellId = 'not-a-uuid'; },
    ],
    [
      'invalid UUID version',
      '2026-08-28T17:23:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].decisionId = '72000000-0000-9000-8000-000000000000'; },
    ],
    [
      'invalid UUID variant',
      '2026-08-28T17:24:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].termsVersionId = '73000000-0000-4000-7000-000000000000'; },
    ],
    [
      'null allowed cell provenance',
      '2026-08-28T17:25:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].cellId = null; },
    ],
    [
      'null allowed decision provenance',
      '2026-08-28T17:26:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].decisionId = null; },
    ],
    [
      'null allowed terms provenance',
      '2026-08-28T17:27:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].termsVersionId = null; },
    ],
    [
      'noncanonical timestamp',
      '2026-08-28T17:28:00.000Z',
      (receipt: any[]) => { receipt[0].evaluatedAt = '2026-08-28 17:00:01+00'; },
    ],
    [
      'impossible timestamp',
      '2026-08-28T17:29:00.000Z',
      (receipt: any[]) => { receipt[0].evaluatedAt = '2026-02-31T17:00:01.000Z'; },
    ],
    [
      'decreasing checkpoint time',
      '2026-08-28T17:30:00.000Z',
      (receipt: any[]) => {
        receipt[1].evaluatedAt = ts('2026-08-28T17:00:01.002Z');
        receipt[2].evaluatedAt = ts('2026-08-28T17:00:01.001Z');
      },
    ],
    [
      'checkpoint after completion',
      '2026-08-28T17:31:00.000Z',
      (receipt: any[]) => { receipt[2].evaluatedAt = '2026-08-29T00:00:00.000Z'; },
    ],
  ] as const)('rejects raw-SQL receipt divergence: %s', async (_label, slot, mutate) => {
    const run = await scheduler.claim(claim(slot, { targetId: `raw-${slot.slice(14, 19).replace(':', '-')}` }));
    await linkRawArtifact(run!, artifact('5'));
    const receipt = structuredClone(rightsReceipt(run!)) as any[];
    mutate(receipt);
    await expect(rawFetchedSuccess(run!, receipt)).rejects.toThrow();
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
  });

  it('binds every checkpoint to the database-derived immutable claim scope', async () => {
    const first = await scheduler.claim(claim('2026-08-28T17:32:00.000Z', { targetId: 'scope-first' }));
    const neighbor = await scheduler.claim(claim('2026-08-28T17:33:00.000Z', { targetId: 'scope-neighbor' }));
    expect(first!.rightsScopeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(neighbor!.rightsScopeDigest).not.toBe(first!.rightsScopeDigest);
    await linkRawArtifact(neighbor!, artifact('6'));

    await expect(rawFetchedSuccess(neighbor!, rightsReceipt(first!))).rejects.toThrow(/receipt/i);
    await expect(
      scheduler.complete({
        runId: neighbor!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T17:40:00.000Z'),
        freshAt: ts('2026-08-28T17:39:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(first!),
        artifacts: [scheduledArtifact(artifact('6'))],
      }),
    ).rejects.toThrow(/scope/i);
    expect((await scheduler.get(neighbor!.id))?.freshAt).toBeNull();
  });

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
      rightsReceipt: rightsReceipt(run!),
      artifacts: [scheduledArtifact(artifact('b')), scheduledArtifact(artifact('c'))],
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
    expect(
      Number((await fixtures.driver.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM scheduled_acquisition_run_artifacts WHERE run_id = $1`,
        [run!.id],
      ))[0]?.count),
    ).toBe(2);
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
        rightsReceipt: rightsReceipt(run!),
        artifacts: [
          scheduledArtifact(artifact('d')),
          scheduledArtifact({ ...artifact('e'), content_hash: 'not-a-hash' }),
        ],
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
        rightsReceipt: rightsReceipt(run!),
        artifacts: [scheduledArtifact({ ...artifact('f'), ...override })],
      }),
    ).rejects.toThrow(/target|acquisition scope|associated/i);
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
        rightsReceipt: rightsReceipt(run!),
        artifacts: [scheduledArtifact({ ...artifact('f'), acquisition_provider: 'neighbor-provider' })],
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
        `INSERT INTO scheduled_acquisition_run_artifacts
           (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
            retrieval_key, acquisition_provider)
         VALUES ($1, $2, 0, $3, $4, 'CHILD_RESOURCE', $5, 'http')`,
        [
          run!.id, neighboring.id, run!.targetUrl, neighboring.url,
          scheduledArtifact(artifact('9')).retrievalKey,
        ],
      ),
    ).rejects.toThrow(/target policy/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('validates linked artifact providers again at the database terminal boundary', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:46:00.000Z'));
    const neighboring = await fixtures.store.recordSourceArtifact(artifact('8'));
    await fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_run_artifacts
         (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
          retrieval_key, acquisition_provider)
       VALUES ($1, $2, 0, $3, $3, 'TARGET', $4, 'browser-run')`,
      [run!.id, neighboring.id, run!.targetUrl, scheduledArtifact(artifact('8')).retrievalKey],
    );
    await expect(
      fixtures.driver.query(
        `UPDATE scheduled_acquisition_runs
            SET status = 'SUCCEEDED', outcome = 'FETCHED',
                completed_at = $2, fresh_at = $2, provider = 'http',
                expected_artifact_count = 1, artifact_count = 1,
                rights_receipt = $3::jsonb
          WHERE id = $1`,
        [
          run!.id, ts('2026-08-28T19:47:00.000Z'),
          JSON.stringify(rightsReceipt(run!)),
        ],
      ),
    ).rejects.toThrow(/retrieval provider does not match/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('records the current retrieval provider when identical content deduplicates across providers', async () => {
    const first = await scheduler.claim(claim('2026-08-28T19:48:00.000Z', {
      targetId: 'cross-provider',
      acquisitionRoute: 'BROWSER_RUN',
    }));
    const firstArtifact = {
      ...artifact('a'),
      acquisition_provider: 'browser-run',
      acquisition_route: 'BROWSER_RUN' as const,
      extractor_version: 'browser-run@1.0.0',
    };
    await scheduler.complete({
      runId: first!.id,
      outcome: 'FETCHED',
      completedAt: ts('2026-08-28T19:49:00.000Z'),
      freshAt: ts('2026-08-28T19:48:59.000Z'),
      provider: 'browser-run',
      validators: {},
      rightsReceipt: rightsReceipt(first!),
      artifacts: [scheduledArtifact(firstArtifact)],
    });

    const second = await scheduler.claim(claim('2026-08-28T19:50:00.000Z', {
      targetId: 'cross-provider',
      acquisitionRoute: 'BROWSER_RUN',
    }));
    await scheduler.complete({
      runId: second!.id,
      outcome: 'FETCHED',
      completedAt: ts('2026-08-28T19:51:00.000Z'),
      freshAt: ts('2026-08-28T19:50:59.000Z'),
      provider: 'fixture',
      validators: {},
      rightsReceipt: rightsReceipt(second!),
      artifacts: [scheduledArtifact({
        ...firstArtifact,
        acquisition_provider: 'fixture',
        extractor_version: 'fixture@1.0.0',
      })],
    });

    const artifacts = await fixtures.driver.query<{ count: number; acquisition_provider: string }>(
      `SELECT count(*)::integer AS count, min(acquisition_provider) AS acquisition_provider
         FROM source_artifacts
        WHERE source_id = $1 AND url = $2 AND content_hash = $3
          AND acquisition_route = 'BROWSER_RUN'
        GROUP BY source_id, url, content_hash, acquisition_route`,
      [first!.sourceId, first!.targetUrl, firstArtifact.content_hash],
    );
    expect(artifacts[0]).toEqual({ count: 1, acquisition_provider: 'browser-run' });
    expect(
      await fixtures.driver.query<{ acquisition_provider: string }>(
        `SELECT acquisition_provider FROM scheduled_acquisition_run_artifacts
          WHERE run_id IN ($1, $2) ORDER BY created_at`,
        [first!.id, second!.id],
      ),
    ).toEqual([
      { acquisition_provider: 'browser-run' },
      { acquisition_provider: 'fixture' },
    ]);
  });

  it('admits only policy-bound BrowserRun child resources and records their target association', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:52:00.000Z', {
      targetId: 'multi-resource',
      acquisitionRoute: 'BROWSER_RUN',
    }));
    const childBase = {
      ...artifact('a'),
      acquisition_provider: 'browser-run',
      acquisition_route: 'BROWSER_RUN' as const,
      extractor_version: 'browser-run@1.0.0',
    };
    for (const url of [
      'https://off-scope.example.com/api/v2/catalog?page=2',
      'https://catalog.acme-climate.example.com/admin?page=2',
    ]) {
      await expect(
        scheduler.complete({
          runId: run!.id,
          outcome: 'FETCHED',
          completedAt: ts('2026-08-28T19:53:00.000Z'),
          freshAt: ts('2026-08-28T19:52:59.000Z'),
          provider: 'browser-run',
          validators: {},
          rightsReceipt: rightsReceipt(run!),
          artifacts: [scheduledArtifact({ ...childBase, url }, 'CHILD_RESOURCE')],
        }),
      ).rejects.toThrow(/associated with the claimed target/i);
      expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
    }

    const targetArtifact = { ...childBase, content_hash: 'b'.repeat(64) };
    const childArtifact = {
      ...childBase,
      url: `${run!.targetUrl}?page=2`,
      content_hash: 'c'.repeat(64),
    };
    await scheduler.complete({
      runId: run!.id,
      outcome: 'FETCHED',
      completedAt: ts('2026-08-28T19:54:00.000Z'),
      freshAt: ts('2026-08-28T19:53:59.000Z'),
      provider: 'browser-run',
      validators: {},
      rightsReceipt: rightsReceipt(run!),
      artifacts: [
        scheduledArtifact(targetArtifact, 'TARGET'),
        scheduledArtifact(childArtifact, 'CHILD_RESOURCE'),
      ],
    });
    expect(
      await fixtures.driver.query<{ target_url: string; result_url: string; result_relation: string }>(
        `SELECT target_url, result_url, result_relation
           FROM scheduled_acquisition_run_artifacts WHERE run_id = $1 ORDER BY ordinal`,
        [run!.id],
      ),
    ).toEqual([
      { target_url: run!.targetUrl, result_url: run!.targetUrl, result_relation: 'TARGET' },
      { target_url: run!.targetUrl, result_url: childArtifact.url, result_relation: 'CHILD_RESOURCE' },
    ]);
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
      rightsReceipt: rightsReceipt(run!),
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
        rightsReceipt: rightsReceipt(run!),
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
        rightsReceipt: rightsReceipt(run!),
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
          JSON.stringify(rightsReceipt(run!)),
        ],
      ),
    ).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it.each([
    ['unknown validator key', 'unsafe-validator', '2026-08-28T20:20:00.000Z', 'validator'],
    ['empty successful receipt', 'empty-receipt', '2026-08-28T20:21:00.000Z', 'empty-receipt'],
    ['unknown provider', 'unknown-provider', '2026-08-28T20:22:00.000Z', 'provider'],
    ['raw receipt field', 'raw-receipt', '2026-08-28T20:23:00.000Z', 'raw-receipt'],
  ] as const)('rejects privacy-unsafe terminal DTO data: %s', async (_label, targetId, slot, kind) => {
    const run = await scheduler.claim(
      claim(slot, { targetId }),
    );
    const receipt = rightsReceipt(run!);
    const override = kind === 'validator'
      ? { validators: { authorization: 'Bearer plaintext' } }
      : kind === 'empty-receipt'
        ? { rightsReceipt: [] }
        : kind === 'provider'
          ? { provider: 'raw-provider-error' }
          : { rightsReceipt: [{ ...receipt[0], rawError: 'Authorization: Bearer plaintext' }] };
    await expect(
      scheduler.complete({
        runId: run!.id,
        outcome: 'FETCHED',
        completedAt: ts('2026-08-28T20:59:00.000Z'),
        freshAt: ts('2026-08-28T20:58:59.000Z'),
        provider: 'http',
        validators: {},
        rightsReceipt: receipt,
        artifacts: [scheduledArtifact(artifact('7'))],
        ...override,
      } as never),
    ).rejects.toThrow(/validator|receipt|provider|checkpoint/i);
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

  it('persists only the explicit skipped and refused receipt forms', async () => {
    const skipped = await scheduler.claim(claim('2026-08-28T20:52:00.000Z', { targetId: 'skip-valid' }));
    expect(await scheduler.fail({
      runId: skipped!.id,
      status: 'SKIPPED',
      outcome: null,
      failureCode: 'NOT_DUE',
      completedAt: ts('2026-08-28T20:53:00.000Z'),
      rightsReceipt: notDueReceipt(skipped!),
    })).toMatchObject({ status: 'SKIPPED', failureCode: 'NOT_DUE' });

    const refused = await scheduler.claim(claim('2026-08-28T20:54:00.000Z', { targetId: 'refuse-valid' }));
    const refusalReceipt = [
      rightsReceipt(refused!)[0]!,
      checkpoint(refused!, 'PRE_PROVIDER', 1, false, 'RIGHTS_REFUSED'),
    ];
    expect(await scheduler.fail({
      runId: refused!.id,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'RIGHTS_REFUSED',
      completedAt: ts('2026-08-28T20:55:00.000Z'),
      rightsReceipt: refusalReceipt,
    })).toMatchObject({ status: 'REFUSED', failureCode: 'RIGHTS_REFUSED' });
  });

  it.each([
    ['skipped without not-due basis', '2026-08-28T20:56:00.000Z', 'SKIPPED'],
    ['refused with an admitted final checkpoint', '2026-08-28T20:57:00.000Z', 'REFUSED'],
    ['refused with a non-prefix stage', '2026-08-28T20:58:00.000Z', 'REFUSED_STAGE'],
    ['failed with a refusal checkpoint', '2026-08-28T20:59:00.000Z', 'FAILED'],
  ] as const)('rejects terminal receipt mismatch: %s', async (_label, slot, kind) => {
    const run = await scheduler.claim(claim(slot, { targetId: `terminal-${kind.toLowerCase()}` }));
    const admitted = rightsReceipt(run!)[0]!;
    const deniedTransport = checkpoint(run!, 'PRE_TRANSPORT', 1, false, 'RIGHTS_REFUSED');
    const input = kind === 'SKIPPED'
      ? {
          runId: run!.id, status: 'SKIPPED', outcome: null, failureCode: 'NOT_DUE',
          completedAt: ts('2026-08-28T21:10:00.000Z'), rightsReceipt: [admitted],
        }
      : kind === 'FAILED'
        ? {
            runId: run!.id, status: 'FAILED', outcome: null, failureCode: 'INTERNAL_ERROR',
            completedAt: ts('2026-08-28T21:10:00.000Z'), rightsReceipt: [
              { ...admitted, basis: 'RIGHTS_REFUSED', decisions: deniedTransport.decisions },
            ],
          }
        : {
            runId: run!.id, status: 'REFUSED', outcome: null, failureCode: 'RIGHTS_REFUSED',
            completedAt: ts('2026-08-28T21:10:00.000Z'), rightsReceipt: kind === 'REFUSED_STAGE'
              ? [admitted, deniedTransport]
              : [admitted],
          };
    await expect(scheduler.fail(input as never)).rejects.toThrow(/receipt|refus|skipped|failed/i);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
  });

  it('enforces terminal time order in TypeScript and raw SQL', async () => {
    const typed = await scheduler.claim(claim('2026-08-28T21:11:00.000Z', { targetId: 'time-typed' }));
    await expect(scheduler.fail({
      runId: typed!.id,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: ts('2026-08-28T17:00:00.000Z'),
      rightsReceipt: [],
    })).rejects.toThrow(/precedes its claim/i);

    const raw = await scheduler.claim(claim('2026-08-28T21:12:00.000Z', { targetId: 'time-raw' }));
    await expect(fixtures.driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = 'FAILED', outcome = NULL, failure_code = 'INTERNAL_ERROR',
              completed_at = $2, rights_receipt = '[]'::jsonb
        WHERE id = $1`,
      [raw!.id, ts('2026-08-28T17:00:00.000Z')],
    )).rejects.toThrow();
    expect((await scheduler.get(raw!.id))?.completedAt).toBeNull();
  });

  it.each([
    ['freshness before claim', '2026-08-28T21:13:00.000Z', '2026-08-28T17:00:00.000Z'],
    ['freshness after completion', '2026-08-28T21:14:00.000Z', '2026-08-28T22:01:00.000Z'],
  ] as const)('rejects raw-SQL %s', async (_label, slot, freshAt) => {
    const run = await scheduler.claim(claim(slot, { targetId: `fresh-${slot.slice(14, 16)}` }));
    await linkRawArtifact(run!, artifact('d'));
    await expect(rawFetchedSuccess(
      run!,
      rightsReceipt(run!),
      ts('2026-08-28T22:00:00.000Z'),
      ts(freshAt),
    )).rejects.toThrow();
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
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
      rightsReceipt: rightsReceipt(empty!),
      provider: 'http',
    });
    await scheduler.fail({
      runId: refused!.id,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'RIGHTS_REFUSED',
      completedAt: ts('2026-08-28T22:01:00.000Z'),
      rightsReceipt: rightsReceipt(refused!, false),
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

if (false) {
  // @ts-expect-error SKIPPED is statically coupled to NOT_DUE and a null outcome.
  void scheduler.fail({ runId: 'compile-only', status: 'SKIPPED', outcome: 'EMPTY', failureCode: 'EMPTY_RESPONSE', completedAt: ts('2026-08-28T00:00:00.000Z'), rightsReceipt: [], provider: 'http' });
  // @ts-expect-error REFUSED cannot persist a provider or a non-rights failure code.
  void scheduler.fail({ runId: 'compile-only', status: 'REFUSED', outcome: null, failureCode: 'TRANSPORT_FAILED', completedAt: ts('2026-08-28T00:00:00.000Z'), rightsReceipt: [], provider: 'http' });
  // @ts-expect-error EMPTY_RESPONSE is a provider-backed FAILED outcome.
  void scheduler.fail({ runId: 'compile-only', status: 'FAILED', outcome: 'EMPTY', failureCode: 'EMPTY_RESPONSE', completedAt: ts('2026-08-28T00:00:00.000Z'), rightsReceipt: [] });
}
