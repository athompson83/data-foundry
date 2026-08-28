import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  createPGliteDriver,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

const VERTICAL = '71000000-0000-4000-8000-000000000001';
const SOURCE = '71000000-0000-4000-8000-000000000002';
const PUBLISHER = '71000000-0000-4000-8000-000000000003';
const TERMS_EVIDENCE = '71000000-0000-4000-8000-000000000004';
const DECISION_EVIDENCE = '71000000-0000-4000-8000-000000000005';
const TERMS_CELL = '71000000-0000-4000-8000-000000000006';
const TERMS_VERSION = '71000000-0000-4000-8000-000000000007';
const EXCEPTION_EVIDENCE = '71000000-0000-4000-8000-000000000008';

const TS = '2026-08-01T00:00:00.000Z';
const RECHECK = '2027-08-01T00:00:00.000Z';
const TERMS_HASH = 'a'.repeat(64);
const DECISION_HASH = 'b'.repeat(64);
const EXCEPTION_HASH = 'c'.repeat(64);
const ROBOTS = JSON.stringify({
  respect_robots: true,
  user_agent: 'data-foundry-bot',
  crawl_delay_seconds: 0,
  disallowed_paths: [],
  allowed_paths: [],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
});
const ATTRIBUTION = JSON.stringify({ required: false, text: null, url: null });

let driver: MigrationDriver;
let migrations: Migration[];

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => null,
    (caught: unknown) => caught,
  );
}

async function rollbackProbe(statement: string, parameters: readonly unknown[] = []): Promise<unknown> {
  await driver.exec('BEGIN');
  try {
    return await captureError(driver.query(statement, parameters));
  } finally {
    await driver.exec('ROLLBACK');
  }
}

async function rollbackProbeOn(
  target: MigrationDriver,
  statement: string,
  parameters: readonly unknown[] = [],
): Promise<unknown> {
  await target.exec('BEGIN');
  try {
    return await captureError(target.query(statement, parameters));
  } finally {
    await target.exec('ROLLBACK');
  }
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

async function seedSource(target: MigrationDriver): Promise<void> {
  await target.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'rights-test', 'Rights test', '1.0.0', 'ACTIVE', $2::jsonb)`,
    [VERTICAL, JSON.stringify({ cadence: 'MANUAL', max_staleness_hours: 24, priority: 1 })],
  );
  await target.query(
    `INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
                          rights_classification, attribution_requirement, robots_policy,
                          refresh_cadence, status)
     VALUES ($1, $2, 'Synthetic Rights Publisher', 'rights-fixture.example', 'OPEN_DATASET', 50,
             'GREEN', $3::jsonb, $4::jsonb, 'MANUAL', 'ACTIVE')`,
    [SOURCE, VERTICAL, ATTRIBUTION, ROBOTS],
  );
}

async function seedRightsFoundation(target: MigrationDriver): Promise<void> {
  await target.query(
    `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
     VALUES ($1, 'synthetic-rights-publisher', 'Synthetic Rights Publisher', 'ACTIVE')`,
    [PUBLISHER],
  );
  await target.query(
    `INSERT INTO rights_evidence_artifacts
       (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, 'TERMS', 'repo://fixtures/terms-v1', 'repo://fixtures/terms-v1.txt', $4,
             'text/plain', $7, 'test-suite'),
            ($2, 'REVIEW_MEMO', 'repo://fixtures/review-v1', 'repo://fixtures/review-v1.txt', $5,
             'text/plain', $7, 'test-suite'),
            ($3, 'AGREEMENT', 'repo://fixtures/exception-v1', 'repo://fixtures/exception-v1.txt', $6,
             'text/plain', $7, 'test-suite')`,
    [
      TERMS_EVIDENCE,
      DECISION_EVIDENCE,
      EXCEPTION_EVIDENCE,
      TERMS_HASH,
      DECISION_HASH,
      EXCEPTION_HASH,
      TS,
    ],
  );
  await target.query(
    `UPDATE sources
        SET rights_publisher_id = $1,
            rights_publisher_mapping_evidence_artifact_id = $3,
            rights_publisher_mapping_reviewer_type = 'HUMAN',
            rights_publisher_mapping_reviewed_by = 'test-owner',
            rights_publisher_mapping_reviewed_at = $4
      WHERE id = $2`,
    [PUBLISHER, SOURCE, DECISION_EVIDENCE, TS],
  );
  await target.query(
    `INSERT INTO rights_terms_cells
       (id, source_id, acquisition_route, account_or_product_plan, jurisdiction, created_by)
     VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'test-suite')`,
    [TERMS_CELL, SOURCE],
  );
  await target.query(
    `INSERT INTO rights_terms_versions
       (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
        effective_from, effective_until, recheck_at, created_by)
     VALUES ($1, $2, $3, $4, 'v1', $5, NULL, $6, 'test-suite')`,
    [TERMS_VERSION, TERMS_CELL, TERMS_EVIDENCE, TERMS_HASH, TS, RECHECK],
  );
  await target.query(
    `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'initial fixture terms', $2)`,
    [TERMS_VERSION, TS],
  );
}

async function insertArtifact(
  target: MigrationDriver,
  id: string,
  url: string,
  hash: string,
): Promise<void> {
  await target.query(
    `INSERT INTO source_artifacts
       (id, source_id, url, retrieved_at, content_hash, mime_type, r2_uri, http_status,
        extractor_version, policy_snapshot_id, byte_size, acquisition_provider,
        acquisition_route, account_or_product_plan, acquisition_jurisdiction)
     VALUES ($1, $2, $3, $4, $5, 'application/json', $6, 200,
             'rights-test-v1', NULL, 2, 'fixture', 'DIRECT_HTTP', 'public', 'US')`,
    [id, SOURCE, url, TS, hash, `r2://rights-tests/${id}.json`],
  );
}

beforeAll(async () => {
  migrations = await loadMigrations();
  driver = await createPGliteDriver();
  await applyMigrations(driver, migrations);
  await seedSource(driver);
  await seedRightsFoundation(driver);
});

afterAll(async () => {
  await driver?.close();
});

describe('0014 populated upgrade is fail closed', () => {
  it('does not infer a publisher mapping or manufacture a decision from GREEN/legacy booleans', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(
        upgrade,
        migrations.filter((migration) => migration.version < '0014'),
      );
      await seedSource(upgrade);
      await applyMigrations(upgrade, migrations);

      const [source] = await upgrade.query<{ rights_publisher_id: string | null }>(
        `SELECT rights_publisher_id FROM sources WHERE id = $1`,
        [SOURCE],
      );
      const [counts] = await upgrade.query<{
        cells: string;
        decisions: string;
        activations: string;
        assessments: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM rights_cells) AS cells,
           (SELECT count(*)::text FROM rights_decisions) AS decisions,
           (SELECT count(*)::text FROM rights_decision_activation_events) AS activations,
           (SELECT count(*)::text FROM rights_migration_assessments
             WHERE source_id = $1 AND assessment_state = 'REVIEW_REQUIRED') AS assessments`,
        [SOURCE],
      );
      expect(source?.rights_publisher_id).toBeNull();
      expect(counts).toEqual({ cells: '0', decisions: '0', activations: '0', assessments: '1' });
      expect((await applyMigrations(upgrade, migrations)).every((entry) => entry.skipped)).toBe(true);
    } finally {
      await upgrade.close();
    }
  }, 120_000);
});

describe('0016 referenced field-group upgrade audit', () => {
  it('refuses to bless a member inserted after the group was first referenced', async () => {
    const upgrade = await createPGliteDriver();
    const group = '71000000-0000-4000-8000-000000000101';
    const cell = '71000000-0000-4000-8000-000000000102';
    const decision = '71000000-0000-4000-8000-000000000103';
    try {
      await applyMigrations(upgrade, migrations.filter((migration) => migration.version < '0016'));
      await seedSource(upgrade);
      await seedRightsFoundation(upgrade);
      await upgrade.exec('BEGIN');
      await upgrade.query(
        `INSERT INTO rights_field_groups (id, source_id, group_key, name, created_by, created_at)
         VALUES ($1, $2, 'upgrade_group', 'Upgrade group', 'test-suite', '2026-07-01T00:00:00Z')`,
        [group, SOURCE],
      );
      await upgrade.query(
        `INSERT INTO rights_field_group_members
           (field_group_id, source_id, field_key, created_by, created_at)
         VALUES ($1, $2, 'seer2', 'test-suite', '2026-07-02T00:00:00Z')`,
        [group, SOURCE],
      );
      await upgrade.query(
        `INSERT INTO rights_cells
           (id, source_id, field_group_id, operation, channel, created_by, created_at)
         VALUES ($1, $2, $3, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite',
                 '2026-07-03T00:00:00Z')`,
        [cell, SOURCE, group],
      );
      await upgrade.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, review_status, reviewer_type, reviewed_at, rationale, created_by)
         VALUES ($1, $2, 'UNKNOWN', 'ASSESSMENT', 'AUTOMATED', $3,
                 'fixture assessment', 'test-suite')`,
        [decision, cell, TS],
      );
      await upgrade.query(
        `SELECT activate_rights_decision($1, 'AUTOMATED', 'test-suite', 'fixture', $2)`,
        [decision, TS],
      );
      await upgrade.exec('COMMIT');
      await upgrade.query(
        `INSERT INTO rights_field_group_members
           (field_group_id, source_id, field_key, created_by, created_at)
         VALUES ($1, $2, 'eer2', 'test-suite', '2026-07-04T00:00:00Z')`,
        [group, SOURCE],
      );

      const error = await captureError(applyMigrations(upgrade, migrations));
      expect(errorCode((error as { cause?: unknown } | null)?.cause)).toBe('23514');
      expect(String((error as Error | null)?.message)).toContain('post-reference member');
      const applied = await upgrade.query<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = '0016'`,
      );
      expect(applied).toEqual([]);
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('preserves a populated group whose complete membership predates its first reference', async () => {
    const upgrade = await createPGliteDriver();
    const group = '71000000-0000-4000-8000-000000000111';
    const cell = '71000000-0000-4000-8000-000000000112';
    const decision = '71000000-0000-4000-8000-000000000113';
    try {
      await applyMigrations(upgrade, migrations.filter((migration) => migration.version < '0016'));
      await seedSource(upgrade);
      await upgrade.exec('BEGIN');
      await upgrade.query(
        `INSERT INTO rights_field_groups (id, source_id, group_key, name, created_by, created_at)
         VALUES ($1, $2, 'safe_upgrade_group', 'Safe upgrade group', 'test-suite',
                 '2026-07-01T00:00:00Z')`,
        [group, SOURCE],
      );
      await upgrade.query(
        `INSERT INTO rights_field_group_members
           (field_group_id, source_id, field_key, created_by, created_at)
         VALUES ($1, $2, 'seer2', 'test-suite', '2026-07-02T00:00:00Z'),
                ($1, $2, 'eer2', 'test-suite', '2026-07-02T00:00:00Z')`,
        [group, SOURCE],
      );
      await upgrade.query(
        `INSERT INTO rights_cells
           (id, source_id, field_group_id, operation, channel, created_by, created_at)
         VALUES ($1, $2, $3, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite',
                 '2026-07-03T00:00:00Z')`,
        [cell, SOURCE, group],
      );
      await upgrade.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, review_status, reviewer_type, reviewed_at, rationale, created_by)
         VALUES ($1, $2, 'UNKNOWN', 'ASSESSMENT', 'AUTOMATED', $3,
                 'fixture assessment', 'test-suite')`,
        [decision, cell, TS],
      );
      await upgrade.query(
        `SELECT activate_rights_decision($1, 'AUTOMATED', 'test-suite', 'fixture', $2)`,
        [decision, TS],
      );
      await upgrade.exec('COMMIT');

      await expect(applyMigrations(upgrade, migrations)).resolves.toBeDefined();
      const members = await upgrade.query<{ field_key: string }>(
        `SELECT field_key FROM rights_field_group_members
          WHERE field_group_id = $1 ORDER BY field_key`,
        [group],
      );
      expect(members).toEqual([{ field_key: 'eer2' }, { field_key: 'seer2' }]);
      const expansionError = await rollbackProbeOn(
        upgrade,
        `INSERT INTO rights_field_group_members
           (field_group_id, source_id, field_key, created_by)
         VALUES ($1, $2, 'hspf2', 'test-suite')`,
        [group, SOURCE],
      );
      expect(errorCode(expansionError)).toBe('55000');
    } finally {
      await upgrade.close();
    }
  }, 120_000);
});

describe('0016 source kill-switch migration', () => {
  it('leaves upgraded source state unknown until an explicit synchronization writes a boolean', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(
        upgrade,
        migrations.filter((migration) => migration.version < '0016'),
      );
      await seedSource(upgrade);
      await applyMigrations(upgrade, migrations);

      const before = await upgrade.query<{ kill_switch_engaged: boolean | null }>(
        `SELECT kill_switch_engaged FROM sources WHERE id = $1`,
        [SOURCE],
      );
      expect(before).toEqual([{ kill_switch_engaged: null }]);

      await upgrade.query(`UPDATE sources SET kill_switch_engaged = TRUE WHERE id = $1`, [SOURCE]);
      const after = await upgrade.query<{ kill_switch_engaged: boolean | null }>(
        `SELECT kill_switch_engaged FROM sources WHERE id = $1`,
        [SOURCE],
      );
      expect(after).toEqual([{ kill_switch_engaged: true }]);
      expect((await applyMigrations(upgrade, migrations)).every((entry) => entry.skipped)).toBe(true);
    } finally {
      await upgrade.close();
    }
  }, 120_000);
});

describe('0016 fact output-kind migration', () => {
  it('preserves an upgraded fact as explicitly unclassified instead of guessing its kind', async () => {
    const upgrade = await createPGliteDriver();
    const entity = '71500000-0000-4000-8000-000000000001';
    const fact = '71500000-0000-4000-8000-000000000002';
    try {
      await applyMigrations(
        upgrade,
        migrations.filter((migration) => migration.version < '0016'),
      );
      await seedSource(upgrade);
      await upgrade.query(
        `INSERT INTO entities
           (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
            quality_score, first_seen_at)
         VALUES ($1, $2, 'equipment_model', 'Legacy kind fixture', 'legacy-kind-fixture',
                 'CANDIDATE', 0, $3)`,
        [entity, VERTICAL, TS],
      );
      await upgrade.query(
        `INSERT INTO facts
           (id, entity_id, property, normalized_value, value_type, valid_from, status,
            confidence, recorded_at)
         VALUES ($1, $2, 'legacy_value', '1'::jsonb, 'integer', $3, 'PROPOSED', 1, $3)`,
        [fact, entity, TS],
      );

      await applyMigrations(upgrade, migrations);
      const rows = await upgrade.query<{ output_kind: string | null }>(
        `SELECT output_kind FROM facts WHERE id = $1`,
        [fact],
      );
      expect(rows).toEqual([{ output_kind: null }]);
      expect((await applyMigrations(upgrade, migrations)).every((entry) => entry.skipped)).toBe(true);
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it.each([
    { label: 'unclassified', outputKind: null },
    { label: 'derived without dependencies', outputKind: 'DERIVED_METRIC' },
  ])('rejects committing a new $label fact', async ({ outputKind }) => {
    const probe = await createPGliteDriver();
    const entity = crypto.randomUUID();
    const fact = crypto.randomUUID();
    try {
      await applyMigrations(probe, migrations);
      await seedSource(probe);
      await probe.exec('BEGIN');
      await probe.query(
        `INSERT INTO entities
           (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
            quality_score, first_seen_at)
         VALUES ($1, $2, 'equipment_model', 'Atomic kind fixture', $3,
                 'CANDIDATE', 0, $4)`,
        [entity, VERTICAL, `atomic-kind-${fact}`, TS],
      );
      await probe.query(
        `INSERT INTO facts
           (id, entity_id, property, normalized_value, value_type, valid_from, status,
            confidence, recorded_at, output_kind)
         VALUES ($1, $2, 'atomic_value', '1'::jsonb, 'integer', $3, 'PROPOSED', 1, $3, $4)`,
        [fact, entity, TS, outputKind],
      );
      const commitError = await captureError(probe.exec('COMMIT'));
      expect(errorCode(commitError)).toBe('23514');
    } finally {
      await probe.exec('ROLLBACK').catch(() => undefined);
      await probe.close();
    }
  }, 120_000);

  it('classifies a derived fact only with dependencies and rejects later set expansion', async () => {
    const probe = await createPGliteDriver();
    const entity = '71500000-0000-4000-8000-000000000011';
    const inputA = '71500000-0000-4000-8000-000000000012';
    const inputB = '71500000-0000-4000-8000-000000000013';
    const derived = '71500000-0000-4000-8000-000000000014';
    try {
      await applyMigrations(probe, migrations);
      await seedSource(probe);
      await probe.exec('BEGIN');
      await probe.query(
        `INSERT INTO entities
           (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
            quality_score, first_seen_at)
         VALUES ($1, $2, 'equipment_model', 'Sealed dependency fixture',
                 'sealed-dependency-fixture', 'CANDIDATE', 0, $3)`,
        [entity, VERTICAL, TS],
      );
      await probe.query(
        `INSERT INTO facts
           (id, entity_id, property, normalized_value, value_type, valid_from, status,
            confidence, recorded_at, output_kind)
         VALUES ($1, $4, 'input_a', '1'::jsonb, 'integer', $5, 'PROPOSED', 1, $5,
                 'NORMALIZED_FACT'),
                ($2, $4, 'input_b', '2'::jsonb, 'integer', $5, 'PROPOSED', 1, $5,
                 'NORMALIZED_FACT'),
                ($3, $4, 'derived_value', '3'::jsonb, 'integer', $5, 'PROPOSED', 1, $5,
                 NULL)`,
        [inputA, inputB, derived, entity, TS],
      );
      await probe.query(
        `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
         VALUES ($1, $2, 'fixture:derive-a')`,
        [derived, inputA],
      );
      await probe.query(
        `UPDATE facts SET output_kind = 'DERIVED_METRIC' WHERE id = $1`,
        [derived],
      );
      await probe.exec('COMMIT');

      const expansionError = await rollbackProbeOn(
        probe,
        `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
         VALUES ($1, $2, 'fixture:late-expansion')`,
        [derived, inputB],
      );
      expect(errorCode(expansionError)).toBe('55000');
      const dependencies = await probe.query<{ input_fact_id: string }>(
        `SELECT input_fact_id FROM fact_dependencies WHERE derived_fact_id = $1`,
        [derived],
      );
      expect(dependencies).toEqual([{ input_fact_id: inputA }]);
      const mutationError = await rollbackProbeOn(
        probe,
        `UPDATE fact_dependencies SET transformation_ref = 'fixture:tampered'
          WHERE derived_fact_id = $1 AND input_fact_id = $2`,
        [derived, inputA],
      );
      expect(errorCode(mutationError)).toBe('55000');
      const deletionError = await rollbackProbeOn(
        probe,
        `DELETE FROM fact_dependencies WHERE derived_fact_id = $1 AND input_fact_id = $2`,
        [derived, inputA],
      );
      expect(errorCode(deletionError)).toBe('55000');
    } finally {
      await probe.close();
    }
  }, 120_000);
});

describe.sequential('0014 sparse scopes and immutable history', () => {
  it('treats NULL scope coordinates as equal for rights-cell uniqueness', async () => {
    const first = '72000000-0000-4000-8000-000000000001';
    const second = '72000000-0000-4000-8000-000000000002';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
         VALUES ($1, $2, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [first, SOURCE],
      );
      const error = await driver
        .query(
          `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
           VALUES ($1, $2, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
          [second, SOURCE],
        )
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect((error as { code?: unknown } | null)?.code).toBe('23505');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('rejects UPDATE, DELETE, and TRUNCATE across append-only rights/provenance history', async () => {
    const protectedTables = [
      'rights_evidence_artifacts',
      'acquisition_policy_snapshots',
      'rights_terms_cells',
      'rights_terms_versions',
      'rights_terms_activation_events',
      'rights_field_groups',
      'rights_field_group_members',
      'rights_cells',
      'rights_decisions',
      'rights_decision_conditions',
      'rights_decision_activation_events',
      'rights_deny_exceptions',
      'rights_migration_assessments',
      'entity_evidence',
      'fact_dependencies',
    ];
    for (const table of protectedTables) {
      const updateError = await captureError(
        driver.exec(`UPDATE ${table} SET created_at = created_at WHERE false`),
      );
      expect(errorCode(updateError), `${table} UPDATE`).toBe('55000');
      const deleteError = await captureError(driver.exec(`DELETE FROM ${table} WHERE false`));
      expect(errorCode(deleteError), `${table} DELETE`).toBe('55000');
      const truncateError = await rollbackProbe(`TRUNCATE TABLE ${table} CASCADE`);
      expect(errorCode(truncateError), `${table} TRUNCATE`).toBe('55000');
    }

    const actualUpdate = await rollbackProbe(
      `UPDATE rights_evidence_artifacts SET created_by = 'tampered' WHERE id = $1`,
      [TERMS_EVIDENCE],
    );
    expect(errorCode(actualUpdate)).toBe('55000');
    const actualDelete = await rollbackProbe(`DELETE FROM rights_evidence_artifacts WHERE id = $1`, [
      TERMS_EVIDENCE,
    ]);
    expect(errorCode(actualDelete)).toBe('55000');
  });

  it('rejects insert-expanding a field group after a rights cell references it', async () => {
    const group = '72000000-0000-4000-8000-000000000011';
    const cell = '72000000-0000-4000-8000-000000000012';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_field_groups (id, source_id, group_key, name, created_by)
         VALUES ($1, $2, 'published_performance', 'Published performance', 'test-suite')`,
        [group, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_field_group_members
           (field_group_id, source_id, field_key, created_by)
         VALUES ($1, $2, 'seer2', 'test-suite')`,
        [group, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_cells
           (id, source_id, field_group_id, operation, channel, created_by)
         VALUES ($1, $2, $3, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [cell, SOURCE, group],
      );

      await driver.exec('SAVEPOINT field_group_expansion_probe');
      const expansionError = await captureError(
        driver.query(
          `INSERT INTO rights_field_group_members
             (field_group_id, source_id, field_key, created_by)
           VALUES ($1, $2, 'eer2', 'test-suite')`,
          [group, SOURCE],
        ),
      );
      expect(errorCode(expansionError)).toBe('55000');
      await driver.exec('ROLLBACK TO SAVEPOINT field_group_expansion_probe');

      const members = await driver.query<{ field_key: string }>(
        `SELECT field_key FROM rights_field_group_members
          WHERE field_group_id = $1 ORDER BY field_key`,
        [group],
      );
      expect(members.map((row) => row.field_key)).toEqual(['seer2']);

      await driver.exec('SAVEPOINT field_group_update_probe');
      const updateError = await captureError(
        driver.query(
          `UPDATE rights_field_group_members SET field_key = 'eer2'
            WHERE field_group_id = $1 AND field_key = 'seer2'`,
          [group],
        ),
      );
      expect(errorCode(updateError)).toBe('55000');
      await driver.exec('ROLLBACK TO SAVEPOINT field_group_update_probe');

      await driver.exec('SAVEPOINT field_group_delete_probe');
      const deleteError = await captureError(
        driver.query(
          `DELETE FROM rights_field_group_members
            WHERE field_group_id = $1 AND field_key = 'seer2'`,
          [group],
        ),
      );
      expect(errorCode(deleteError)).toBe('55000');
      await driver.exec('ROLLBACK TO SAVEPOINT field_group_delete_probe');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });
});

describe.sequential('0014 deferred current-decision invariant', () => {
  it('rejects absent and future-only activations, while an explicit current UNKNOWN commits', async () => {
    const probe = await createPGliteDriver();
    const absentCell = '72500000-0000-4000-8000-000000000001';
    const futureCell = '72500000-0000-4000-8000-000000000002';
    const futureDecision = '72500000-0000-4000-8000-000000000003';
    const unknownCell = '72500000-0000-4000-8000-000000000004';
    const unknownDecision = '72500000-0000-4000-8000-000000000005';
    try {
      await applyMigrations(probe, migrations);
      await seedSource(probe);

      await probe.exec('BEGIN');
      await probe.query(
        `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
         VALUES ($1, $2, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [absentCell, SOURCE],
      );
      const absentError = await captureError(probe.exec('COMMIT'));
      expect(errorCode(absentError)).toBe('23514');
      await probe.exec('ROLLBACK').catch(() => undefined);

      await probe.exec('BEGIN');
      await probe.query(
        `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
         VALUES ($1, $2, 'SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'test-suite')`,
        [futureCell, SOURCE],
      );
      await probe.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, review_status, reviewer_type, reviewed_at, rationale, created_by)
         VALUES ($1, $2, 'UNKNOWN', 'ASSESSMENT', 'AUTOMATED', $3,
                 'future assessment must not satisfy the current invariant', 'assessment-bot')`,
        [futureDecision, futureCell, TS],
      );
      await probe.exec('SAVEPOINT future_activation_probe');
      const futureError = await captureError(
        probe.query(
          `SELECT activate_rights_decision($1, 'AUTOMATED', 'assessment-bot',
                                           'future-only assessment', '2099-01-01T00:00:00.000Z')`,
          [futureDecision],
        ),
      );
      expect(errorCode(futureError)).toBe('23514');
      await probe.exec('ROLLBACK TO SAVEPOINT future_activation_probe');
      const futureCommitError = await captureError(probe.exec('COMMIT'));
      expect(errorCode(futureCommitError)).toBe('23514');
      await probe.exec('ROLLBACK').catch(() => undefined);

      await probe.exec('BEGIN');
      await probe.query(
        `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
         VALUES ($1, $2, 'LLM_RETRIEVAL', 'MCP_AGENT', 'test-suite')`,
        [unknownCell, SOURCE],
      );
      await probe.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, review_status, reviewer_type, reviewed_at, rationale, created_by)
         VALUES ($1, $2, 'UNKNOWN', 'ASSESSMENT', 'AUTOMATED', $3,
                 'explicit current unknown', 'assessment-bot')`,
        [unknownDecision, unknownCell, TS],
      );
      await probe.query(
        `SELECT activate_rights_decision($1, 'AUTOMATED', 'assessment-bot',
                                         'activate explicit unknown', $2)`,
        [unknownDecision, TS],
      );
      await expect(probe.exec('COMMIT')).resolves.toBeUndefined();
      const current = await probe.query<{ decision_id: string; state: string }>(
        `SELECT decision_id, state FROM current_rights_decisions WHERE cell_id = $1`,
        [unknownCell],
      );
      expect(current).toEqual([{ decision_id: unknownDecision, state: 'UNKNOWN' }]);
    } finally {
      await probe.close();
    }
  }, 120_000);
});

describe.sequential('0014 terms activation lifecycle', () => {
  it('makes revocation terminal for one version and permits only a new explicit successor', async () => {
    const evidenceV1 = '72600000-0000-4000-8000-000000000001';
    const evidenceV2 = '72600000-0000-4000-8000-000000000002';
    const termsCell = '72600000-0000-4000-8000-000000000003';
    const versionV1 = '72600000-0000-4000-8000-000000000004';
    const versionV2 = '72600000-0000-4000-8000-000000000005';
    const activatedAt = '2026-08-02T00:00:00.000Z';
    const revokedAt = '2026-08-03T00:00:00.000Z';
    const replacedAt = '2026-08-04T00:00:00.000Z';
    const hashV1 = '1'.repeat(64);
    const hashV2 = '2'.repeat(64);

    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_evidence_artifacts
           (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
         VALUES ($1, 'TERMS', 'repo://fixtures/lifecycle-v1', 'repo://fixtures/lifecycle-v1.txt',
                 $3, 'text/plain', $5, 'test-suite'),
                ($2, 'TERMS', 'repo://fixtures/lifecycle-v2', 'repo://fixtures/lifecycle-v2.txt',
                 $4, 'text/plain', $5, 'test-suite')`,
        [evidenceV1, evidenceV2, hashV1, hashV2, TS],
      );
      await driver.query(
        `INSERT INTO rights_terms_cells
           (id, source_id, acquisition_route, account_or_product_plan, jurisdiction, created_by)
         VALUES ($1, $2, 'DIRECT_HTTP', 'public', 'US', 'test-suite')`,
        [termsCell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_terms_versions
           (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
            effective_from, recheck_at, supersedes_terms_version_id, created_by)
         VALUES ($1, $3, $4, $6, 'v1', $7, $8, NULL, 'test-suite'),
                ($2, $3, $5, $9, 'v2', $7, $8, $1, 'test-suite')`,
        [
          versionV1,
          versionV2,
          termsCell,
          evidenceV1,
          evidenceV2,
          hashV1,
          TS,
          RECHECK,
          hashV2,
        ],
      );
      await driver.query(
        `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'activate v1', $2)`,
        [versionV1, activatedAt],
      );
      await driver.query(
        `SELECT revoke_rights_terms($1, 'HUMAN', 'test-owner', 'revoke v1', $2)`,
        [versionV1, revokedAt],
      );

      await driver.exec('SAVEPOINT reactivation_probe');
      const reactivationError = await captureError(
        driver.query(
          `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'must stay revoked', $2)`,
          [versionV1, replacedAt],
        ),
      );
      expect(errorCode(reactivationError)).toBe('23514');
      await driver.exec('ROLLBACK TO SAVEPOINT reactivation_probe');

      await driver.query(
        `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'activate v2', $2)`,
        [versionV2, replacedAt],
      );
      const current = await driver.query<{
        terms_version_id: string;
        state: string;
        sequence_no: string;
      }>(
        `SELECT terms_version_id, state, sequence_no::text
           FROM current_rights_terms WHERE terms_cell_id = $1`,
        [termsCell],
      );
      expect(current).toEqual([
        { terms_version_id: versionV2, state: 'ACTIVE', sequence_no: '3' },
      ]);
    } finally {
      await driver.exec('ROLLBACK');
    }
  });
});

describe.sequential('0014 decision activation', () => {
  it('will not activate an automated ALLOW assessment', async () => {
    const cell = '73000000-0000-4000-8000-000000000001';
    const decision = '73000000-0000-4000-8000-000000000002';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells
           (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
            asset_class, output_class, operation, channel, created_by)
         VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'DATA', 'NORMALIZED_FACT',
                 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [cell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
            review_status, reviewer_type, reviewed_by, reviewed_at, effective_from,
            recheck_at, rationale, created_by)
         VALUES ($1, $2, 'ALLOW', $3, $4, 'section 1', 'ASSESSMENT', 'AUTOMATED',
                 'assessment-bot', $5, $5, $6, 'automated proposal only', 'assessment-bot')`,
        [decision, cell, TERMS_VERSION, DECISION_EVIDENCE, TS, RECHECK],
      );
      const error = await driver
        .query(
          `SELECT activate_rights_decision($1, 'AUTOMATED', 'assessment-bot',
                                           'must not activate', $2)`,
          [decision, TS],
        )
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect((error as { code?: unknown } | null)?.code).toBe('23514');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('allows competing immutable draft successors without letting a draft reserve the live cell', async () => {
    const cell = '73000000-0000-4000-8000-000000000021';
    const current = '73000000-0000-4000-8000-000000000022';
    const firstDraft = '73000000-0000-4000-8000-000000000023';
    const secondDraft = '73000000-0000-4000-8000-000000000024';
    const termsEvidenceA = '73000000-0000-4000-8000-000000000025';
    const termsEvidenceB = '73000000-0000-4000-8000-000000000026';
    const termsDraftA = '73000000-0000-4000-8000-000000000027';
    const termsDraftB = '73000000-0000-4000-8000-000000000028';
    const hashA = '3'.repeat(64);
    const hashB = '4'.repeat(64);
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells (id, source_id, operation, channel, created_by)
         VALUES ($1, $2, 'EVALUATE_MODELS', 'MODEL_PIPELINE', 'test-suite')`,
        [cell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, review_status, reviewer_type, reviewed_at,
            rationale, supersedes_decision_id, created_by)
         VALUES ($1, $4, 'UNKNOWN', 'ASSESSMENT', 'AUTOMATED', $5,
                 'current unknown', NULL, 'assessment-bot'),
                ($2, $4, 'DENY', 'ASSESSMENT', 'AUTOMATED', $5,
                 'first draft', $1, 'assessment-bot'),
                ($3, $4, 'DENY', 'ASSESSMENT', 'AUTOMATED', $5,
                 'second draft', $1, 'assessment-bot')`,
        [current, firstDraft, secondDraft, cell, TS],
      );
      await driver.query(
        `SELECT activate_rights_decision($1, 'AUTOMATED', 'assessment-bot', 'current unknown', $2)`,
        [current, TS],
      );

      await driver.query(
        `INSERT INTO rights_evidence_artifacts
           (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
         VALUES ($1, 'TERMS', 'repo://fixtures/terms-draft-a', 'repo://fixtures/terms-draft-a.txt',
                 $3, 'text/plain', $5, 'test-suite'),
                ($2, 'TERMS', 'repo://fixtures/terms-draft-b', 'repo://fixtures/terms-draft-b.txt',
                 $4, 'text/plain', $5, 'test-suite')`,
        [termsEvidenceA, termsEvidenceB, hashA, hashB, TS],
      );
      await driver.query(
        `INSERT INTO rights_terms_versions
           (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
            effective_from, recheck_at, supersedes_terms_version_id, created_by)
         VALUES ($1, $3, $4, $6, 'draft-a', $8, $9, $7, 'test-suite'),
                ($2, $3, $5, $10, 'draft-b', $8, $9, $7, 'test-suite')`,
        [
          termsDraftA,
          termsDraftB,
          TERMS_CELL,
          termsEvidenceA,
          termsEvidenceB,
          hashA,
          TERMS_VERSION,
          TS,
          RECHECK,
          hashB,
        ],
      );

      const [counts] = await driver.query<{ decision_drafts: string; terms_drafts: string }>(
        `SELECT
           (SELECT count(*)::text FROM rights_decisions
             WHERE supersedes_decision_id = $1) AS decision_drafts,
           (SELECT count(*)::text FROM rights_terms_versions
             WHERE supersedes_terms_version_id = $2) AS terms_drafts`,
        [current, TERMS_VERSION],
      );
      expect(counts).toEqual({ decision_drafts: '2', terms_drafts: '2' });
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('binds canonical condition parameters and freezes conditions on first activation', async () => {
    const cell = '73000000-0000-4000-8000-000000000031';
    const decision = '73000000-0000-4000-8000-000000000032';
    const condition = '73000000-0000-4000-8000-000000000033';
    const appended = '73000000-0000-4000-8000-000000000034';
    const parameters = JSON.stringify({ text: 'Source credit', required: true });
    const [canonicalRow] = await driver.query<{ canonical: string }>(
      `SELECT $1::jsonb::text AS canonical`,
      [parameters],
    );
    const canonical = canonicalRow?.canonical as string;
    const parametersHash = sha256(canonical);

    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells
           (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
            asset_class, output_class, operation, channel, created_by)
         VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'DATA', 'NORMALIZED_FACT',
                 'DISPLAY_PUBLICLY', 'SEARCH_INDEX', 'test-suite')`,
        [cell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
            review_status, reviewer_type, reviewed_by, reviewed_at, effective_from,
            recheck_at, rationale, created_by)
         VALUES ($1, $2, 'CONDITIONAL', $3, $4, 'attribution clause', 'APPROVED', 'HUMAN',
                 'test-owner', $5, $5, $6, 'conditional attribution', 'test-owner')`,
        [decision, cell, TERMS_VERSION, DECISION_EVIDENCE, TS, RECHECK],
      );

      await driver.exec('SAVEPOINT mismatched_parameters_probe');
      const mismatchError = await captureError(
        driver.query(
          `INSERT INTO rights_decision_conditions
             (id, decision_id, condition_key, condition_type, evaluator_key, evaluator_version,
              parameters_sha256, parameters, audit_required, created_by)
           VALUES ($1, $2, 'attribution', 'ATTRIBUTION', 'rights.attribution', '1',
                   $3, $4::jsonb, true, 'test-owner')`,
          [condition, decision, 'f'.repeat(64), parameters],
        ),
      );
      await driver.exec('ROLLBACK TO SAVEPOINT mismatched_parameters_probe');
      expect.soft(errorCode(mismatchError), 'mismatched canonical parameter hash').toBe('23514');

      await driver.query(
        `INSERT INTO rights_decision_conditions
           (id, decision_id, condition_key, condition_type, evaluator_key, evaluator_version,
            parameters_sha256, parameters, audit_required, created_by)
         VALUES ($1, $2, 'attribution', 'ATTRIBUTION', 'rights.attribution', '1',
                 $3, $4::jsonb, true, 'test-owner')`,
        [condition, decision, parametersHash, parameters],
      );
      const stored = await driver.query<{ parameters_canonical: string; parameters_sha256: string }>(
        `SELECT parameters_canonical, parameters_sha256
           FROM rights_decision_conditions WHERE id = $1`,
        [condition],
      );
      expect(stored).toEqual([
        { parameters_canonical: canonical, parameters_sha256: parametersHash },
      ]);

      await driver.query(
        `SELECT activate_rights_decision($1, 'HUMAN', 'test-owner', 'activate conditional',
                                         '2026-08-01T00:00:02.000Z')`,
        [decision],
      );
      await driver.exec('SAVEPOINT append_condition_probe');
      const appendError = await captureError(
        driver.query(
          `INSERT INTO rights_decision_conditions
             (id, decision_id, condition_key, condition_type, evaluator_key, evaluator_version,
              parameters_sha256, parameters, audit_required, created_by)
           VALUES ($1, $2, 'second_condition', 'OTHER', 'rights.other', '1',
                   $3, $4::jsonb, true, 'test-owner')`,
          [appended, decision, parametersHash, parameters],
        ),
      );
      expect(errorCode(appendError)).toBe('55000');
      await driver.exec('ROLLBACK TO SAVEPOINT append_condition_probe');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('keeps one deterministic current decision while preserving prior activations', async () => {
    const cell = '73000000-0000-4000-8000-000000000011';
    const allow = '73000000-0000-4000-8000-000000000012';
    const deny = '73000000-0000-4000-8000-000000000013';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells
           (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
            asset_class, output_class, operation, channel, created_by)
         VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'DATA', 'NORMALIZED_FACT',
                 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [cell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
            review_status, reviewer_type, reviewed_by, reviewed_at, effective_from,
            recheck_at, rationale, supersedes_decision_id, created_by)
         VALUES
           ($1, $3, 'ALLOW', $4, $5, 'section 1', 'APPROVED', 'HUMAN',
            'test-owner', $6, $6, $7, 'fixture allow', NULL, 'test-owner'),
           ($2, $3, 'DENY', $4, $5, 'section 2', 'APPROVED', 'HUMAN',
            'test-owner', $6, $6, $7, 'fixture deny', $1, 'test-owner')`,
        [allow, deny, cell, TERMS_VERSION, DECISION_EVIDENCE, TS, RECHECK],
      );
      await driver.query(
        `SELECT activate_rights_decision($1, 'HUMAN', 'test-owner', 'allow first', $3),
                activate_rights_decision($2, 'HUMAN', 'test-owner', 'deny next', $4)`,
        [allow, deny, TS, '2026-08-01T00:00:01.000Z'],
      );
      await driver.exec('COMMIT');
    } catch (error) {
      await driver.exec('ROLLBACK');
      throw error;
    }

    const current = await driver.query<{ decision_id: string; state: string }>(
      `SELECT decision_id, state FROM current_rights_decisions WHERE cell_id = $1`,
      [cell],
    );
    const history = await driver.query<{ sequence_no: string }>(
      `SELECT sequence_no::text FROM rights_decision_activation_events
        WHERE cell_id = $1 ORDER BY sequence_no`,
      [cell],
    );
    expect(current).toEqual([{ decision_id: deny, state: 'DENY' }]);
    expect(history.map((entry) => entry.sequence_no)).toEqual(['1', '2']);
  });
});

describe.sequential('0014 authorization scope and provenance integrity', () => {
  it('does not permit mutation of an evidenced source-publisher mapping', async () => {
    const mutationError = await rollbackProbe(
      `UPDATE sources
          SET rights_publisher_mapping_reviewed_by = 'tampered-reviewer'
        WHERE id = $1`,
      [SOURCE],
    );
    expect(errorCode(mutationError)).toBe('55000');
  });

  it('does not permit mutation of an artifact acquisition scope', async () => {
    const artifact = '73500000-0000-4000-8000-000000000001';
    await driver.exec('BEGIN');
    try {
      await insertArtifact(
        driver,
        artifact,
        'https://rights-fixture.example/scope-a.json',
        '5'.repeat(64),
      );
      const mutationError = await captureError(
        driver.query(
          `UPDATE source_artifacts SET acquisition_route = 'VENDOR_API' WHERE id = $1`,
          [artifact],
        ),
      );
      expect(errorCode(mutationError)).toBe('55000');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('rejects entity evidence whose artifact is not the source record artifact', async () => {
    const artifactA = '73500000-0000-4000-8000-000000000011';
    const artifactB = '73500000-0000-4000-8000-000000000012';
    const record = '73500000-0000-4000-8000-000000000013';
    const entity = '73500000-0000-4000-8000-000000000014';
    await driver.exec('BEGIN');
    try {
      await insertArtifact(
        driver,
        artifactA,
        'https://rights-fixture.example/entity-a.json',
        '6'.repeat(64),
      );
      await insertArtifact(
        driver,
        artifactB,
        'https://rights-fixture.example/entity-b.json',
        '7'.repeat(64),
      );
      await driver.query(
        `INSERT INTO source_records
           (id, source_id, artifact_id, source_record_key, entity_type, raw_payload,
            normalized_payload, extraction_confidence, extractor_version)
         VALUES ($1, $2, $3, 'entity-record', 'equipment_model', '{}'::jsonb, '{}'::jsonb,
                 1, 'rights-test-v1')`,
        [record, SOURCE, artifactA],
      );
      await driver.query(
        `INSERT INTO entities
           (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
            quality_score, first_seen_at)
         VALUES ($1, $2, 'equipment_model', 'Rights fixture model', 'rights-fixture-model',
                 'CANDIDATE', 0, $3)`,
        [entity, VERTICAL, TS],
      );

      await driver.exec('SAVEPOINT mismatched_entity_evidence_probe');
      const mismatchError = await captureError(
        driver.query(
          `INSERT INTO entity_evidence
             (entity_id, artifact_id, source_record_id, contribution_role,
              locator_type, locator_value, observed_at)
           VALUES ($1, $2, $3, 'IDENTITY', 'WHOLE_DOCUMENT', '', $4)`,
          [entity, artifactB, record, TS],
        ),
      );
      expect(errorCode(mismatchError)).toBe('23514');
      await driver.exec('ROLLBACK TO SAVEPOINT mismatched_entity_evidence_probe');

      await expect(
        driver.query(
          `INSERT INTO entity_evidence
             (entity_id, artifact_id, source_record_id, contribution_role,
              locator_type, locator_value, observed_at)
           VALUES ($1, $2, $3, 'IDENTITY', 'WHOLE_DOCUMENT', '', $4)`,
          [entity, artifactA, record, TS],
        ),
      ).resolves.toBeDefined();
    } finally {
      await driver.exec('ROLLBACK');
    }
  });

  it('rejects a sequential transitive cycle in derived-fact provenance', async () => {
    const entity = '73500000-0000-4000-8000-000000000021';
    const factA = '73500000-0000-4000-8000-000000000022';
    const factB = '73500000-0000-4000-8000-000000000023';
    const factC = '73500000-0000-4000-8000-000000000024';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO entities
           (id, vertical_id, entity_type, canonical_name, canonical_slug, status,
            quality_score, first_seen_at)
         VALUES ($1, $2, 'equipment_model', 'Dependency fixture', 'dependency-fixture',
                 'CANDIDATE', 0, $3)`,
        [entity, VERTICAL, TS],
      );
      await driver.query(
        `INSERT INTO facts
           (id, entity_id, property, normalized_value, value_type, valid_from, status,
            confidence, recorded_at, output_kind)
         VALUES ($2, $3, 'derived_c', '3'::jsonb, 'integer', $4, 'PROPOSED', 1, $4,
                 'NORMALIZED_FACT'),
                ($1, $3, 'derived_b', '2'::jsonb, 'integer', $4, 'PROPOSED', 1, $4, NULL)`,
        [factB, factC, entity, TS],
      );
      await driver.query(
        `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
         VALUES ($1, $2, 'derive-b-from-c')`,
        [factB, factC],
      );
      await driver.query(`UPDATE facts SET output_kind = 'DERIVED_METRIC' WHERE id = $1`, [factB]);
      await driver.query(
        `INSERT INTO facts
           (id, entity_id, property, normalized_value, value_type, valid_from, status,
            confidence, recorded_at, output_kind)
         VALUES ($1, $2, 'derived_a', '1'::jsonb, 'integer', $3, 'PROPOSED', 1, $3, NULL)`,
        [factA, entity, TS],
      );
      await driver.query(
        `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
         VALUES ($1, $2, 'derive-a-from-b')`,
        [factA, factB],
      );
      await driver.query(`UPDATE facts SET output_kind = 'DERIVED_METRIC' WHERE id = $1`, [factA]);

      await driver.exec('SAVEPOINT provenance_cycle_probe');
      const cycleError = await captureError(
        driver.query(
          `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
           VALUES ($1, $2, 'derive-c-from-a')`,
          [factC, factA],
        ),
      );
      expect(errorCode(cycleError)).toBe('23514');
      await driver.exec('ROLLBACK TO SAVEPOINT provenance_cycle_probe');
      const [count] = await driver.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM fact_dependencies WHERE derived_fact_id IN ($1, $2, $3)`,
        [factA, factB, factC],
      );
      expect(count?.count).toBe('2');
    } finally {
      await driver.exec('ROLLBACK');
    }
  });
});

describe.sequential('0014 explicit deny exceptions', () => {
  it('rejects an equal-scope exception and accepts a strictly narrower owned-source exception', async () => {
    const denyCell = '74000000-0000-4000-8000-000000000001';
    const denyDecision = '74000000-0000-4000-8000-000000000002';
    const sameAllow = '74000000-0000-4000-8000-000000000004';
    const narrowCell = '74000000-0000-4000-8000-000000000005';
    const narrowAllow = '74000000-0000-4000-8000-000000000006';
    const duplicateHashEvidence = '74000000-0000-4000-8000-000000000007';
    const renewalEvidence = '74000000-0000-4000-8000-000000000008';
    await driver.exec('BEGIN');
    try {
      await driver.query(
        `INSERT INTO rights_cells (id, publisher_id, operation, channel, created_by)
         VALUES ($1, $2, 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [denyCell, PUBLISHER],
      );
      await driver.query(
        `INSERT INTO rights_cells
           (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
            field_key, operation, channel, created_by)
         VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'seer2_rating',
                 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'test-suite')`,
        [narrowCell, SOURCE],
      );
      await driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
            review_status, reviewer_type, reviewed_by, reviewed_at, effective_from,
            recheck_at, rationale, created_by)
         VALUES
           ($1, $2, 'DENY', $6, $7, 'prohibition', 'APPROVED', 'COUNSEL',
            'test-counsel', $8, $8, $9, 'publisher deny', 'test-counsel'),
           ($3, $2, 'ALLOW', $6, $7, 'not an exception', 'APPROVED', 'COUNSEL',
            'test-counsel', $8, $8, $9, 'equal allow', 'test-counsel'),
           ($4, $5, 'ALLOW', $6, $7, 'field exception', 'APPROVED', 'COUNSEL',
            'test-counsel', $8, $8, $9, 'narrow allow', 'test-counsel')`,
        [
          denyDecision,
          denyCell,
          sameAllow,
          narrowAllow,
          narrowCell,
          TERMS_VERSION,
          DECISION_EVIDENCE,
          TS,
          RECHECK,
        ],
      );
      await driver.query(
        `SELECT activate_rights_decision($1, 'COUNSEL', 'test-counsel', 'deny', $3),
                 activate_rights_decision($2, 'COUNSEL', 'test-counsel', 'narrow allow', $3)`,
        [denyDecision, narrowAllow, TS],
      );
      await driver.query(
        `INSERT INTO rights_evidence_artifacts
           (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
         VALUES ($1, 'AGREEMENT', 'repo://fixtures/duplicate-exception-evidence',
                 'repo://fixtures/duplicate-exception-evidence.txt', $3,
                 'text/plain', $5, 'test-suite'),
                ($2, 'AGREEMENT', 'repo://fixtures/renewed-exception-evidence',
                 'repo://fixtures/renewed-exception-evidence.txt', $4,
                 'text/plain', $5, 'test-suite')`,
        [duplicateHashEvidence, renewalEvidence, DECISION_HASH, 'e'.repeat(64), TS],
      );
      await driver.exec('SAVEPOINT equal_exception_probe');
      const equalError = await driver
        .query(
          `INSERT INTO rights_deny_exceptions
             (deny_decision_id, exception_decision_id, evidence_artifact_id, clause_ref,
              reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at)
           VALUES ($1, $2, $3, 'equal is not narrow', 'COUNSEL', 'test-counsel', $4, $4, $5)`,
          [denyDecision, sameAllow, EXCEPTION_EVIDENCE, TS, RECHECK],
        )
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect((equalError as { code?: unknown } | null)?.code).toBe('23514');
      await driver.exec('ROLLBACK TO SAVEPOINT equal_exception_probe');

      await driver.exec('SAVEPOINT duplicate_hash_exception_probe');
      const duplicateHashError = await captureError(
        driver.query(
          `INSERT INTO rights_deny_exceptions
             (deny_decision_id, exception_decision_id, evidence_artifact_id, clause_ref,
              reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at)
           VALUES ($1, $2, $3, 'same bytes are not independent', 'COUNSEL',
                   'test-counsel', $4, $4, $5)`,
          [denyDecision, narrowAllow, duplicateHashEvidence, TS, RECHECK],
        ),
      );
      expect(errorCode(duplicateHashError)).toBe('23514');
      await driver.exec('ROLLBACK TO SAVEPOINT duplicate_hash_exception_probe');

      await expect(
        driver.query(
          `INSERT INTO rights_deny_exceptions
             (deny_decision_id, exception_decision_id, evidence_artifact_id, clause_ref,
              reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at)
           VALUES ($1, $2, $3, 'field exception', 'COUNSEL', 'test-counsel', $4, $4, $5)`,
          [denyDecision, narrowAllow, EXCEPTION_EVIDENCE, TS, RECHECK],
        ),
      ).resolves.toBeDefined();
      await expect(
        driver.query(
          `INSERT INTO rights_deny_exceptions
             (deny_decision_id, exception_decision_id, evidence_artifact_id, clause_ref,
              reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at)
           VALUES ($1, $2, $3, 'renewed field exception', 'COUNSEL', 'test-counsel',
                   '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z',
                   '2027-08-02T00:00:00.000Z')`,
          [denyDecision, narrowAllow, renewalEvidence],
        ),
      ).resolves.toBeDefined();
      const [links] = await driver.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM rights_deny_exceptions
          WHERE deny_decision_id = $1 AND exception_decision_id = $2`,
        [denyDecision, narrowAllow],
      );
      expect(links?.count).toBe('2');
      await driver.exec('COMMIT');
    } catch (error) {
      await driver.exec('ROLLBACK');
      throw error;
    }
  });
});
