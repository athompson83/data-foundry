import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createPGliteDriver,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

const VERTICAL = '91000000-0000-4000-8000-000000000001';
const SOURCE = '91000000-0000-4000-8000-000000000002';
const CLAIMED_AT = '2026-08-28T17:00:01.000Z';
const COMPLETED_AT = '2026-08-28T17:01:00.000Z';
const TARGET = 'https://migration-receipts.example.test/catalog';
const POLICY = JSON.stringify({
  allowedOrigins: ['https://migration-receipts.example.test'],
  allowedPathPrefixes: ['/catalog'],
});

let driver: MigrationDriver;
let migrations: Migration[];
let historicalRunId: string;
let historicalScopeDigest: string;
let inFlightRunId: string;
let inFlightScopeDigest: string;

const checkpoint = (stage: string, scopeDigest: string, offset: number) => ({
  stage,
  basis: 'ADMITTED',
  scopeDigest,
  evaluatedAt: new Date(Date.parse(CLAIMED_AT) + offset).toISOString(),
  decisions: (['ACQUIRE', 'STORE', 'CACHE'] as const).map((operation, index) => ({
    operation,
    permitted: true,
    state: 'ALLOW',
    reasonCode: 'ALLOW',
    cellId: `92000000-0000-4000-8000-00000000000${index + 1}`,
    decisionId: `93000000-0000-4000-8000-00000000000${index + 1}`,
    termsVersionId: `94000000-0000-4000-8000-00000000000${index + 1}`,
  })),
});

const receipt = (scopeDigest: string, stages: readonly string[]) =>
  stages.map((stage, index) => checkpoint(stage, scopeDigest, index));

async function insertClaim(idempotencyKey: string, targetId: string) {
  const rows = await driver.query<{ id: string; rights_scope_digest: string }>(
    `INSERT INTO scheduled_acquisition_runs
       (idempotency_key, vertical_slug, source_id, source_key, target_id, target_url,
        acquisition_route, asset_class, output_class, result_url_policy,
        scheduled_for, claimed_at, runtime_digest)
     VALUES ($1, 'migration-receipts', $2, 'migration-receipts', $3, $4,
             'DIRECT_HTTP', 'DATA', 'RAW_RECORD', $5::jsonb,
             '2026-08-28T17:00:00.000Z', $6, $7)
     RETURNING id, rights_scope_digest`,
    [idempotencyKey, SOURCE, targetId, TARGET, POLICY, CLAIMED_AT, 'a'.repeat(64)],
  );
  return rows[0]!;
}

beforeAll(async () => {
  migrations = await loadMigrations();
  expect(migrations.at(-1)?.version).toBe('0019');
  driver = await createPGliteDriver();
  await applyMigrations(driver, migrations.filter(({ version }) => version < '0019'));
  await driver.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'migration-receipts', 'Migration receipts', '1.0.0', 'ACTIVE', '{}'::jsonb)`,
    [VERTICAL],
  );
  await driver.query(
    `INSERT INTO sources
       (id, vertical_id, publisher, domain, source_type, authority_rank,
        rights_classification, attribution_requirement, robots_policy,
        refresh_cadence, status)
     VALUES ($1, $2, 'Migration receipts', 'migration-receipts.example.test',
             'MANUFACTURER', 50, 'GREEN', $3::jsonb, $4::jsonb, 'WEEKLY', 'ACTIVE')`,
    [
      SOURCE,
      VERTICAL,
      JSON.stringify({ required: false, text: null, url: null }),
      JSON.stringify({
        respect_robots: true,
        user_agent: 'DataFoundryBot/test',
        crawl_delay_seconds: 0,
        disallowed_paths: [],
        allowed_paths: [],
        robots_url: null,
        snapshot_hash: null,
        snapshot_at: null,
      }),
    ],
  );
  const historical = await insertClaim('receipt-contract-v1-history', 'v1-history');
  historicalRunId = historical.id;
  historicalScopeDigest = historical.rights_scope_digest;
  const inFlight = await insertClaim('receipt-contract-v1-in-flight', 'v1-in-flight');
  inFlightRunId = inFlight.id;
  inFlightScopeDigest = inFlight.rights_scope_digest;
  await driver.exec(
    'ALTER TABLE scheduled_acquisition_runs DISABLE TRIGGER scheduled_acquisition_runs_terminal_immutable',
  );
  await driver.query(
    `UPDATE scheduled_acquisition_runs
        SET status = 'SUCCEEDED', outcome = 'FETCHED', completed_at = $2, fresh_at = $2,
            provider = 'http', expected_artifact_count = 1, artifact_count = 1,
            rights_receipt = $3::jsonb
      WHERE id = $1`,
    [
      historicalRunId,
      COMPLETED_AT,
      JSON.stringify(receipt(historicalScopeDigest, ['INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT'])),
    ],
  );
  await driver.exec(
    'ALTER TABLE scheduled_acquisition_runs ENABLE TRIGGER scheduled_acquisition_runs_terminal_immutable',
  );
  await applyMigrations(driver, migrations);
});

afterAll(async () => driver?.close());

describe('0019 scheduled acquisition pre-persistence receipt contract', () => {
  it('preserves a historical three-checkpoint success as contract v1', async () => {
    const rows = await driver.query<{
      rights_receipt_contract_version: number;
      checkpoint_count: number;
    }>(
      `SELECT rights_receipt_contract_version,
              jsonb_array_length(rights_receipt)::INTEGER AS checkpoint_count
         FROM scheduled_acquisition_runs WHERE id = $1`,
      [historicalRunId],
    );
    expect(rows).toEqual([{ rights_receipt_contract_version: 1, checkpoint_count: 3 }]);
  });

  it('preserves an in-flight claim as v1 for its original owner', async () => {
    const rows = await driver.query<{
      rights_receipt_contract_version: number;
      status: string;
      checkpoint_count: number;
      three_valid: boolean;
      four_valid: boolean;
    }>(
      `SELECT rights_receipt_contract_version, status,
              jsonb_array_length(rights_receipt)::INTEGER AS checkpoint_count,
              scheduled_acquisition_receipt_valid_for_contract(
                $2::jsonb, 'SUCCEEDED', rights_scope_digest,
                claimed_at, $3::timestamptz, rights_receipt_contract_version
              ) AS three_valid,
              scheduled_acquisition_receipt_valid_for_contract(
                $4::jsonb, 'SUCCEEDED', rights_scope_digest,
                claimed_at, $3::timestamptz, rights_receipt_contract_version
              ) AS four_valid
         FROM scheduled_acquisition_runs WHERE id = $1`,
      [
        inFlightRunId,
        JSON.stringify(receipt(inFlightScopeDigest, [
          'INITIAL',
          'PRE_PROVIDER',
          'PRE_TRANSPORT',
        ])),
        COMPLETED_AT,
        JSON.stringify(receipt(inFlightScopeDigest, [
          'INITIAL',
          'PRE_PROVIDER',
          'PRE_TRANSPORT',
          'PRE_PERSISTENCE',
        ])),
      ],
    );
    expect(rows).toEqual([{
      rights_receipt_contract_version: 1,
      status: 'CLAIMED',
      checkpoint_count: 0,
      three_valid: true,
      four_valid: false,
    }]);
  });

  it('claims new rows as contract v2 and rejects a three-stage success or invalid stage order', async () => {
    const run = await insertClaim('receipt-contract-v2-new', 'v2-new');
    const rows = await driver.query<{ rights_receipt_contract_version: number }>(
      `SELECT rights_receipt_contract_version FROM scheduled_acquisition_runs WHERE id = $1`,
      [run.id],
    );
    expect(rows).toEqual([{ rights_receipt_contract_version: 2 }]);

    const three = receipt(run.rights_scope_digest, ['INITIAL', 'PRE_PROVIDER', 'PRE_TRANSPORT']);
    const invalid = receipt(run.rights_scope_digest, [
      'INITIAL',
      'PRE_PROVIDER',
      'PRE_PERSISTENCE',
      'PRE_TRANSPORT',
    ]);
    const validity = await driver.query<{ three_valid: boolean; invalid_valid: boolean }>(
      `SELECT
         scheduled_acquisition_receipt_valid_for_contract(
           $1::jsonb, 'SUCCEEDED', $3, $4::timestamptz, $5::timestamptz, 2::smallint
         ) AS three_valid,
         scheduled_acquisition_receipt_valid_for_contract(
           $2::jsonb, 'SUCCEEDED', $3, $4::timestamptz, $5::timestamptz, 2::smallint
         ) AS invalid_valid`,
      [JSON.stringify(three), JSON.stringify(invalid), run.rights_scope_digest, CLAIMED_AT, COMPLETED_AT],
    );
    expect(validity).toEqual([{ three_valid: false, invalid_valid: false }]);
  });

  it('is safe to execute again as raw migration SQL and then skips in the ledger', async () => {
    const migration = migrations.find(({ version }) => version === '0019');
    if (migration === undefined) throw new Error('migration 0019 was not loaded');
    await expect(driver.exec(migration.sql)).resolves.toBeUndefined();
    const second = await applyMigrations(driver, migrations);
    expect(second.every(({ skipped }) => skipped)).toBe(true);
    const rows = await driver.query<{ rights_receipt_contract_version: number }>(
      `SELECT rights_receipt_contract_version FROM scheduled_acquisition_runs WHERE id = $1`,
      [historicalRunId],
    );
    expect(rows).toEqual([{ rights_receipt_contract_version: 1 }]);
  });
});
