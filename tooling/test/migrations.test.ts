import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_OBJECT_SCHEMAS } from '@data-foundry/canonical-schema';
import {
  EXPECTED_TABLES,
  applyMigrations,
  createPGliteDriver,
  listPublicTables,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

let driver: MigrationDriver;
let migrations: Migration[];

const VERTICAL = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const ARTIFACT = '33333333-3333-4333-8333-333333333333';
const RECORD = '44444444-4444-4444-8444-444444444444';
const ENTITY = '55555555-5555-4555-8555-555555555555';

const TS = '2026-08-14T00:00:00.000Z';

const ROBOTS = JSON.stringify({
  respect_robots: true,
  user_agent: 'data-foundry-bot',
  crawl_delay_seconds: 2,
  disallowed_paths: [],
  allowed_paths: [],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
});
const ATTRIBUTION = JSON.stringify({ required: false, text: null, url: null });

async function seed(): Promise<void> {
  await driver.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'hvac', 'HVAC', '1.0.0', 'ACTIVE', $2::jsonb)`,
    [VERTICAL, JSON.stringify({ cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 })],
  );
  await driver.query(
    `INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
                          rights_classification, attribution_requirement, robots_policy,
                          refresh_cadence, status)
     VALUES ($1, $2, 'AHRI', 'ahridirectory.org', 'CERTIFICATION_BODY', 95,
             'GREEN', $3::jsonb, $4::jsonb, 'WEEKLY', 'ACTIVE')`,
    [SOURCE, VERTICAL, ATTRIBUTION, ROBOTS],
  );
  await driver.query(
    `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                   r2_uri, http_status, extractor_version, acquisition_provider)
     VALUES ($1, $2, 'https://ahridirectory.org/x', $3, $4, 'text/html',
             'r2://raw/hvac/ahri/x.html', 200, 'html-1.0.0', 'http')`,
    [ARTIFACT, SOURCE, TS, 'a'.repeat(64)],
  );
  await driver.query(
    `INSERT INTO source_records (id, source_id, artifact_id, source_record_key, entity_type,
                                 raw_payload, extraction_confidence, extractor_version)
     VALUES ($1, $2, $3, 'AHRI-123', 'equipment', '{}'::jsonb, 0.95, 'html-1.0.0')`,
    [RECORD, SOURCE, ARTIFACT],
  );
  await driver.query(
    `INSERT INTO entities (id, vertical_id, entity_type, canonical_name, canonical_slug,
                           status, quality_score, first_seen_at)
     VALUES ($1, $2, 'equipment', 'Carrier 24ANB7', 'carrier-24anb7', 'ACTIVE', 0.7, $3)`,
    [ENTITY, VERTICAL, TS],
  );
}

const insertFact = (validFrom: string, validTo: string | null, status: string, value: number) =>
  driver.query(
    `INSERT INTO facts (entity_id, property, normalized_value, value_type, valid_from, valid_to,
                        status, confidence, recorded_at)
     VALUES ($1, 'seer2_rating', $2::jsonb, 'number', $3, $4, $5, 0.9, $6)
     RETURNING id`,
    [ENTITY, JSON.stringify(value), validFrom, validTo, status, validFrom],
  );

beforeAll(async () => {
  migrations = await loadMigrations();
  driver = await createPGliteDriver();
  await applyMigrations(driver, migrations);
  await seed();
});

afterAll(async () => {
  await driver?.close();
});

describe('migration runner', () => {
  it('finds correctly-named, uniquely-ordered migrations', () => {
    expect(migrations.length).toBeGreaterThan(0);
    const versions = migrations.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort());
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('creates every expected table', async () => {
    const tables = await listPublicTables(driver);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('records what it applied', async () => {
    const rows = await driver.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((row) => row.version)).toEqual(migrations.map((m) => m.version));
  });

  it('is idempotent — a second run applies nothing', async () => {
    const second = await applyMigrations(driver, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);
  });

  it('refuses to run when an applied migration has been edited', async () => {
    const tampered = migrations.map((migration, index) =>
      index === 0 ? { ...migration, checksum: 'f'.repeat(64) } : migration,
    );
    await expect(applyMigrations(driver, tampered)).rejects.toThrow(/has changed since it was applied/);
  });

  it('keeps the SQL tables and the Zod object registry in step', async () => {
    const tables = new Set(await listPublicTables(driver));
    for (const name of Object.keys(CANONICAL_OBJECT_SCHEMAS)) {
      if (name === 'job_status') continue; // a value object, not a table
      expect(tables.has(name)).toBe(true);
    }
  });
});

describe('storage-level invariants', () => {
  it('rejects an ACTIVE source without a rights decision (rule 1)', async () => {
    await expect(
      driver.query(
        `INSERT INTO sources (vertical_id, publisher, domain, source_type, authority_rank,
                              rights_classification, attribution_requirement, robots_policy,
                              refresh_cadence, status)
         VALUES ($1, 'Sketchy', 'sketchy.example', 'AGGREGATOR', 10,
                 'UNREVIEWED', $2::jsonb, $3::jsonb, 'DAILY', 'ACTIVE')`,
        [VERTICAL, ATTRIBUTION, ROBOTS],
      ),
    ).rejects.toThrow(/sources_active_requires_rights/);
  });

  it('enforces uniqueness on (source_id, source_record_key)', async () => {
    await expect(
      driver.query(
        `INSERT INTO source_records (source_id, artifact_id, source_record_key, entity_type,
                                     raw_payload, extraction_confidence, extractor_version)
         VALUES ($1, $2, 'AHRI-123', 'equipment', '{}'::jsonb, 0.9, 'html-1.0.0')`,
        [SOURCE, ARTIFACT],
      ),
    ).rejects.toThrow(/source_records_source_key_uniq/);
  });

  it('allows exactly one open ACTIVE version per (entity, property)', async () => {
    const first = await insertFact('2026-01-01T00:00:00.000Z', null, 'ACTIVE', 15.2);
    expect(first).toHaveLength(1);

    await expect(insertFact('2026-06-01T00:00:00.000Z', null, 'ACTIVE', 16)).rejects.toThrow(
      /facts_single_open_version_key/,
    );

    // Close the old version, then append the new one — the supported path.
    await driver.query(
      `UPDATE facts SET valid_to = $1, status = 'SUPERSEDED'
        WHERE entity_id = $2 AND property = 'seer2_rating' AND valid_to IS NULL`,
      ['2026-06-01T00:00:00.000Z', ENTITY],
    );
    await expect(insertFact('2026-06-01T00:00:00.000Z', null, 'ACTIVE', 16)).resolves.toHaveLength(1);

    const rows = await driver.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM facts WHERE entity_id = $1',
      [ENTITY],
    );
    // Both versions survive. Nothing was overwritten.
    expect(rows[0]?.count).toBe('2');
  });

  it('refuses to delete an artifact that still backs evidence (rule 10)', async () => {
    const facts = await driver.query<{ id: string }>(
      `SELECT id FROM facts WHERE entity_id = $1 ORDER BY valid_from LIMIT 1`,
      [ENTITY],
    );
    const factRow = facts[0];
    expect(factRow).toBeDefined();

    await driver.query(
      `INSERT INTO fact_evidence (fact_id, artifact_id, source_record_id, source_value,
                                  locator_type, locator_value, observed_at)
       VALUES ($1, $2, $3, '15.2 SEER2', 'CSS_SELECTOR', 'table.specs tr:nth-child(3) td', $4)`,
      [factRow?.id, ARTIFACT, RECORD, TS],
    );

    await expect(
      driver.query('DELETE FROM source_artifacts WHERE id = $1', [ARTIFACT]),
    ).rejects.toThrow();
  });

  it('rejects duplicate evidence for the same locator', async () => {
    const facts = await driver.query<{ id: string }>(
      `SELECT id FROM facts WHERE entity_id = $1 ORDER BY valid_from LIMIT 1`,
      [ENTITY],
    );
    await expect(
      driver.query(
        `INSERT INTO fact_evidence (fact_id, artifact_id, source_record_id, source_value,
                                    locator_type, locator_value, observed_at)
         VALUES ($1, $2, $3, '15.2 SEER2', 'CSS_SELECTOR', 'table.specs tr:nth-child(3) td', $4)`,
        [facts[0]?.id, ARTIFACT, RECORD, TS],
      ),
    ).rejects.toThrow(/fact_evidence_unique_locator/);
  });

  it('refuses to cache imagery without a rights decision (rule 9)', async () => {
    await expect(
      driver.query(
        `INSERT INTO media_assets (vertical_id, source_id, source_url, media_type,
                                   rights_classification, attribution, allowed_display_modes, r2_uri)
         VALUES ($1, $2, 'https://ahridirectory.org/a.jpg', 'PRODUCT_PHOTO',
                 'UNREVIEWED', $3::jsonb, ARRAY['INLINE'], 'r2://images/a.jpg')`,
        [VERTICAL, SOURCE, ATTRIBUTION],
      ),
    ).rejects.toThrow(/media_assets_cache_requires_rights/);
  });

  it('refuses to cache a hotlink-only asset', async () => {
    await expect(
      driver.query(
        `INSERT INTO media_assets (vertical_id, source_id, source_url, media_type,
                                   rights_classification, attribution, allowed_display_modes, r2_uri)
         VALUES ($1, $2, 'https://ahridirectory.org/b.jpg', 'PRODUCT_PHOTO',
                 'GREEN', $3::jsonb, ARRAY['HOTLINK_ONLY'], 'r2://images/b.jpg')`,
        [VERTICAL, SOURCE, ATTRIBUTION],
      ),
    ).rejects.toThrow(/media_assets_cache_requires_rights/);
  });

  it('requires FAILED jobs to carry retry metadata and forbids it elsewhere', async () => {
    await expect(
      driver.query(
        `INSERT INTO ingestion_jobs (vertical_id, source_id, job_type, idempotency_key, state)
         VALUES ($1, $2, 'ARTIFACT_FETCH', 'k-1', 'FAILED')`,
        [VERTICAL, SOURCE],
      ),
    ).rejects.toThrow(/ingestion_jobs_failed_shape/);

    await expect(
      driver.query(
        `INSERT INTO ingestion_jobs (vertical_id, source_id, job_type, idempotency_key, state,
                                     failed_from, retry)
         VALUES ($1, $2, 'ARTIFACT_FETCH', 'k-2', 'FETCHED', 'FETCHED', '{}'::jsonb)`,
        [VERTICAL, SOURCE],
      ),
    ).rejects.toThrow(/ingestion_jobs_failed_shape/);

    await expect(
      driver.query(
        `INSERT INTO ingestion_jobs (vertical_id, source_id, job_type, idempotency_key, state,
                                     failed_from, retry)
         VALUES ($1, $2, 'ARTIFACT_FETCH', 'k-3', 'FAILED', 'FETCHED',
                 '{"attempt":1,"max_attempts":3,"retryable":true}'::jsonb)`,
        [VERTICAL, SOURCE],
      ),
    ).resolves.toBeDefined();
  });

  it('makes ingestion jobs idempotent by (source, type, key)', async () => {
    await expect(
      driver.query(
        `INSERT INTO ingestion_jobs (vertical_id, source_id, job_type, idempotency_key, state,
                                     failed_from, retry)
         VALUES ($1, $2, 'ARTIFACT_FETCH', 'k-3', 'FAILED', 'FETCHED',
                 '{"attempt":1,"max_attempts":3,"retryable":true}'::jsonb)`,
        [VERTICAL, SOURCE],
      ),
    ).rejects.toThrow(/ingestion_jobs_idempotency_key/);
  });

  it('requires a resolution candidate side to be exactly one of entity or record', async () => {
    await expect(
      driver.query(
        `INSERT INTO resolution_candidates (vertical_id, left_entity_id, left_source_record_id,
                                            right_entity_id, method, score, decision)
         VALUES ($1, $2, $3, $2, 'DETERMINISTIC', 0.9, 'PENDING')`,
        [VERTICAL, ENTITY, RECORD],
      ),
    ).rejects.toThrow(/resolution_candidates_left_side_exclusive/);
  });

  it('requires a MERGE judgment to name the surviving entity', async () => {
    await expect(
      driver.query(
        `INSERT INTO resolution_judgments (vertical_id, verdict, left_entity_id, decided_by_kind,
                                           decided_by_actor, decided_at, identity_confidence)
         VALUES ($1, 'MERGE', $2, 'HUMAN', 'reviewer@example.com', $3, 0.99)`,
        [VERTICAL, ENTITY, TS],
      ),
    ).rejects.toThrow(/resolution_judgments_merge_target/);
  });

  it('allows only one current judgment per pair, so supersession cannot be skipped', async () => {
    const insert = (seq: number, evidence: string) =>
      driver.query(
        `INSERT INTO resolution_judgments (vertical_id, verdict, left_source_record_id,
                                           right_entity_id, merged_into_entity_id, decided_by_kind,
                                           decided_by_actor, decided_at, identity_confidence,
                                           evidence_fingerprint, decision_fingerprint, episode_seq)
         VALUES ($1, 'MERGE', $2, $3, $3, 'RULE', 'rule@1', $4, 0.9, $5, 'd', $6)`,
        [VERTICAL, RECORD, ENTITY, TS, evidence, seq],
      );

    await insert(1, 'e1');
    // A second episode that leaves the first one active is exactly the state
    // that let a stale judgment keep speaking for the pair (finding #2b).
    // NULLS NOT DISTINCT is what makes the index bite: one side is always NULL.
    await expect(insert(2, 'e2')).rejects.toThrow(/resolution_judgments_current_episode_key/);

    await driver.query(
      `UPDATE resolution_judgments SET active = FALSE WHERE left_source_record_id = $1`,
      [RECORD],
    );
    await insert(2, 'e2');

    // History is numbered, and a number is never reused.
    await driver.query(
      `UPDATE resolution_judgments SET active = FALSE WHERE left_source_record_id = $1`,
      [RECORD],
    );
    await expect(insert(2, 'e3')).rejects.toThrow(/resolution_judgments_episode_order_key/);
  });
});
