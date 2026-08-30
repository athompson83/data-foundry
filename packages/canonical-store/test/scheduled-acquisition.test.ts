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
import { artifactRetrievalReceiptId } from '../../acquisition/src/storage/keys.js';
import { seedAcquisitionRightsScopes } from '../../../tests/support/acquisition-rights.js';

let fixtures: Fixtures;
let scheduler: ScheduledAcquisitionStore;
let receiptProvenance = new Map<string, {
  readonly cellId: string;
  readonly decisionId: string;
  readonly termsVersionId: string;
}>();

async function loadReceiptProvenance(sourceId: string): Promise<typeof receiptProvenance> {
  const rows = await fixtures.driver.query<{
    acquisition_route: string;
    operation: string;
    cell_id: string;
    decision_id: string;
    terms_version_id: string;
  }>(
    `SELECT cell.acquisition_route, cell.operation, cell.id AS cell_id,
            decision.id AS decision_id,
            decision.controlling_terms_version_id AS terms_version_id
       FROM rights_cells cell
       JOIN LATERAL (
         SELECT event.decision_id
           FROM rights_decision_activation_events event
          WHERE event.cell_id = cell.id
          ORDER BY event.sequence_no DESC LIMIT 1
       ) active ON TRUE
       JOIN rights_decisions decision ON decision.id = active.decision_id
      WHERE cell.source_id = $1
        AND cell.asset_class = 'DATA'
        AND cell.output_class = 'RAW_RECORD'
        AND cell.channel = 'INTERNAL_PROCESSING'`,
    [sourceId],
  );
  return new Map(rows.map((row) => [
    `${row.acquisition_route}:${row.operation}`,
    {
      cellId: row.cell_id,
      decisionId: row.decision_id,
      termsVersionId: row.terms_version_id,
    },
  ]));
}

beforeAll(async () => {
  fixtures = await createFixtures();
  scheduler = createScheduledAcquisitionStore(fixtures.driver);
  await seedAcquisitionRightsScopes({
    driver: fixtures.driver,
    sourceId: fixtures.sources.manufacturer.source.id,
    scopes: ['DIRECT_HTTP', 'BROWSER_RUN'].map((acquisitionRoute) => ({
      acquisitionRoute,
      assetClass: 'DATA',
      outputClass: 'RAW_RECORD',
    })),
  });
  receiptProvenance = await loadReceiptProvenance(fixtures.sources.manufacturer.source.id);
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
  ...overrides,
});

const runAt = (
  run: ScheduledAcquisitionRun,
  milliseconds: number,
): ScheduledAcquisitionRun['claimedAt'] => ts(
  new Date(Date.parse(run.claimLeaseAcquiredAt) + milliseconds).toISOString(),
);

const terminalTimes = (run: ScheduledAcquisitionRun) => ({
  completedAt: runAt(run, 60_000),
  freshAt: runAt(run, 59_000),
});

const checkpoint = (
  run: ScheduledAcquisitionRun,
  stage: ScheduledRightsReceiptStage,
  index: number,
  permitted: boolean,
  basis: ScheduledRightsReceipt['basis'],
  provenanceMap: typeof receiptProvenance = receiptProvenance,
): ScheduledRightsReceipt => ({
    stage,
    basis,
    scopeDigest: run.rightsScopeDigest,
    evaluatedAt: runAt(run, index),
  decisions: (['ACQUIRE', 'STORE', 'CACHE'] as const).map((operation) => ({
      operation,
      permitted,
      state: permitted ? ('ALLOW' as const) : ('UNKNOWN' as const),
      reasonCode: permitted ? ('ALLOW' as const) : ('NO_GRANT' as const),
      cellId: permitted
        ? provenanceMap.get(`${run.acquisitionRoute}:${operation}`)?.cellId ??
          provenanceMap.get(`DIRECT_HTTP:${operation}`)!.cellId
        : null,
      decisionId: permitted
        ? provenanceMap.get(`${run.acquisitionRoute}:${operation}`)?.decisionId ??
          provenanceMap.get(`DIRECT_HTTP:${operation}`)!.decisionId
        : null,
      termsVersionId: permitted
        ? provenanceMap.get(`${run.acquisitionRoute}:${operation}`)?.termsVersionId ??
          provenanceMap.get(`DIRECT_HTTP:${operation}`)!.termsVersionId
        : null,
    })),
  });

const rightsReceipt = (
  run: ScheduledAcquisitionRun,
  permitted = true,
  provenanceMap: typeof receiptProvenance = receiptProvenance,
): readonly ScheduledRightsReceipt[] => permitted
  ? [
      checkpoint(run, 'INITIAL', 0, true, 'ADMITTED', provenanceMap),
      checkpoint(run, 'PRE_PROVIDER', 1, true, 'ADMITTED', provenanceMap),
      checkpoint(run, 'PRE_TRANSPORT', 2, true, 'ADMITTED', provenanceMap),
      checkpoint(run, 'PRE_PERSISTENCE', 3, true, 'ADMITTED', provenanceMap),
    ]
  : [checkpoint(run, 'INITIAL', 0, false, 'RIGHTS_REFUSED', provenanceMap)];

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
  run: ScheduledAcquisitionRun,
  value: SourceArtifactInsert,
  resultRelation: 'TARGET' | 'CHILD_RESOURCE' = 'TARGET',
) => ({
  artifact: value,
  retrievalKey: `raw/hvac/acme-hvac-catalog/retrieved/2026/08/28/${value.content_hash}.${artifactRetrievalReceiptId(
    run.id,
    value.url,
    value.acquisition_provider,
  )}.json`,
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
      scheduledArtifact(run, { ...value, acquisition_provider: acquisitionProvider }, resultRelation).retrievalKey,
      acquisitionProvider,
    ],
  );
}

async function rawFetchedSuccess(
  run: ScheduledAcquisitionRun,
  receipt: unknown,
  completedAt = runAt(run, 60_000),
  freshAt: ScheduledAcquisitionRun['claimedAt'] = completedAt,
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

  it('redacts the current ownership capability from active and terminal non-winners', async () => {
    const input = claim('2026-08-28T17:02:00.000Z', {
      idempotencyKey: 'redacted-non-winner',
      targetId: 'redacted-non-winner',
    });
    const owner = await scheduler.acquire(input);
    if (owner.disposition !== 'ACQUIRED') throw new Error('fixture claim owner was not acquired');

    const active = await scheduler.acquire(input);
    if (active.disposition !== 'ACTIVE') throw new Error('fixture claim loser was not active');
    expect(Object.keys(active.run).sort()).toEqual(['claimAttempt', 'id', 'retryAt', 'status']);
    expect(active.run).toEqual({
      id: owner.run.id,
      status: 'CLAIMED',
      claimAttempt: owner.run.claimAttempt,
      retryAt: owner.run.claimLeaseExpiresAt,
    });
    expect(JSON.stringify(active)).not.toContain(owner.run.claimToken);

    const exposedUuidValues = Object.values(active.run).filter(
      (value): value is string =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    );
    expect(exposedUuidValues).toEqual([owner.run.id]);
    const attemptedAt = runAt(owner.run, 1_000);
    for (const exposedValue of exposedUuidValues) {
      await expect(scheduler.assertLease(owner.run.id, exposedValue)).rejects.toThrow(
        /current unexpired claim owner/i,
      );
      await expect(scheduler.release({
        runId: owner.run.id,
        claimToken: exposedValue,
        reason: 'UNEXPECTED_ERROR',
      })).resolves.toBeNull();
      await expect(scheduler.fail({
        runId: owner.run.id,
        claimToken: exposedValue,
        status: 'FAILED',
        outcome: null,
        failureCode: 'INTERNAL_ERROR',
        completedAt: attemptedAt,
        rightsReceipt: [],
      })).rejects.toThrow(/current unexpired claim owner/i);
      await expect(scheduler.complete({
        runId: owner.run.id,
        claimToken: exposedValue,
        outcome: 'NOT_MODIFIED',
        completedAt: attemptedAt,
        freshAt: attemptedAt,
        provider: 'http',
        validators: { etag: '"redaction-control"' },
        rightsReceipt: [],
        artifacts: [],
      })).rejects.toThrow(/current unexpired claim owner/i);
    }
    await expect(scheduler.assertLease(owner.run.id, owner.run.claimToken)).resolves.toBeUndefined();

    await scheduler.fail({
      runId: owner.run.id,
      claimToken: owner.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: attemptedAt,
      rightsReceipt: [],
    });
    const terminal = await scheduler.acquire(input);
    if (terminal.disposition !== 'TERMINAL') {
      throw new Error('fixture terminal duplicate was not terminal');
    }
    expect(Object.keys(terminal.run).sort()).toEqual(['claimAttempt', 'id', 'retryAt', 'status']);
    expect(terminal.run).toEqual({
      id: owner.run.id,
      status: 'FAILED',
      claimAttempt: owner.run.claimAttempt,
      retryAt: null,
    });
    expect(JSON.stringify(terminal)).not.toContain(owner.run.claimToken);
  });

  it('fences an active claim, atomically reclaims it after expiry, and rejects the stale owner', async () => {
    const input = claim('2026-08-28T17:05:00.000Z', {
      idempotencyKey: 'lease-recovery',
      targetId: 'lease-recovery',
    });
    const first = await scheduler.acquire(input);
    expect(first.disposition).toBe('ACQUIRED');
    if (first.disposition !== 'ACQUIRED') throw new Error('initial lease claim was not acquired');

    const active = await scheduler.acquire(input);
    expect(active).toMatchObject({
      disposition: 'ACTIVE',
      run: { id: first.run.id, claimAttempt: 1 },
    });

    await expect(
      scheduler.assertLease(first.run.id, first.run.claimToken),
    ).resolves.toBeUndefined();

    const repeated = await scheduler.acquire(input);
    expect(repeated).toMatchObject({
      disposition: 'ACTIVE',
      run: {
        id: first.run.id,
        status: 'CLAIMED',
        claimAttempt: 1,
        retryAt: first.run.claimLeaseExpiresAt,
      },
    });
    expect(JSON.stringify(repeated)).not.toContain(first.run.claimToken);

    await expect(scheduler.release({
      runId: first.run.id,
      claimToken: first.run.claimToken,
      reason: 'UNEXPECTED_ERROR',
    })).resolves.toMatchObject({ status: 'CLAIMED', claimAttempt: 1 });

    const reclaimed = await scheduler.acquire(input);
    expect(reclaimed).toMatchObject({
      disposition: 'ACQUIRED',
      run: { id: first.run.id, claimAttempt: 2, status: 'CLAIMED' },
    });
    if (reclaimed.disposition !== 'ACQUIRED') throw new Error('expired lease was not reclaimed');
    expect(reclaimed.run.claimToken).not.toBe(first.run.claimToken);
    expect(await fixtures.driver.query<{ count: number }>(
      `SELECT count(*)::INTEGER AS count
         FROM scheduled_acquisition_runs WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    )).toEqual([{ count: 1 }]);

    const completionAt = ts(new Date(
      Date.parse(reclaimed.run.claimLeaseAcquiredAt) + 1_000,
    ).toISOString());
    const preReclaimReceipt = [checkpoint(first.run, 'INITIAL', 0, true, 'ADMITTED')];
    await expect(scheduler.fail({
      runId: reclaimed.run.id,
      claimToken: reclaimed.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: completionAt,
      rightsReceipt: preReclaimReceipt,
    })).rejects.toThrow(/timestamp|claim|out of order|rights receipt/i);
    await expect(fixtures.driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = 'FAILED', failure_code = 'INTERNAL_ERROR', completed_at = $2,
              rights_receipt = $3::jsonb
        WHERE id = $1`,
       [reclaimed.run.id, completionAt, JSON.stringify(preReclaimReceipt)],
    )).rejects.toThrow(/receipt|checkpoint|permission/i);

    await expect(scheduler.fail({
      runId: first.run.id,
      claimToken: first.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: completionAt,
      rightsReceipt: [],
    })).rejects.toThrow(/current (?:unexpired )?claim owner|lease/i);

    expect(await scheduler.fail({
      runId: reclaimed.run.id,
      claimToken: reclaimed.run.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: completionAt,
      rightsReceipt: [],
    })).toMatchObject({ status: 'FAILED', claimAttempt: 2 });
  });

  it('rejects backdated terminalization after the server has released the lease', async () => {
    const run = await scheduler.claim(claim('2026-08-28T17:32:00.000Z', {
      idempotencyKey: 'expired-current-owner',
      targetId: 'expired-current-owner',
    }));
    const backdatedCompletion = run!.claimLeaseAcquiredAt;
    await scheduler.release({
      runId: run!.id,
      claimToken: run!.claimToken,
      reason: 'UNEXPECTED_ERROR',
    });

    await expect(scheduler.fail({
      runId: run!.id,
      claimToken: run!.claimToken,
      status: 'FAILED',
      outcome: null,
      failureCode: 'INTERNAL_ERROR',
      completedAt: backdatedCompletion,
      rightsReceipt: [],
    })).rejects.toThrow(/unexpired claim owner|lease/i);

    await expect(fixtures.driver.query(
      `UPDATE scheduled_acquisition_runs
          SET status = 'FAILED', failure_code = 'INTERNAL_ERROR', completed_at = $2
        WHERE id = $1`,
      [run!.id, backdatedCompletion],
    )).rejects.toThrow(/unexpired claim lease/i);
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', claimAttempt: 1 });
  });

  it('rejects a new CLAIMED row whose initial lease shape is not exact', async () => {
    const input = claim('2026-08-28T17:33:00.000Z', {
      idempotencyKey: 'invalid-initial-lease',
      targetId: 'invalid-initial-lease',
    });
    const claimedAt = ts(new Date().toISOString());
    await expect(fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_runs
         (idempotency_key, vertical_slug, source_id, source_key, target_id, target_url,
          acquisition_route, account_or_product_plan, acquisition_jurisdiction,
          asset_class, output_class, result_url_policy, scheduled_for, claimed_at, runtime_digest,
          rights_receipt_contract_version, claim_token, claim_lease_acquired_at,
          claim_lease_expires_at, claim_attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14,
               $15, 2, $16, $14, $17, 2)`,
      [
        input.idempotencyKey, input.verticalSlug, input.sourceId, input.sourceKey,
        input.targetId, input.targetUrl, input.acquisitionRoute, input.accountOrProductPlan,
        input.jurisdiction, input.assetClass, input.outputClass,
        JSON.stringify(input.resultUrlPolicy), input.scheduledFor, claimedAt,
        input.runtimeDigest, crypto.randomUUID(),
        ts(new Date(Date.parse(claimedAt) + 20 * 60_000).toISOString()),
      ],
    )).rejects.toThrow(/exact empty leased CLAIMED attempt/i);
  });

  it.each([
    ['SUCCEEDED', 'FETCHED'],
    ['SUCCEEDED', 'NOT_MODIFIED'],
  ] as const)('rejects a direct terminal INSERT for %s/%s', async (status, outcome) => {
    await expect(fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_runs
         (idempotency_key, vertical_slug, source_id, source_key, target_id, target_url,
          acquisition_route, account_or_product_plan, acquisition_jurisdiction,
          asset_class, output_class, result_url_policy, scheduled_for, claimed_at,
          completed_at, fresh_at, status, outcome, provider, validators,
          expected_artifact_count, artifact_count, runtime_digest)
       VALUES ($1, 'hvac', $2, 'acme-hvac-catalog', 'raw-terminal-insert', $3,
               'DIRECT_HTTP', NULL, NULL, 'DATA', 'RAW_RECORD', $4::jsonb,
               $5, $5, $6, $6, $7, $8, 'http', $9::jsonb, 1, 1, $10)`,
      [
        `raw-terminal-insert-${outcome}`,
        fixtures.sources.manufacturer.source.id,
        claim().targetUrl,
        JSON.stringify(claim().resultUrlPolicy),
        ts('2026-08-28T14:00:00.000Z'),
        ts('2026-08-28T14:01:00.000Z'),
        status,
        outcome,
        JSON.stringify(outcome === 'NOT_MODIFIED' ? { etag: '"v1"' } : {}),
        'a'.repeat(64),
      ],
    )).rejects.toThrow(/inserted as (?:one exact )?(?:empty leased )?CLAIMED/i);
  });

  it.each([
    ['plain origin', 'https://catalog.acme-climate.example.com', true],
    ['maximum port', 'https://catalog.acme-climate.example.com:65535', true],
    ['zero port', 'https://catalog.acme-climate.example.com:0', false],
    ['default port', 'https://catalog.acme-climate.example.com:443', false],
    ['above maximum port', 'https://catalog.acme-climate.example.com:65536', false],
    ['five-digit invalid port', 'https://catalog.acme-climate.example.com:99999', false],
    ['credential-bearing origin', 'https://user:secret@catalog.acme-climate.example.com', false],
  ] as const)('keeps TypeScript/Postgres origin policy parity: %s', async (_label, origin, accepted) => {
    const policy = { allowedOrigins: [origin], allowedPathPrefixes: ['/api/v2/catalog'] };
    const rows = await fixtures.driver.query<{ valid: boolean }>(
      `SELECT scheduled_acquisition_result_url_policy_valid($1::jsonb) AS valid`,
      [JSON.stringify(policy)],
    );
    expect(rows[0]?.valid).toBe(accepted);
    const attempt = scheduler.claim(claim('2026-08-28T13:00:00.000Z', {
      idempotencyKey: `origin-vector-${_label}`,
      targetId: `origin-vector-${_label.replaceAll(' ', '-')}`,
      targetUrl: `${origin}/api/v2/catalog`,
      resultUrlPolicy: policy,
    }));
    if (accepted) expect(await attempt).not.toBeNull();
    else await expect(attempt).rejects.toThrow(/origin|policy/i);
  });

  it.each([
    ['duplicate origin', {
      allowedOrigins: [
        'https://catalog.acme-climate.example.com',
        'https://catalog.acme-climate.example.com',
      ],
      allowedPathPrefixes: ['/api/v2/catalog'],
    }],
    ['unpaired multiple origins', {
      allowedOrigins: [
        'https://catalog.acme-climate.example.com',
        'https://neighbor.acme-climate.example.com',
      ],
      allowedPathPrefixes: ['/api/v2/catalog'],
    }],
    ['duplicate prefix', {
      allowedOrigins: ['https://catalog.acme-climate.example.com'],
      allowedPathPrefixes: ['/api/v2/catalog', '/api/v2/catalog'],
    }],
  ] as const)('rejects duplicate policy entries in TypeScript and Postgres: %s', async (_label, policy) => {
    const rows = await fixtures.driver.query<{ valid: boolean }>(
      `SELECT scheduled_acquisition_result_url_policy_valid($1::jsonb) AS valid`,
      [JSON.stringify(policy)],
    );
    expect(rows[0]?.valid).toBe(false);
    await expect(scheduler.claim(claim('2026-08-28T13:01:00.000Z', {
      idempotencyKey: `duplicate-policy-${_label}`,
      targetId: `duplicate-policy-${_label.replaceAll(' ', '-')}`,
      resultUrlPolicy: policy,
    }))).rejects.toThrow(/unique|exactly one origin/i);
  });

  it.each([
    ['literal dot segment', '/api/v2/catalog/../admin'],
    ['encoded dot segment', '/api/v2/catalog/%2e%2e/admin'],
    ['encoded slash', '/api/v2/catalog%2fadmin'],
    ['encoded backslash', '/api/v2/catalog%5cadmin'],
    ['literal backslash', '/api/v2/catalog\\admin'],
  ] as const)('rejects unsafe path vector in TypeScript and Postgres: %s', async (_label, unsafePrefix) => {
    const policy = {
      allowedOrigins: ['https://catalog.acme-climate.example.com'],
      allowedPathPrefixes: ['/api/v2/catalog', unsafePrefix],
    };
    const rows = await fixtures.driver.query<{ valid: boolean }>(
      `SELECT scheduled_acquisition_result_url_policy_valid($1::jsonb) AS valid`,
      [JSON.stringify(policy)],
    );
    expect(rows[0]?.valid).toBe(false);
    await expect(scheduler.claim(claim('2026-08-28T13:02:00.000Z', {
      idempotencyKey: `path-vector-${_label}`,
      targetId: `path-vector-${_label.replaceAll(' ', '-')}`,
      resultUrlPolicy: policy,
    }))).rejects.toThrow(/path prefix/i);
  });

  it.each([
    ['TARGET', 'DIRECT_HTTP', 'https://catalog.acme-climate.example.com/api/v2/catalog/../admin'],
    ['TARGET', 'DIRECT_HTTP', 'https://catalog.acme-climate.example.com/api/v2/catalog/./page'],
    ['CHILD_RESOURCE', 'BROWSER_RUN', 'https://catalog.acme-climate.example.com/api/v2/catalog/../admin'],
    ['CHILD_RESOURCE', 'BROWSER_RUN', 'https://catalog.acme-climate.example.com/api/v2/catalog/./page'],
  ] as const)(
    'rejects a literal dot-segment %s result through the database URL function',
    async (relation, route, resultUrl) => {
      const targetUrl = relation === 'TARGET' ? resultUrl : claim().targetUrl;
      const rows = await fixtures.driver.query<{ allowed: boolean }>(
        `SELECT scheduled_acquisition_result_url_allowed(
           $1, $2, $3::jsonb, $4, $5
         ) AS allowed`,
        [targetUrl, route, JSON.stringify(claim().resultUrlPolicy), resultUrl, relation],
      );
      expect(rows).toEqual([{ allowed: false }]);
    },
  );
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
      [run!.id, persisted.id, run!.targetUrl, scheduledArtifact(run!, artifact(suffix)).retrievalKey],
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
          runAt(run!, 60_000),
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
    [
      'JSON-null stage',
      '2026-08-28T15:00:00.000Z',
      (receipt: any[]) => { receipt[0].stage = null; },
    ],
    [
      'JSON-null basis',
      '2026-08-28T15:01:00.000Z',
      (receipt: any[]) => { receipt[0].basis = null; },
    ],
    [
      'JSON-null operation',
      '2026-08-28T15:02:00.000Z',
      (receipt: any[]) => { receipt[0].decisions[0].operation = null; },
    ],
    [
      'year zero timestamp',
      '2026-08-28T15:03:00.000Z',
      (receipt: any[]) => { receipt[0].evaluatedAt = '0000-08-28T17:00:01.000Z'; },
    ],
    [
      'engine-impossible state and reason',
      '2026-08-28T15:04:00.000Z',
      (receipt: any[]) => {
        receipt[0].decisions[0].permitted = false;
        receipt[0].decisions[0].state = 'DENY';
        receipt[0].decisions[0].reasonCode = 'ALLOW';
      },
    ],
    [
      'fabricated but well-formed provenance UUID',
      '2026-08-28T15:05:00.000Z',
      (receipt: any[]) => {
        receipt[0].decisions[0].decisionId = 'deadbeef-dead-4bee-8bee-deadbeefdead';
      },
    ],
    [
      'neighboring route provenance replay',
      '2026-08-28T15:06:00.000Z',
      (receipt: any[]) => {
        const provenance = receiptProvenance.get('BROWSER_RUN:ACQUIRE')!;
        Object.assign(receipt[0].decisions[0], provenance);
      },
    ],
    [
      'cross-operation provenance replay',
      '2026-08-28T15:07:00.000Z',
      (receipt: any[]) => {
        const provenance = receiptProvenance.get('DIRECT_HTTP:STORE')!;
        Object.assign(receipt[0].decisions[0], provenance);
      },
    ],
    [
      'conditional allow without durable condition evidence',
      '2026-08-28T15:08:00.000Z',
      (receipt: any[]) => {
        receipt[0].decisions[0].state = 'CONDITIONAL';
        receipt[0].decisions[0].reasonCode = 'CONDITIONAL_ALLOW';
      },
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
        claimToken: neighbor!.claimToken,
        outcome: 'FETCHED',
        ...terminalTimes(neighbor!),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(first!),
        artifacts: [scheduledArtifact(neighbor!, artifact('6'))],
      }),
    ).rejects.toThrow(/scope/i);
    expect((await scheduler.get(neighbor!.id))?.freshAt).toBeNull();
  });

  it('commits every artifact link before publishing FETCHED success', async () => {
    const run = await scheduler.claim(claim('2026-08-28T18:00:00.000Z'));
    expect(run).not.toBeNull();

    const completed = await scheduler.complete({
      runId: run!.id,
      claimToken: run!.claimToken,
      outcome: 'FETCHED',
      ...terminalTimes(run!),
      provider: 'http',
      validators: { etag: '"v1"' },
      rightsReceipt: rightsReceipt(run!),
      artifacts: [scheduledArtifact(run!, artifact('b')), scheduledArtifact(run!, artifact('c'))],
    });

    expect(completed).toMatchObject({
      status: 'SUCCEEDED',
      outcome: 'FETCHED',
      expectedArtifactCount: 2,
      artifactCount: 2,
    });
    expect(await scheduler.latestSuccessAt(run!)).toBe(terminalTimes(run!).freshAt);
    expect(
      Number((await fixtures.driver.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM scheduled_acquisition_run_artifacts WHERE run_id = $1`,
        [run!.id],
      ))[0]?.count),
    ).toBe(2);
  });

  it.each([
    ['target URL', { targetUrl: 'https://catalog.acme-climate.example.com/api/v2/catalog/changed' }],
    ['route', { acquisitionRoute: 'VENDOR_API' }],
    ['plan', { accountOrProductPlan: 'paid-plan' }],
    ['jurisdiction', { jurisdiction: 'US' }],
    ['asset class', { assetClass: 'DOCUMENT' }],
    ['output class', { outputClass: 'NORMALIZED_FACT' }],
    ['runtime digest', { runtimeDigest: 'b'.repeat(64) }],
    ['result URL policy', {
      resultUrlPolicy: {
        allowedOrigins: ['https://catalog.acme-climate.example.com'],
        allowedPathPrefixes: ['/api/v2'],
      },
    }],
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
    const beforeFreshness = await scheduler.latestSuccessAt(run!);

    await expect(
      scheduler.complete({
        runId: run!.id,
        claimToken: run!.claimToken,
        outcome: 'FETCHED',
        ...terminalTimes(run!),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(run!),
        artifacts: [
          scheduledArtifact(run!, artifact('d')),
          scheduledArtifact(run!, { ...artifact('e'), content_hash: 'not-a-hash' }),
        ],
      }),
    ).rejects.toThrow();

    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
    expect(await scheduler.latestSuccessAt(run!)).toBe(beforeFreshness);
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
        claimToken: run!.claimToken,
        outcome: 'FETCHED',
        ...terminalTimes(run!),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(run!),
        artifacts: [scheduledArtifact(run!, { ...artifact('f'), ...override })],
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
        claimToken: run!.claimToken,
        outcome: 'FETCHED',
        ...terminalTimes(run!),
        provider: 'http',
        validators: {},
        rightsReceipt: rightsReceipt(run!),
        artifacts: [scheduledArtifact(run!, { ...artifact('f'), acquisition_provider: 'neighbor-provider' })],
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
          scheduledArtifact(run!, artifact('9')).retrievalKey,
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
      [run!.id, neighboring.id, run!.targetUrl, scheduledArtifact(run!, { ...artifact('8'), acquisition_provider: 'browser-run' }).retrievalKey],
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
          run!.id, runAt(run!, 60_000),
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
      claimToken: first!.claimToken,
      outcome: 'FETCHED',
      ...terminalTimes(first!),
      provider: 'browser-run',
      validators: {},
      rightsReceipt: rightsReceipt(first!),
      artifacts: [scheduledArtifact(first!, firstArtifact)],
    });

    const second = await scheduler.claim(claim('2026-08-28T19:50:00.000Z', {
      targetId: 'cross-provider',
      acquisitionRoute: 'BROWSER_RUN',
    }));
    await scheduler.complete({
      runId: second!.id,
      claimToken: second!.claimToken,
      outcome: 'FETCHED',
      ...terminalTimes(second!),
      provider: 'fixture',
      validators: {},
      rightsReceipt: rightsReceipt(second!),
      artifacts: [scheduledArtifact(second!, {
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
    const retrievals = await fixtures.driver.query<{
      run_id: string;
      acquisition_provider: string;
      retrieval_receipt_id: string;
      retrieval_key: string;
    }>(
        `SELECT run_id, acquisition_provider, retrieval_receipt_id, retrieval_key
           FROM scheduled_acquisition_run_artifacts
          WHERE run_id IN ($1, $2)`,
        [first!.id, second!.id],
      );
    const retrievalByRun = new Map(retrievals.map((retrieval) => [retrieval.run_id, retrieval]));
    expect(retrievalByRun.get(first!.id)).toMatchObject({
      acquisition_provider: 'browser-run',
      retrieval_receipt_id: artifactRetrievalReceiptId(first!.id, first!.targetUrl, 'browser-run'),
    });
    expect(retrievalByRun.get(second!.id)).toMatchObject({
      acquisition_provider: 'fixture',
      retrieval_receipt_id: artifactRetrievalReceiptId(second!.id, second!.targetUrl, 'fixture'),
    });
    expect(retrievalByRun.get(first!.id)?.retrieval_receipt_id).not.toBe(
      retrievalByRun.get(second!.id)?.retrieval_receipt_id,
    );
    for (const retrieval of retrievals) {
      expect(retrieval.retrieval_key).toMatch(
        new RegExp(`\\.${retrieval.retrieval_receipt_id}\\.json$`),
      );
    }
  });

  it('rejects a legacy day/content retrieval key that is not bound to this exact fetch', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:51:30.000Z', {
      targetId: 'unbound-retrieval-key',
    }));
    const persisted = await fixtures.store.recordSourceArtifact(artifact('1'));
    await expect(fixtures.driver.query(
      `INSERT INTO scheduled_acquisition_run_artifacts
         (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
          retrieval_key, acquisition_provider)
       VALUES ($1, $2, 0, $3, $3, 'TARGET', $4, 'http')`,
      [
        run!.id,
        persisted.id,
        run!.targetUrl,
        `raw/hvac/acme-hvac-catalog/retrieved/2026/08/28/${persisted.content_hash}.json`,
      ],
    )).rejects.toThrow(/retrieval receipt is not bound/i);
    expect(await fixtures.driver.query(
      `SELECT 1 FROM scheduled_acquisition_run_artifacts WHERE run_id = $1`,
      [run!.id],
    )).toEqual([]);
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
    const before = await countRows(fixtures.driver, 'source_artifacts');
    for (const url of [
      'https://off-scope.example.com/api/v2/catalog?page=2',
      'https://catalog.acme-climate.example.com/admin?page=2',
      'https://catalog.acme-climate.example.com/api/v2/catalog/%2e%2e/admin',
      'https://catalog.acme-climate.example.com/api/v2/catalog/../admin',
      'https://catalog.acme-climate.example.com/api/v2/catalog/./page',
    ]) {
      await expect(
        scheduler.complete({
          runId: run!.id,
          claimToken: run!.claimToken,
          outcome: 'FETCHED',
          ...terminalTimes(run!),
          provider: 'browser-run',
          validators: {},
          rightsReceipt: rightsReceipt(run!),
          artifacts: [scheduledArtifact(run!, { ...childBase, url }, 'CHILD_RESOURCE')],
        }),
      ).rejects.toThrow(/associated with the claimed target/i);
      expect((await scheduler.get(run!.id))?.status).toBe('CLAIMED');
      expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
    }

    const targetArtifact = { ...childBase, content_hash: 'b'.repeat(64) };
    const childArtifact = {
      ...childBase,
      url: `${run!.targetUrl}?page=2`,
      content_hash: 'c'.repeat(64),
    };
    await scheduler.complete({
      runId: run!.id,
      claimToken: run!.claimToken,
      outcome: 'FETCHED',
      ...terminalTimes(run!),
      provider: 'browser-run',
      validators: {},
      rightsReceipt: rightsReceipt(run!),
      artifacts: [
        scheduledArtifact(run!, targetArtifact, 'TARGET'),
        scheduledArtifact(run!, childArtifact, 'CHILD_RESOURCE'),
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

  it('revalidates a legacy literal-dot child link at the direct terminal boundary', async () => {
    const run = await scheduler.claim(claim('2026-08-28T19:55:00.000Z', {
      targetId: 'legacy-literal-dot-link',
      acquisitionRoute: 'BROWSER_RUN',
    }));
    const malicious = {
      ...artifact('7'),
      url: 'https://catalog.acme-climate.example.com/api/v2/catalog/../admin',
      acquisition_route: 'BROWSER_RUN' as const,
    };
    const persisted = await fixtures.store.recordSourceArtifact(malicious);
    await fixtures.driver.exec(
      'ALTER TABLE scheduled_acquisition_run_artifacts DISABLE TRIGGER scheduled_acquisition_run_artifact_insert_guard',
    );
    try {
      await fixtures.driver.query(
        `INSERT INTO scheduled_acquisition_run_artifacts
           (run_id, artifact_id, ordinal, target_url, result_url, result_relation,
            retrieval_key, retrieval_receipt_id, acquisition_provider)
         VALUES ($1, $2, 0, $3, $4, 'CHILD_RESOURCE', $5, $6, 'http')`,
        [
          run!.id,
          persisted.id,
          run!.targetUrl,
          malicious.url,
          scheduledArtifact(run!, malicious, 'CHILD_RESOURCE').retrievalKey,
          artifactRetrievalReceiptId(run!.id, malicious.url, 'http'),
        ],
      );
    } finally {
      await fixtures.driver.exec(
        'ALTER TABLE scheduled_acquisition_run_artifacts ENABLE TRIGGER scheduled_acquisition_run_artifact_insert_guard',
      );
    }

    await expect(rawFetchedSuccess(run!, rightsReceipt(run!))).rejects.toThrow(/target policy/i);
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
  });

  it('treats NOT_MODIFIED as successful freshness without inventing artifacts', async () => {
    const run = await scheduler.claim(claim('2026-08-28T20:00:00.000Z'));
    const completed = await scheduler.complete({
      runId: run!.id,
      claimToken: run!.claimToken,
      outcome: 'NOT_MODIFIED',
      ...terminalTimes(run!),
      provider: 'http',
      validators: { etag: '"v1"' },
      rightsReceipt: rightsReceipt(run!),
      artifacts: [],
    });

    expect(completed).toMatchObject({ status: 'SUCCEEDED', outcome: 'NOT_MODIFIED' });
    expect(await scheduler.latestSuccessAt(run!)).toBe(terminalTimes(run!).freshAt);
  });

  it('does not manufacture freshness from a first-ever NOT_MODIFIED response', async () => {
    const run = await scheduler.claim(
      claim('2026-08-28T20:10:00.000Z', { targetId: 'never-fetched' }),
    );
    await expect(
      scheduler.complete({
        runId: run!.id,
        claimToken: run!.claimToken,
        outcome: 'NOT_MODIFIED',
        ...terminalTimes(run!),
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
        claimToken: run!.claimToken,
        outcome: 'NOT_MODIFIED',
        ...terminalTimes(run!),
        provider: 'http',
        validators: { etag: '"v1"' },
        rightsReceipt: rightsReceipt(run!),
        artifacts: [],
      }),
    ).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it('does not reuse FETCHED history from a neighboring result URL policy for NOT_MODIFIED', async () => {
    const run = await scheduler.claim(claim('2026-08-28T20:13:30.000Z', {
      resultUrlPolicy: {
        allowedOrigins: ['https://catalog.acme-climate.example.com'],
        allowedPathPrefixes: ['/api/v2'],
      },
    }));
    await expect(scheduler.complete({
      runId: run!.id,
      claimToken: run!.claimToken,
      outcome: 'NOT_MODIFIED',
      ...terminalTimes(run!),
      provider: 'http',
      validators: { etag: '"v1"' },
      rightsReceipt: rightsReceipt(run!),
      artifacts: [],
    })).rejects.toThrow(/prior artifact-backed fetched success/i);
    expect((await scheduler.get(run!.id))?.freshAt).toBeNull();
  });

  it.each([
    ['encoded dot segment', '/api/v2/catalog/%2e%2e/admin'],
    ['encoded path separator', '/api/v2/catalog%2fadmin'],
    ['encoded backslash', '/api/v2/catalog%5cadmin'],
  ] as const)('rejects a claim policy with an %s', async (_label, prefix) => {
    await expect(scheduler.claim(claim('2026-08-28T16:00:00.000Z', {
      idempotencyKey: `unsafe-policy-${prefix}`,
      targetId: `unsafe-policy-${_label.replaceAll(' ', '-')}`,
      resultUrlPolicy: {
        allowedOrigins: ['https://catalog.acme-climate.example.com'],
        allowedPathPrefixes: [prefix],
      },
    }))).rejects.toThrow(/path prefix|result URL policy/i);
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
          runAt(run!, 60_000),
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
    const completedAt = ts(new Date(Date.parse(run!.claimedAt) + 10 * 60_000).toISOString());
    const freshAt = ts(new Date(Date.parse(run!.claimedAt) + 9 * 60_000).toISOString());
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
        claimToken: run!.claimToken,
        outcome: 'FETCHED',
        completedAt,
        freshAt,
        provider: 'http',
        validators: {},
        rightsReceipt: receipt,
        artifacts: [scheduledArtifact(run!, artifact('7'))],
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
        claimToken: run!.claimToken,
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
      claimToken: skipped!.claimToken,
      status: 'SKIPPED',
      outcome: null,
      failureCode: 'NOT_DUE',
      completedAt: runAt(skipped!, 60_000),
      rightsReceipt: notDueReceipt(skipped!),
    })).toMatchObject({ status: 'SKIPPED', failureCode: 'NOT_DUE' });

    const refused = await scheduler.claim(claim('2026-08-28T20:54:00.000Z', { targetId: 'refuse-valid' }));
    const refusalReceipt = [
      rightsReceipt(refused!)[0]!,
      checkpoint(refused!, 'PRE_PROVIDER', 1, false, 'RIGHTS_REFUSED'),
    ];
    expect(await scheduler.fail({
      runId: refused!.id,
      claimToken: refused!.claimToken,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'RIGHTS_REFUSED',
      completedAt: runAt(refused!, 60_000),
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
    const completedAt = runAt(run!, 60_000);
    const input = kind === 'SKIPPED'
      ? {
          runId: run!.id, claimToken: run!.claimToken,
          status: 'SKIPPED', outcome: null, failureCode: 'NOT_DUE',
          completedAt, rightsReceipt: [admitted],
        }
      : kind === 'FAILED'
        ? {
            runId: run!.id, claimToken: run!.claimToken,
            status: 'FAILED', outcome: null, failureCode: 'INTERNAL_ERROR',
            completedAt, rightsReceipt: [
              { ...admitted, basis: 'RIGHTS_REFUSED', decisions: deniedTransport.decisions },
            ],
          }
        : {
            runId: run!.id, claimToken: run!.claimToken,
            status: 'REFUSED', outcome: null, failureCode: 'RIGHTS_REFUSED',
            completedAt, rightsReceipt: kind === 'REFUSED_STAGE'
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
      claimToken: typed!.claimToken,
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
    const beforeFreshness = await scheduler.latestSuccessAt(empty!);
    await scheduler.fail({
      runId: empty!.id,
      claimToken: empty!.claimToken,
      status: 'FAILED',
      outcome: 'EMPTY',
      failureCode: 'EMPTY_RESPONSE',
      completedAt: runAt(empty!, 60_000),
      rightsReceipt: rightsReceipt(empty!),
      provider: 'http',
    });
    await scheduler.fail({
      runId: refused!.id,
      claimToken: refused!.claimToken,
      status: 'REFUSED',
      outcome: null,
      failureCode: 'RIGHTS_REFUSED',
      completedAt: runAt(refused!, 60_000),
      rightsReceipt: rightsReceipt(refused!, false),
    });

    expect(await scheduler.latestSuccessAt(empty!)).toBe(beforeFreshness);
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
    ).rejects.toThrow(/claim identity and (?:scope|state) are immutable/i);
  });

  it('rejects success after the source kill switch engages, without publishing freshness', async () => {
    const source = fixtures.sources.certifier.source;
    await seedAcquisitionRightsScopes({
      driver: fixtures.driver,
      sourceId: source.id,
      scopes: [{ acquisitionRoute: 'DIRECT_HTTP', assetClass: 'DATA', outputClass: 'RAW_RECORD' }],
    });
    const provenance = await loadReceiptProvenance(source.id);
    const run = await scheduler.claim(claim('2026-08-28T23:10:00.000Z', {
      idempotencyKey: 'current-source-kill-switch',
      sourceId: source.id,
      sourceKey: 'ratings-directory',
      targetId: 'current-source-kill-switch',
    }));
    const value = { ...artifact('1'), source_id: source.id };
    await linkRawArtifact(run!, value);
    await fixtures.driver.query(`UPDATE sources SET kill_switch_engaged = TRUE WHERE id = $1`, [source.id]);
    await expect(rawFetchedSuccess(run!, rightsReceipt(run!, true, provenance))).rejects.toThrow(
      /provenance/i,
    );
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
    await fixtures.driver.query(`UPDATE sources SET kill_switch_engaged = FALSE WHERE id = $1`, [source.id]);
  });

  it('rejects a receipt whose decision was superseded before terminal success', async () => {
    const source = fixtures.sources.filing.source;
    await seedAcquisitionRightsScopes({
      driver: fixtures.driver,
      sourceId: source.id,
      scopes: [{ acquisitionRoute: 'DIRECT_HTTP', assetClass: 'DATA', outputClass: 'RAW_RECORD' }],
    });
    const provenance = await loadReceiptProvenance(source.id);
    const run = await scheduler.claim(claim('2026-08-28T23:11:00.000Z', {
      idempotencyKey: 'superseded-rights-receipt',
      sourceId: source.id,
      sourceKey: 'federal-equipment-register',
      targetId: 'superseded-rights-receipt',
    }));
    await linkRawArtifact(run!, { ...artifact('2'), source_id: source.id });
    const priorDecision = provenance.get('DIRECT_HTTP:ACQUIRE')!.decisionId;
    const successor = crypto.randomUUID();
    await fixtures.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, effective_until,
          recheck_at, rationale, supersedes_decision_id, created_by)
       SELECT $1, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
              review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, effective_until,
              recheck_at, rationale, $2, created_by
         FROM rights_decisions WHERE id = $2`,
      [successor, priorDecision],
    );
    await fixtures.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'supersede before completion', $2)`,
      [successor, ts('2026-08-28T18:00:00.000Z')],
    );
    await expect(rawFetchedSuccess(run!, rightsReceipt(run!, true, provenance))).rejects.toThrow(
      /provenance/i,
    );
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
  });

  it('rejects a receipt whose controlling terms were revoked before terminal success', async () => {
    const source = fixtures.sources.aggregator.source;
    await seedAcquisitionRightsScopes({
      driver: fixtures.driver,
      sourceId: source.id,
      scopes: [{ acquisitionRoute: 'DIRECT_HTTP', assetClass: 'DATA', outputClass: 'RAW_RECORD' }],
    });
    const provenance = await loadReceiptProvenance(source.id);
    const run = await scheduler.claim(claim('2026-08-28T23:12:00.000Z', {
      idempotencyKey: 'revoked-terms-receipt',
      sourceId: source.id,
      sourceKey: 'spec-aggregator',
      targetId: 'revoked-terms-receipt',
    }));
    await linkRawArtifact(run!, { ...artifact('3'), source_id: source.id });
    await fixtures.driver.query(
      `SELECT revoke_rights_terms($1, 'HUMAN', 'test-fixture', 'revoke before completion', $2)`,
      [
        provenance.get('DIRECT_HTTP:ACQUIRE')!.termsVersionId,
        ts('2026-08-28T18:00:00.000Z'),
      ],
    );
    await expect(rawFetchedSuccess(run!, rightsReceipt(run!, true, provenance))).rejects.toThrow(
      /provenance/i,
    );
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
  });

  it('rejects a receipt whose controlling terms are stale at terminal time', async () => {
    const source = fixtures.sources.editorial.source;
    await seedAcquisitionRightsScopes({
      driver: fixtures.driver,
      sourceId: source.id,
      scopes: [{ acquisitionRoute: 'DIRECT_HTTP', assetClass: 'DATA', outputClass: 'RAW_RECORD' }],
      termsRecheckAt: '2026-08-28T18:00:00.000Z',
    });
    const provenance = await loadReceiptProvenance(source.id);
    const run = await scheduler.claim(claim('2026-08-28T23:13:00.000Z', {
      idempotencyKey: 'stale-terms-receipt',
      sourceId: source.id,
      sourceKey: 'data-foundry-editorial',
      targetId: 'stale-terms-receipt',
    }));
    await linkRawArtifact(run!, { ...artifact('4'), source_id: source.id });
    await expect(rawFetchedSuccess(run!, rightsReceipt(run!, true, provenance))).rejects.toThrow(
      /provenance/i,
    );
    expect(await scheduler.get(run!.id)).toMatchObject({ status: 'CLAIMED', freshAt: null });
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
