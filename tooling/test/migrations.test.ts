import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_OBJECT_SCHEMAS } from '@data-foundry/canonical-schema';
import {
  EXPECTED_TABLES,
  LEDGER_MARKER,
  LEDGER_TABLE,
  applyMigrations,
  assertLedgerIsOurs,
  ledgerMarker,
  partitionOwnedTables,
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

async function seed(target: MigrationDriver = driver): Promise<void> {
  await target.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'hvac', 'HVAC', '1.0.0', 'ACTIVE', $2::jsonb)`,
    [VERTICAL, JSON.stringify({ cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 })],
  );
  await target.query(
    `INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
                          rights_classification, attribution_requirement, robots_policy,
                          refresh_cadence, status)
     VALUES ($1, $2, 'Federated HVAC Ratings Council', 'ratings-directory.example.org', 'CERTIFICATION_BODY', 95,
             'GREEN', $3::jsonb, $4::jsonb, 'WEEKLY', 'ACTIVE')`,
    [SOURCE, VERTICAL, ATTRIBUTION, ROBOTS],
  );
  await target.query(
    `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                   r2_uri, http_status, extractor_version, acquisition_provider)
     VALUES ($1, $2, 'https://ratings-directory.example.org/x', $3, $4, 'text/html',
             'r2://raw/hvac/ratings-directory/x.html', 200, 'html-1.0.0', 'http')`,
    [ARTIFACT, SOURCE, TS, 'a'.repeat(64)],
  );
  await target.query(
    `INSERT INTO source_records (id, source_id, artifact_id, source_record_key, entity_type,
                                 raw_payload, extraction_confidence, extractor_version)
     VALUES ($1, $2, $3, 'AHRI-123', 'equipment', '{}'::jsonb, 0.95, 'html-1.0.0')`,
    [RECORD, SOURCE, ARTIFACT],
  );
  await target.query(
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
         VALUES ($1, $2, 'https://ratings-directory.example.org/a.jpg', 'PRODUCT_PHOTO',
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
         VALUES ($1, $2, 'https://ratings-directory.example.org/b.jpg', 'PRODUCT_PHOTO',
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

  it('refuses to delete an entity whose verification history would go with it', async () => {
    // `fact_verifications.fact_id` is RESTRICT so a verdict cannot outlive the
    // claim it judged. That is only as strong as the entity FK beside it: a
    // CASCADE there deletes the verdicts first, which un-blocks the CASCADE
    // from `facts.entity_id`, and one entity delete erases the whole trail.
    // A property of its own: sibling tests hold the only open ACTIVE version of
    // `seer2_rating` for this entity.
    const [fact] = await driver.query<{ id: string }>(
      `INSERT INTO facts (entity_id, property, normalized_value, value_type, valid_from,
                          status, confidence, recorded_at)
       VALUES ($1, 'fk_probe_property', '14.5'::jsonb, 'number', $2, 'ACTIVE', 0.9, $2)
       RETURNING id`,
      [ENTITY, '2026-03-01T00:00:00.000Z'],
    );
    await driver.query(
      `INSERT INTO fact_verifications
         (entity_id, property, fact_id, selected_value, verified, reason, blockers, signals,
          evidence_refs, selection_rule, policy_version, evaluated_at, verdict_fingerprint)
       VALUES ($1, 'fk_probe_property', $2, '14.5'::jsonb, TRUE, 'authoritative and dated',
               ARRAY[]::text[], '{}'::jsonb, '[]'::jsonb, 'DIRECT_AUTHORITATIVE_SOURCE',
               'verification-policy-v2', $3, $4)`,
      [ENTITY, fact!.id, TS, 'c'.repeat(64)],
    );

    await expect(driver.query(`DELETE FROM entities WHERE id = $1`, [ENTITY])).rejects.toThrow(
      /fact_verifications/,
    );

    // And the evidence is still there to be read.
    const [after] = await driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_verifications WHERE entity_id = $1`,
      [ENTITY],
    );
    expect(Number(after?.n)).toBe(1);

    await driver.query(`DELETE FROM fact_verifications WHERE entity_id = $1`, [ENTITY]);
    await driver.query(`DELETE FROM facts WHERE id = $1`, [fact!.id]);
  });

  it('allows only one current judgment per record, so supersession cannot be skipped', async () => {
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
    // that let a stale judgment keep speaking for the record. The key is the
    // question the record asks — where do I belong — so the entity it resolved
    // to is deliberately not part of it.
    await expect(insert(2, 'e2')).rejects.toThrow(/resolution_judgments_current_record_key/);

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
    await expect(insert(2, 'e3')).rejects.toThrow(/resolution_judgments_record_episode_key/);
  });
});

/**
 * Migration 0009 has to land on a database that already holds judgment history.
 *
 * Before 0009 there was no unique constraint on the judgment pair — the table's
 * own comment promises the opposite of one ("Rows are never deleted; a reversal
 * is a new row pointing at the old via reverses_judgment_id"). So a pair that
 * was merged, reversed, and merged again legitimately holds two `MERGE` rows.
 *
 * `episode_seq` arrives with `DEFAULT 1`, which hands every one of those rows
 * the same sequence number. Creating `resolution_judgments_episode_order_key`
 * over that state cannot succeed, and a migration that refuses to apply over
 * lawful history is a migration that cannot be deployed at all.
 */
describe('migration 0009 over pre-existing judgment history', () => {
  let legacy: MigrationDriver;

  const PAIR = { record: RECORD, entity: ENTITY };

  beforeAll(async () => {
    legacy = await createPGliteDriver();
    // Everything the judgment table needs, and nothing that knows about episodes.
    const before0009 = migrations.filter((migration) => migration.version < '0009');
    await applyMigrations(legacy, before0009);
    await seed(legacy);

    // Two MERGE judgments on one pair: approved, reversed, approved again. The
    // reversal in between is a NOT_MERGE, so all three share the pair and two
    // share the verdict.
    const insertLegacy = (verdict: string, at: string, active: boolean) =>
      legacy.query(
        `INSERT INTO resolution_judgments (vertical_id, verdict, left_source_record_id,
                                           right_entity_id, merged_into_entity_id, decided_by_kind,
                                           decided_by_actor, decided_at, identity_confidence, active)
         VALUES ($1, $2, $3, $4, $5, 'HUMAN', 'reviewer@example.com', $6, 0.95, $7)`,
        [
          VERTICAL,
          verdict,
          PAIR.record,
          PAIR.entity,
          verdict === 'MERGE' ? PAIR.entity : null,
          at,
          active,
        ],
      );

    await insertLegacy('MERGE', '2026-01-01T00:00:00.000Z', false);
    await insertLegacy('NOT_MERGE', '2026-02-01T00:00:00.000Z', false);
    await insertLegacy('MERGE', '2026-03-01T00:00:00.000Z', true);
  }, 120_000);

  afterAll(async () => {
    await legacy?.close();
  });

  it('applies over a pair that was merged, reversed and merged again', async () => {
    await expect(applyMigrations(legacy, migrations)).resolves.toBeDefined();
  });

  it('numbers that history instead of collapsing it', async () => {
    const rows = await legacy.query<{ verdict: string; episode_seq: number; active: boolean }>(
      `SELECT verdict, episode_seq, active FROM resolution_judgments
        WHERE left_source_record_id = $1 ORDER BY decided_at`,
      [PAIR.record],
    );
    expect(rows.length).toBe(3);

    // All three survive with distinct positions in one history, numbered in
    // the order the decisions were actually made.
    const seqs = rows.map((row) => row.episode_seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    // Every episode number is 1-based and positive, per the CHECK constraint.
    for (const row of rows) expect(row.episode_seq).toBeGreaterThan(0);
  });

  it('leaves exactly one active judgment for the record', async () => {
    // One question, one current answer. The verdict is the answer, so a MERGE
    // and a NOT_MERGE about the same record are the same history, not two.
    const [row] = await legacy.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM resolution_judgments
        WHERE left_source_record_id = $1 AND active`,
      [PAIR.record],
    );
    expect(Number(row?.n)).toBe(1);
  });

  it('re-applies as a no-op without renumbering the history it already fixed', async () => {
    const before = await legacy.query<{ id: string; episode_seq: number }>(
      `SELECT id::text AS id, episode_seq FROM resolution_judgments ORDER BY id`,
    );
    const second = await applyMigrations(legacy, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);

    const after = await legacy.query<{ id: string; episode_seq: number }>(
      `SELECT id::text AS id, episode_seq FROM resolution_judgments ORDER BY id`,
    );
    expect(after).toEqual(before);
  });
});

/**
 * A Data Foundry migration run must not speak for a database it does not own.
 *
 * `POSTGRES_URL` points the migrator at whatever database the operator names,
 * and nothing stops that database from belonging to something else. No Data
 * Foundry migration references a foreign table — there is no statement that
 * could — but `--check` reported `tables.length` over the whole `public`
 * schema, so a shared database inflated the count with objects this project
 * neither created nor understands. A number that counts other people's tables
 * is not a certification of ours.
 *
 * The fix is an ownership boundary, not a bigger number: `EXPECTED_TABLES` is
 * the manifest, everything else is out of scope and is named as such. These
 * tests use a disposable in-memory database that deliberately contains an
 * unrelated table with rows in it, and assert that Data Foundry leaves it
 * exactly as it found it — structure, row count and all — without ever reading
 * what is inside it.
 */
describe('migrations respect an ownership boundary', () => {
  let shared: MigrationDriver;

  /** Structure only. Row CONTENTS of an unowned table are never read. */
  const foreignShape = async () =>
    shared.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'unrelated_tenant_events'
        ORDER BY column_name`,
    );
  const foreignRowCount = async () => {
    const [row] = await shared.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM unrelated_tenant_events`,
    );
    return Number(row?.n);
  };

  beforeAll(async () => {
    shared = await createPGliteDriver();
    // A table this project did not create, with live-like rows already in it,
    // sitting in the same schema the migrator writes to.
    await shared.exec(`
      CREATE TABLE unrelated_tenant_events (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          status      TEXT NOT NULL,
          payload     JSONB
      );
      INSERT INTO unrelated_tenant_events (status, payload)
      VALUES ('running', '{"a":1}'::jsonb), ('success', '{"b":2}'::jsonb);
    `);
    await applyMigrations(shared, migrations);
  }, 120_000);

  afterAll(async () => {
    await shared?.close();
  });

  it('classifies a table it does not own as out of scope', async () => {
    const partition = partitionOwnedTables(await listPublicTables(shared));
    expect(partition.unowned).toContain('unrelated_tenant_events');
    expect(partition.owned).toEqual([...EXPECTED_TABLES, 'schema_migrations'].sort());
    // The count that gets certified is ours, not the whole schema's.
    expect(partition.owned).not.toContain('unrelated_tenant_events');
  });


  it('claims the migration ledger as its own, because it writes to it', async () => {
    // `applyMigrations` creates `schema_migrations` and inserts a row per
    // migration. Reporting it as "not ours, untouched" was false twice over.
    const partition = partitionOwnedTables(await listPublicTables(shared));
    expect(partition.owned).toContain('schema_migrations');
    expect(partition.unowned).not.toContain('schema_migrations');
  });

  it('does not report the ledger as a missing migration-created table', async () => {
    // It is owned, but no migration file creates it — the runner does. Asking a
    // schema that HAS the ledger proves nothing; the question only bites on a
    // schema without one, which is what every fresh database is before the
    // first run. If the ledger were listed as migration-created, this reports a
    // hole that no migration could ever fill.
    const withoutLedger = (await listPublicTables(shared)).filter(
      (table) => table !== LEDGER_TABLE,
    );
    expect(withoutLedger).not.toContain(LEDGER_TABLE);
    expect(partitionOwnedTables(withoutLedger).missing).toEqual([]);
  });

  it('still fails closed when one of its OWN tables is missing', () => {
    const partition = partitionOwnedTables(
      [...EXPECTED_TABLES].filter((table) => table !== 'facts'),
    );
    expect(partition.missing).toEqual(['facts']);
  });

  it('reports nothing missing when every owned table is present', async () => {
    expect(partitionOwnedTables(await listPublicTables(shared)).missing).toEqual([]);
  });

  it('leaves the unowned table structurally untouched', async () => {
    expect(await foreignShape()).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone' },
      { column_name: 'id', data_type: 'uuid' },
      { column_name: 'payload', data_type: 'jsonb' },
      { column_name: 'status', data_type: 'text' },
    ]);
  });

  it('leaves its rows in place, without reading them', async () => {
    expect(await foreignRowCount()).toBe(2);
  });

  it('re-applying every migration still does not touch it', async () => {
    const shapeBefore = await foreignShape();
    const countBefore = await foreignRowCount();

    const second = await applyMigrations(shared, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);

    expect(await foreignShape()).toEqual(shapeBefore);
    expect(await foreignRowCount()).toBe(countBefore);
  });

  it('contains no migration statement naming an object this project does not own', async () => {
    // The structural half of the guarantee: the boundary above reports, but the
    // migrations themselves must simply never mention a foreign table.
    for (const migration of migrations) {
      expect(migration.sql).not.toMatch(/unrelated_tenant_events/i);
      expect(migration.sql).not.toMatch(/automation_runs/i);
    }
  });
});

/**
 * A ledger by the same name that belongs to somebody else.
 *
 * The ownership boundary above says Data Foundry writes only to tables it
 * created — and then `applyMigrations` opens with
 * `CREATE TABLE IF NOT EXISTS schema_migrations`, which in a database that
 * already has a table by that name silently resolves to "fine, use theirs".
 * The name is not distinctive: it is what Rails, sqlx and a dozen hand-rolled
 * runners call their own ledger. `IF NOT EXISTS` then turns a collision into an
 * adoption, and the very next statement writes a row into another project's
 * bookkeeping.
 *
 * `partitionOwnedTables` compounded it by claiming the table as owned on the
 * strength of its name, so the collision would also be counted into the
 * "N Data Foundry tables" certification.
 */
describe('a foreign table named like the ledger is refused, not adopted', () => {
  let foreign: MigrationDriver;

  const shape = () =>
    foreign.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
        ORDER BY column_name`,
    );
  const rowCount = async () => {
    const [row] = await foreign.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM schema_migrations`,
    );
    return Number(row?.n);
  };

  beforeAll(async () => {
    foreign = await createPGliteDriver();
    // Rails' shape: one column, called `version`, and nothing else.
    await foreign.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES ('20240102030405'), ('20240607080910');
    `);
  }, 120_000);

  afterAll(async () => {
    await foreign?.close();
  });

  it('refuses to run against it, naming the collision', async () => {
    await expect(applyMigrations(foreign, migrations)).rejects.toThrow(
      /schema_migrations.*not Data Foundry's ledger/is,
    );
  });

  it('leaves the foreign ledger exactly as it found it', async () => {
    await applyMigrations(foreign, migrations).catch(() => undefined);
    expect(await shape()).toEqual([{ column_name: 'version' }]);
    expect(await rowCount()).toBe(2);
  });

  it('creates none of its own tables before refusing', async () => {
    await applyMigrations(foreign, migrations).catch(() => undefined);
    // Asserted against the schema itself rather than against `owned`: what
    // matters here is that nothing of ours was created, not how the partition
    // happens to classify a table the runner has already refused.
    expect(await listPublicTables(foreign)).toEqual([LEDGER_TABLE]);
    expect(partitionOwnedTables(await listPublicTables(foreign)).missing).toEqual([
      ...EXPECTED_TABLES,
    ]);
  });

  it('accepts a ledger it created itself', async () => {
    const ours = await createPGliteDriver();
    try {
      await expect(applyMigrations(ours, migrations)).resolves.toBeDefined();
      // Second run: the ledger now exists, and must still be recognised as ours.
      await expect(assertLedgerIsOurs(ours)).resolves.toBeUndefined();
    } finally {
      await ours.close();
    }
  }, 120_000);
});

/**
 * Shape is compatibility evidence. It is not proof of ownership.
 *
 * Refusing a differently-shaped `schema_migrations` closes the collision that
 * happens in practice, and nothing more: another project whose ledger happens
 * to carry these five column names is still indistinguishable from ours, and
 * the runner would read its rows and write its own. "Probably nobody else picks
 * `execution_ms`" is a guess about strangers, which is not a boundary.
 *
 * So the ledger records who made it. The marker is written when the runner
 * creates the table and never onto a table it found, because stamping a table
 * to establish that we may write to it is the same circularity in one step.
 * A ledger with no marker is one we cannot prove is ours, and the run stops and
 * says so rather than guessing on the operator's behalf.
 */
describe('the ledger proves its ownership rather than inferring it', () => {
  /** Exactly the shape `LEDGER_DDL` creates, so only the marker can decide. */
  const SAME_SHAPE = `
    CREATE TABLE schema_migrations (
        version      TEXT PRIMARY KEY,
        filename     TEXT        NOT NULL,
        checksum     TEXT        NOT NULL,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        execution_ms INTEGER     NOT NULL
    );
    INSERT INTO schema_migrations (version, filename, checksum, execution_ms)
    VALUES ('0001', 'their_first.sql', 'deadbeef', 7);
  `;

  it('marks the ledger it creates', async () => {
    const ours = await createPGliteDriver();
    try {
      await applyMigrations(ours, migrations);
      expect(await ledgerMarker(ours)).toBe(LEDGER_MARKER);
    } finally {
      await ours.close();
    }
  }, 120_000);

  it('refuses a ledger of the right shape that it cannot prove it created', async () => {
    const stranger = await createPGliteDriver();
    try {
      await stranger.exec(SAME_SHAPE);
      await expect(applyMigrations(stranger, migrations)).rejects.toThrow(
        /not Data Foundry's ledger.*no ownership marker/is,
      );
      // Untouched: no marker written onto it, no row of ours added, and none of
      // our tables created beside it.
      expect(await ledgerMarker(stranger)).toBeNull();
      const [row] = await stranger.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM schema_migrations`,
      );
      expect(Number(row?.n)).toBe(1);
      expect(await listPublicTables(stranger)).toEqual([LEDGER_TABLE]);
    } finally {
      await stranger.close();
    }
  }, 120_000);

  it('names the statement that adopts such a ledger deliberately', async () => {
    // The refusal has to be actionable: a human who knows the table is theirs
    // needs the exact statement, and a human who does not must not be nudged
    // into running it. Both come from the same message.
    const stranger = await createPGliteDriver();
    try {
      await stranger.exec(SAME_SHAPE);
      await expect(applyMigrations(stranger, migrations)).rejects.toThrow(
        new RegExp(`COMMENT ON TABLE ${LEDGER_TABLE} IS '${LEDGER_MARKER}'`, 'i'),
      );
    } finally {
      await stranger.close();
    }
  }, 120_000);

  it('accepts a ledger carrying its own marker', async () => {
    const adopted = await createPGliteDriver();
    try {
      await adopted.exec(SAME_SHAPE);
      await adopted.exec(`COMMENT ON TABLE schema_migrations IS '${LEDGER_MARKER}';`);
      await expect(assertLedgerIsOurs(adopted)).resolves.toBeUndefined();
    } finally {
      await adopted.close();
    }
  }, 120_000);

  it("refuses a ledger carrying somebody else's marker", async () => {
    const marked = await createPGliteDriver();
    try {
      await marked.exec(SAME_SHAPE);
      await marked.exec(`COMMENT ON TABLE schema_migrations IS 'acme-platform ledger v3';`);
      await expect(applyMigrations(marked, migrations)).rejects.toThrow(
        /not Data Foundry's ledger.*acme-platform ledger v3/is,
      );
    } finally {
      await marked.close();
    }
  }, 120_000);
});
