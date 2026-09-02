import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_OBJECT_SCHEMAS } from '@data-foundry/canonical-schema';
import { PRIVATE_FUNCTION_SIGNATURES } from '@data-foundry/private-canary';
import {
  EXPECTED_TABLES,
  LEDGER_MARKER,
  LEDGER_TABLE,
  applyMigrations,
  assertLedgerIsOurs,
  ledgerMarker,
  listSchemaTables,
  partitionOwnedTables,
  createPGliteDriver,
  createPostgresDriver,
  listPublicTables,
  loadMigrations,
  normalizeSchemaName,
  resolveOperationalSchema,
  resolveSchema,
  scopeMigrationSql,
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

async function seed(
  target: MigrationDriver = driver,
  withAcquisitionScope = true,
  withSourceStream = true,
): Promise<void> {
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
    withAcquisitionScope
      ? `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                      r2_uri, http_status, extractor_version, acquisition_provider,
                                      acquisition_route)
         VALUES ($1, $2, 'https://ratings-directory.example.org/x', $3, $4, 'text/html',
                 'r2://raw/hvac/ratings-directory/x.html', 200, 'html-1.0.0', 'http',
                 'DIRECT_HTTP')`
      : `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                      r2_uri, http_status, extractor_version, acquisition_provider)
         VALUES ($1, $2, 'https://ratings-directory.example.org/x', $3, $4, 'text/html',
                 'r2://raw/hvac/ratings-directory/x.html', 200, 'html-1.0.0', 'http')`,
    [ARTIFACT, SOURCE, TS, 'a'.repeat(64)],
  );
  await target.query(
    withSourceStream
      ? `INSERT INTO source_records (id, source_id, artifact_id, source_record_key, source_stream, entity_type,
                                     raw_payload, extraction_confidence, extractor_version)
         VALUES ($1, $2, $3, 'AHRI-123', 'fixture_records', 'equipment', '{}'::jsonb, 0.95, 'html-1.0.0')`
      : `INSERT INTO source_records (id, source_id, artifact_id, source_record_key, entity_type,
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
    `INSERT INTO facts (entity_id, property, normalized_value, value_type, output_kind,
                        valid_from, valid_to, status, confidence, recorded_at)
     VALUES ($1, 'seer2_rating', $2::jsonb, 'number', 'NORMALIZED_FACT', $3, $4, $5, 0.9, $6)
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
  describe('private real-Postgres migration role guard', () => {
    function guardedDriver(currentUser: string, schemaOwner: string | null): {
      readonly driver: MigrationDriver;
      readonly executed: string[];
    } {
      const executed: string[] = [];
      return {
        executed,
        driver: {
          label: 'private migration role guard',
          async exec(sql: string) {
            executed.push(sql);
          },
          async query<T>(sql: string) {
            if (sql.includes('current_user AS current_user') && sql.includes('schema_owner')) {
              return [{
                current_user: currentUser,
                schema_owner: schemaOwner,
              }] as T[];
            }
            if (sql.includes("nspname = 'extensions'")) {
              return [{ available: true, usable: true }] as T[];
            }
            return [];
          },
          async close() {},
        },
      };
    }

    it('refuses a misbound private migration before any DDL', async () => {
      const guarded = guardedDriver('postgres', null);

      await expect(
        applyMigrations(guarded.driver, [], {
          schema: 'data_foundry',
          requirePrivateMigrationRole: true,
        }),
      ).rejects.toThrow(/df_migration/i);

      expect(guarded.executed).toEqual([]);
    });

    it('refuses an existing private schema owned by another role before any DDL', async () => {
      const guarded = guardedDriver('df_migration', 'postgres');

      await expect(
        applyMigrations(guarded.driver, [], {
          schema: 'data_foundry',
          requirePrivateMigrationRole: true,
        }),
      ).rejects.toThrow(/owned.*df_migration/i);

      expect(guarded.executed).toEqual([]);
    });

    it('uses a pre-provisioned private schema without database-wide CREATE', async () => {
      const guarded = guardedDriver('df_migration', 'df_migration');

      await expect(
        applyMigrations(guarded.driver, [], {
          schema: 'data_foundry',
          requirePrivateMigrationRole: true,
        }),
      ).resolves.toEqual([]);

      expect(guarded.executed).not.toContain('CREATE SCHEMA IF NOT EXISTS "data_foundry"');
    });

    it('refuses a missing direct private schema before any DDL', async () => {
      const guarded = guardedDriver('df_migration', null);

      await expect(
        applyMigrations(guarded.driver, [], {
          schema: 'data_foundry',
          requirePrivateMigrationRole: true,
        }),
      ).rejects.toThrow(/must be owned.*df_migration/i);

      expect(guarded.executed).toEqual([]);
    });
  });

  it('refuses a blank explicit schema instead of silently falling back to public', () => {
    expect(() => normalizeSchemaName('   ')).toThrow(/lowercase PostgreSQL identifier/i);
    expect(() => resolveSchema(['--schema', ''], {})).toThrow(/lowercase PostgreSQL identifier/i);
    // Package managers commonly preserve the equals form. Treating it as an
    // unknown flag would silently use the public default — precisely the
    // shared Alpha Lab schema this switch exists to protect.
    expect(resolveSchema(['--schema=data_foundry'], {})).toBe('data_foundry');
    expect(() => resolveSchema(['--schema='], {})).toThrow(/lowercase PostgreSQL identifier/i);
    expect(() => resolveSchema(['--schema=data_foundry', '--schema', 'public'], {})).toThrow(
      /only once/i,
    );
    expect(resolveSchema([], {})).toBe('public');
    expect(resolveSchema([], {}, 'data_foundry')).toBe('data_foundry');
    expect(resolveSchema([], { DATA_FOUNDRY_SCHEMA: 'public' })).toBe('public');
    expect(resolveOperationalSchema({})).toBe('data_foundry');
    expect(resolveOperationalSchema({ DATA_FOUNDRY_SCHEMA: 'public' })).toBe('public');
    expect(() => normalizeSchemaName('another_private_schema')).toThrow(/data_foundry/i);
  });

  it('permits direct PostgreSQL mutation only in the private Data Foundry schema', async () => {
    const module = (await import('../scripts/migrate.js')) as Record<string, unknown>;
    const assertDirectPostgresPrivateSchema = module['assertDirectPostgresPrivateSchema'];
    expect(assertDirectPostgresPrivateSchema).toEqual(expect.any(Function));
    if (typeof assertDirectPostgresPrivateSchema !== 'function') return;

    expect(assertDirectPostgresPrivateSchema('data_foundry')).toBe('data_foundry');
    expect(() => assertDirectPostgresPrivateSchema('public')).toThrow(/data_foundry/i);
  });

  it('uses the canonical TLS URL policy for private migration connections', async () => {
    await expect(
      createPostgresDriver(
        'postgres://operator@db.invalid/data-foundry?options=-csearch_path%3Dpublic',
        'data_foundry',
      ),
    ).rejects.toThrow(/TLS.*query|query.*TLS/i);
  });

  it('fails closed when a known constraint probe has unsafe boolean scope', () => {
    // If the private-schema transform merely appends `AND conrelid` here,
    // SQL precedence leaves the `OR TRUE` branch unscoped. A shared Alpha Lab
    // schema must reject any known probe it cannot prove it has scoped.
    const unsafeProbe = `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'facts_output_kind_allowed' OR TRUE
        ) THEN
          NULL;
        END IF;
      END;
      $$;
    `;

    expect(() => scopeMigrationSql(unsafeProbe, 'data_foundry')).toThrow(
      /cannot safely scope.*facts_output_kind_allowed/i,
    );
  });

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

  it('pins every public-schema function to the prepared migration search path', async () => {
    const rows = await driver.query<{ signature: string; search_path: string | null }>(`
      SELECT p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS signature,
             (SELECT setting FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%') AS search_path
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
       ORDER BY signature
    `);
    expect(rows.map((row) => row.signature).sort()).toEqual([...PRIVATE_FUNCTION_SIGNATURES].sort());
    expect(new Set(rows.map((row) => row.search_path))).toEqual(
      new Set(['search_path=public, pg_catalog, extensions']),
    );
  });

  it('is idempotent — a second run applies nothing', async () => {
    const second = await applyMigrations(driver, migrations);
    expect(second.every((result) => result.skipped)).toBe(true);
  });

  it('installs the four audited 0028 foreign-key indexes with exact definitions', async () => {
    const indexes = await driver.query<{
      index_name: string;
      is_unique: boolean;
      predicate: string | null;
      definition: string;
    }>(`
      SELECT index_rel.relname::text AS index_name,
             idx.indisunique AS is_unique,
             pg_get_expr(idx.indpred, idx.indrelid)::text AS predicate,
             pg_get_indexdef(idx.indexrelid)::text AS definition
        FROM pg_index AS idx
        JOIN pg_class AS index_rel ON index_rel.oid = idx.indexrelid
       WHERE index_rel.relname = ANY(ARRAY[
         'rights_cells_source_idx',
         'rights_terms_cells_source_idx',
         'rights_decision_activation_events_decision_idx',
         'rights_terms_activation_events_version_idx'
       ]::text[])
       ORDER BY index_rel.relname
    `);

    expect(indexes).toEqual([
      {
        index_name: 'rights_cells_source_idx',
        is_unique: false,
        predicate: '(source_id IS NOT NULL)',
        definition: expect.stringMatching(/ON public\.rights_cells USING btree \(source_id\) WHERE \(source_id IS NOT NULL\)$/),
      },
      {
        index_name: 'rights_decision_activation_events_decision_idx',
        is_unique: true,
        predicate: null,
        definition: expect.stringMatching(/UNIQUE INDEX .* ON public\.rights_decision_activation_events USING btree \(decision_id\)$/),
      },
      {
        index_name: 'rights_terms_activation_events_version_idx',
        is_unique: false,
        predicate: null,
        definition: expect.stringMatching(/ON public\.rights_terms_activation_events USING btree \(terms_version_id\)$/),
      },
      {
        index_name: 'rights_terms_cells_source_idx',
        is_unique: false,
        predicate: '(source_id IS NOT NULL)',
        definition: expect.stringMatching(/ON public\.rights_terms_cells USING btree \(source_id\) WHERE \(source_id IS NOT NULL\)$/),
      },
    ]);
  });

  it('refuses a pre-existing same-name wrong index before accepting migration 0028 in the ledger', async () => {
    const collision = await createPGliteDriver();
    try {
      await applyMigrations(
        collision,
        migrations.filter(({ version }) => version < '0028'),
      );
      await collision.exec('CREATE INDEX rights_cells_source_idx ON rights_cells (id)');

      await expect(applyMigrations(collision, migrations)).rejects.toThrow(
        /rights_cells_source_idx|already exists/i,
      );
      const rows = await collision.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = '0028'",
      );
      expect(rows).toEqual([]);
    } finally {
      await collision.close();
    }
  }, 120_000);

  it('keeps an explicitly isolated Data Foundry schema out of a shared public schema', async () => {
    const isolated = await createPGliteDriver();
    try {
      // This stands in for Alpha Lab's unrelated Rise application. Removing the
      // requested schema support would send Data Foundry's tables and ledger
      // into this same public namespace.
      await isolated.exec('CREATE TABLE public.rise_leads (id UUID PRIMARY KEY)');

      await applyMigrations(isolated, migrations, { schema: 'data_foundry' });

      const [currentSchema] = await isolated.query<{ schema: string }>(
        'SELECT current_schema() AS schema',
      );
      expect(currentSchema?.schema).toBe('data_foundry');

      // Supabase installs extensions in the `extensions` schema. Keep it in
      // the path so runtime functions such as similarity() can resolve, while
      // keeping Alpha Lab's public schema out of reach.
      const [searchPath] = await isolated.query<{ configured_path: string }>(
        "SELECT current_setting('search_path') AS configured_path",
      );
      expect(searchPath?.configured_path).toContain('extensions');
      expect(searchPath?.configured_path).not.toMatch(/(^|,)\s*public\s*(,|$)/);

      const functionPaths = await isolated.query<{ search_path: string | null }>(`
        SELECT (SELECT setting FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%') AS search_path
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'data_foundry'
      `);
      expect(functionPaths).toHaveLength(PRIVATE_FUNCTION_SIGNATURES.length);
      expect(new Set(functionPaths.map((row) => row.search_path))).toEqual(
        new Set(['search_path=data_foundry, pg_catalog, extensions']),
      );

      const dataFoundryTables = await isolated.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'data_foundry' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      );
      expect(dataFoundryTables.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([...EXPECTED_TABLES, LEDGER_TABLE]),
      );

      const publicTables = await listPublicTables(isolated);
      expect(publicTables).toEqual(['rise_leads']);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it('keeps a foreign public ledger untouched while proving the private ledger is its own and idempotent', async () => {
    const isolated = await createPGliteDriver();
    try {
      // `schema_migrations` is conventional enough that an Alpha Lab product
      // can own it. A private install must neither inspect nor adopt it.
      await isolated.exec(`
        CREATE TABLE public.schema_migrations (external_note TEXT NOT NULL);
        INSERT INTO public.schema_migrations (external_note) VALUES ('rise owns this ledger');
      `);

      await applyMigrations(isolated, migrations, { schema: 'data_foundry' });

      expect(await ledgerMarker(isolated, 'data_foundry')).toBe(LEDGER_MARKER);
      expect(await ledgerMarker(isolated, 'public')).toBeNull();
      expect(await listSchemaTables(isolated, 'public')).toEqual([LEDGER_TABLE]);
      expect(await listSchemaTables(isolated, 'data_foundry')).toEqual(
        expect.arrayContaining([...EXPECTED_TABLES, LEDGER_TABLE]),
      );

      const publicLedger = await isolated.query<{ external_note: string }>(
        'SELECT external_note FROM public.schema_migrations',
      );
      expect(publicLedger).toEqual([{ external_note: 'rise owns this ledger' }]);

      const second = await applyMigrations(isolated, migrations, { schema: 'data_foundry' });
      expect(second).toHaveLength(migrations.length);
      expect(second.every((result) => result.skipped)).toBe(true);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it('allows an Alpha Lab public-name collision without adopting it as Data Foundry', async () => {
    const isolated = await createPGliteDriver();
    try {
      // `sources` is a generic product name. Only the Data Foundry ledger
      // marker proves ownership; a same-named Rise table must not block a
      // private bootstrap or be read by it.
      await isolated.exec('CREATE TABLE public.sources (id UUID PRIMARY KEY, owner TEXT NOT NULL)');

      await applyMigrations(isolated, migrations, { schema: 'data_foundry' });

      expect(await listSchemaTables(isolated, 'public')).toEqual(['sources']);
      expect(await ledgerMarker(isolated, 'data_foundry')).toBe(LEDGER_MARKER);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it('refuses a private bootstrap when a prior public Data Foundry installation exists', async () => {
    const legacy = await createPGliteDriver();
    try {
      await applyMigrations(legacy, migrations);

      await expect(
        applyMigrations(legacy, migrations, { schema: 'data_foundry' }),
      ).rejects.toThrow(/public Data Foundry installation/i);

      expect(await listSchemaTables(legacy, 'data_foundry')).toEqual([]);
    } finally {
      await legacy.close();
    }
  }, 120_000);

  it('records the schema-scoped migration bytes so a transform change cannot silently skip', async () => {
    const isolated = await createPGliteDriver();
    try {
      const transformed = migrations.find((migration) => migration.version === '0022');
      expect(transformed).toBeDefined();
      await applyMigrations(isolated, migrations, { schema: 'data_foundry' });

      // The historical source checksum is deliberately different from the
      // private effective SQL checksum. Writing it back simulates an older or
      // changed transform and must fail closed rather than skip migration 0022.
      await isolated.query(
        'UPDATE "data_foundry".schema_migrations SET checksum = $1 WHERE version = $2',
        [transformed?.checksum ?? '', transformed?.version ?? ''],
      );
      await expect(
        applyMigrations(isolated, migrations, { schema: 'data_foundry' }),
      ).rejects.toThrow(/Migration 0022_source_record_revision_state\.sql has changed since it was applied/i);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it('does not let an unrelated public constraint suppress a private-schema constraint', async () => {
    const isolated = await createPGliteDriver();
    try {
      // Constraint names are not a database-wide ownership boundary. Cover
      // every historical name-only probe: no Rise constraint may make 0014 or
      // 0016 skip the constraint on its intended Data Foundry relation.
      await isolated.exec(`
        CREATE TABLE public.rise_constraint_names (
          id INTEGER NOT NULL,
          CONSTRAINT sources_rights_publisher_fk CHECK (id IS NOT NULL),
          CONSTRAINT source_artifacts_acquisition_route_allowed CHECK (id IS NOT NULL),
          CONSTRAINT source_artifacts_acquisition_plan_nonempty CHECK (id IS NOT NULL),
          CONSTRAINT source_artifacts_acquisition_jurisdiction_nonempty CHECK (id IS NOT NULL),
          CONSTRAINT source_artifacts_acquisition_route_required CHECK (id IS NOT NULL),
          CONSTRAINT source_artifacts_policy_snapshot_fk CHECK (id IS NOT NULL),
          CONSTRAINT facts_output_kind_allowed CHECK (id IS NOT NULL)
        )
      `);

      await applyMigrations(isolated, migrations, { schema: 'data_foundry' });

      const constraints = await isolated.query<{ relation_name: string; conname: string }>(
        `SELECT relation.relname AS relation_name, c.conname
           FROM pg_constraint c
           JOIN pg_class relation ON relation.oid = c.conrelid
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'data_foundry'
            AND c.conname = ANY(ARRAY[
              'sources_rights_publisher_fk',
              'source_artifacts_acquisition_route_allowed',
              'source_artifacts_acquisition_plan_nonempty',
              'source_artifacts_acquisition_jurisdiction_nonempty',
              'source_artifacts_acquisition_route_required',
              'source_artifacts_policy_snapshot_fk',
              'facts_output_kind_allowed'
            ])
          ORDER BY relation.relname, c.conname`,
      );
      expect(constraints).toEqual([
        { relation_name: 'facts', conname: 'facts_output_kind_allowed' },
        { relation_name: 'source_artifacts', conname: 'source_artifacts_acquisition_jurisdiction_nonempty' },
        { relation_name: 'source_artifacts', conname: 'source_artifacts_acquisition_plan_nonempty' },
        { relation_name: 'source_artifacts', conname: 'source_artifacts_acquisition_route_allowed' },
        { relation_name: 'source_artifacts', conname: 'source_artifacts_acquisition_route_required' },
        { relation_name: 'source_artifacts', conname: 'source_artifacts_policy_snapshot_fk' },
        { relation_name: 'sources', conname: 'sources_rights_publisher_fk' },
      ]);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it('stops 0012 with an operator-readable error when an existing key has no vertical', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(
        upgrade,
        migrations.filter((migration) => migration.version < '0012'),
      );
      await upgrade.query(
        `INSERT INTO api_tenants (id, slug, name)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-null-key', 'Legacy null key')`,
      );
      await upgrade.query(
        `INSERT INTO api_keys (tenant_id, token_hash, token_prefix, label, vertical_id)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'df_live_abcd', 'needs owner scope', NULL)`,
        ['a'.repeat(64)],
      );

      await expect(applyMigrations(upgrade, migrations)).rejects.toThrow(
        /0012 precondition failed: api_keys\.vertical_id contains 1 NULL row\(s\); assign every key to its intended vertical before retrying/i,
      );

      const applied = await upgrade.query<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = '0012'`,
      );
      expect(applied).toHaveLength(0);
      const [column] = await upgrade.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'vertical_id'`,
      );
      expect(column?.is_nullable).toBe('YES');
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('stops 0012 before guessing attribution for an existing usage event', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(
        upgrade,
        migrations.filter((migration) => migration.version < '0012'),
      );
      await upgrade.query(
        `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
         VALUES ($1, 'legacy-metering', 'Legacy metering', '1.0.0', 'ACTIVE', $2::jsonb)`,
        [VERTICAL, JSON.stringify({ cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 })],
      );
      await upgrade.query(
        `INSERT INTO api_tenants (id, slug, name)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-usage', 'Legacy usage')`,
      );
      await upgrade.query(
        `INSERT INTO api_keys (id, tenant_id, token_hash, token_prefix, label, vertical_id)
         VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'df_live_abcd', 'scoped key', $2)`,
        ['b'.repeat(64), VERTICAL],
      );
      await upgrade.query(
        `INSERT INTO api_usage_events (tenant_id, api_key_id, route, method, status)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '/v1/search', 'GET', 200)`,
      );

      await expect(applyMigrations(upgrade, migrations)).rejects.toThrow(
        /0012 precondition failed: api_usage_events contains 1 existing row\(s\); route_key and vertical_id cannot be inferred safely/i,
      );

      const applied = await upgrade.query<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = '0012'`,
      );
      expect(applied).toHaveLength(0);
      const columns = await upgrade.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'api_usage_events'`,
      );
      expect(columns.map((column) => column.column_name)).toContain('route');
      expect(columns.map((column) => column.column_name)).not.toContain('route_key');
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('stops 0022 when legacy mutable source records no longer match existing evidence', async () => {
    const legacy = await createPGliteDriver();
    try {
      await applyMigrations(legacy, migrations.filter((migration) => migration.version < '0022'));
      await seed(legacy, true, false);
      await legacy.query(
        `INSERT INTO entity_evidence (entity_id, artifact_id, source_record_id, contribution_role,
                                      locator_type, locator_value, observed_at)
         VALUES ($1, $2, $3, 'EXISTENCE', 'JSON_POINTER', '/products/0', $4)`,
        [ENTITY, ARTIFACT, RECORD, TS],
      );
      await legacy.query(
        `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                       r2_uri, http_status, extractor_version, acquisition_provider,
                                       acquisition_route)
         VALUES ('66666666-6666-4666-8666-666666666666', $1,
                 'https://ratings-directory.example.org/reprocessed', $2, $3, 'text/html',
                 'r2://raw/hvac/ratings-directory/reprocessed.html', 200, 'html-2.0.0', 'http',
                 'DIRECT_HTTP')`,
        [SOURCE, TS, 'b'.repeat(64)],
      );
      // This was legal before revision-state hardening and is the exact
      // historical condition 0022 must make an operator investigate.
      await legacy.query(
        `UPDATE source_records SET artifact_id = '66666666-6666-4666-8666-666666666666' WHERE id = $1`,
        [RECORD],
      );

      await expect(applyMigrations(legacy, migrations)).rejects.toThrow(
        /source-record evidence provenance mismatch exists/i,
      );
      const applied = await legacy.query<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = '0022'`,
      );
      expect(applied).toHaveLength(0);
    } finally {
      await legacy.close();
    }
  }, 120_000);

  it('installs the 0022 source-record checks when unrelated tables use the same constraint names', async () => {
    const shared = await createPGliteDriver();
    try {
      await applyMigrations(shared, migrations.filter((migration) => migration.version < '0022'));
      await shared.query(
        `CREATE TABLE unrelated_revision_state (
           value TEXT CONSTRAINT source_records_revision_state_allowed CHECK (value <> '')
         )`,
      );
      await shared.query(
        `CREATE TABLE unrelated_evidence_fingerprint (
           value TEXT CONSTRAINT source_records_evidence_fingerprint_sha256 CHECK (value <> '')
         )`,
      );

      await applyMigrations(shared, migrations);

      const constraints = await shared.query<{ conname: string }>(
        `SELECT constraint_row.conname
           FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid = 'public.source_records'::regclass
            AND constraint_row.contype = 'c'
            AND constraint_row.conname IN (
              'source_records_revision_state_allowed',
              'source_records_evidence_fingerprint_sha256'
            )
          ORDER BY constraint_row.conname`,
      );
      expect(constraints.map((constraint) => constraint.conname)).toEqual([
        'source_records_evidence_fingerprint_sha256',
        'source_records_revision_state_allowed',
      ]);
    } finally {
      await shared.close();
    }
  }, 120_000);

  it('backfills no legacy alias authority, including aliases nulled by source deletion', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(upgrade, migrations.filter((migration) => migration.version < '0023'));
      await seed(upgrade, true, false);
      const curatedAlias = '56565656-5656-4656-8656-565656565656';
      const legacySourceAlias = '57575757-5757-4757-8757-575757575757';
      const deletedSourceAlias = '58585858-5858-4858-8858-585858585858';
      const deletedSource = '59595959-5959-4959-8959-595959595959';
      await upgrade.query(
        `INSERT INTO sources (
           id, vertical_id, publisher, domain, source_type, authority_rank,
           rights_classification, attribution_requirement, robots_policy,
           refresh_cadence, status, kill_switch_engaged
         )
         SELECT $1, vertical_id, 'Deleted legacy source', 'deleted-legacy.example',
                source_type, authority_rank, rights_classification,
                attribution_requirement, robots_policy, refresh_cadence,
                'UNDER_REVIEW', kill_switch_engaged
           FROM sources WHERE id = $2`,
        [deletedSource, SOURCE],
      );
      await upgrade.query(
        `INSERT INTO entity_aliases (
           id, entity_id, alias_type, alias_value, normalized_value, source_id,
           identity_confidence, valid_from, valid_to
         ) VALUES
           ($1, $3, 'former_name', 'Carrier Corp', 'carrier corp', NULL, 0.9, $4, NULL),
           ($2, $3, 'model_number', '24ANB7', '24anb7', $5, 0.99, $4, NULL),
           ($6, $3, 'external_id', 'DELETED-SOURCE', 'deleted-source', $7, 0.8, $4, NULL)`,
        [curatedAlias, legacySourceAlias, ENTITY, TS, SOURCE, deletedSourceAlias, deletedSource],
      );
      await upgrade.query(`DELETE FROM sources WHERE id = $1`, [deletedSource]);

      const first = await applyMigrations(upgrade, migrations);
      expect(first.find((migration) => migration.version === '0023')?.skipped).toBe(false);

      const claims = await upgrade.query<{
        entity_alias_id: string;
        asserted_alias_value: string;
        identity_confidence: number;
        claim_kind: string;
        source_record_id: string | null;
      }>(
        `SELECT entity_alias_id, asserted_alias_value, identity_confidence,
                claim_kind, source_record_id
           FROM entity_alias_claims
          ORDER BY entity_alias_id`,
      );
      expect(claims).toEqual([]);

      const current = await upgrade.query<{ id: string }>(
        `SELECT id FROM current_entity_aliases ORDER BY id`,
      );
      expect(current.map((alias) => alias.id)).toEqual([]);

      const second = await applyMigrations(upgrade, migrations);
      expect(second.every((migration) => migration.skipped)).toBe(true);
      expect(await upgrade.query(`SELECT id FROM entity_alias_claims`)).toHaveLength(0);
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('does not manufacture alias-claim evidence linkage during the 0025 upgrade', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(upgrade, migrations.filter((migration) => migration.version < '0025'));
      await seed(upgrade);
      const alias = '60606060-6060-4060-8060-606060606060';
      const claim = '61616161-6161-4161-8161-616161616161';
      await upgrade.query(
        `INSERT INTO entity_aliases (
           id, entity_id, alias_type, alias_value, normalized_value, source_id,
           identity_confidence, valid_from, valid_to
         ) VALUES ($1, $2, 'model_number', 'LEGACY-CLAIM', 'legacy-claim', $3,
                   0.9, $4, NULL)`,
        [alias, ENTITY, SOURCE, TS],
      );
      await upgrade.query(
        `INSERT INTO entity_alias_claims (
           id, entity_alias_id, asserted_alias_value, asserted_normalized_value,
           identity_confidence, claim_kind, source_id, source_record_id,
           authority_epoch, locator_type, locator_value, valid_to
         ) VALUES ($1, $2, 'LEGACY-CLAIM', 'legacy-claim', 0.9,
                   'SOURCE_RECORD', $3, $4, 0, 'JSON_POINTER', '/model', NULL)`,
        [claim, alias, SOURCE, RECORD],
      );
      await upgrade.query(
        `INSERT INTO entity_evidence (
           entity_id, artifact_id, source_record_id, contribution_role,
           locator_type, locator_value, observed_at
         ) VALUES ($1, $2, $3, 'ALIAS', 'JSON_POINTER', '/model', $4)`,
        [ENTITY, ARTIFACT, RECORD, TS],
      );
      expect(await upgrade.query<{ id: string }>(
        `SELECT id FROM current_entity_aliases WHERE id = $1`,
        [alias],
      )).toEqual([{ id: alias }]);

      const applied = await applyMigrations(upgrade, migrations);
      expect(applied.find((migration) => migration.version === '0025')?.skipped).toBe(false);
      expect(await upgrade.query<{ id: string }>(
        `SELECT id FROM current_entity_aliases WHERE id = $1`,
        [alias],
      )).toEqual([]);
      expect(await upgrade.query<{ entity_alias_claim_id: string | null }>(
        `SELECT entity_alias_claim_id FROM entity_evidence
          WHERE entity_id = $1 AND contribution_role = 'ALIAS'`,
        [ENTITY],
      )).toEqual([{ entity_alias_claim_id: null }]);

      await expect(upgrade.query(
        `INSERT INTO entity_evidence (
           entity_id, artifact_id, source_record_id, contribution_role,
           locator_type, locator_value, observed_at
         ) VALUES ($1, $2, $3, 'ALIAS', 'JSON_POINTER', '/other-model', $4)`,
        [ENTITY, ARTIFACT, RECORD, TS],
      )).rejects.toThrow(/entity_evidence_alias_claim_shape|alias claim/i);
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('revokes unproven legacy stream membership instead of inferring snapshot authority', async () => {
    const upgrade = await createPGliteDriver();
    try {
      await applyMigrations(upgrade, migrations.filter((migration) => migration.version < '0024'));
      await seed(upgrade, true, false);
      expect(await upgrade.query<{ is_current: boolean; source_stream: string | null }>(
        `SELECT is_current, NULL::text AS source_stream FROM source_records WHERE id = $1`,
        [RECORD],
      )).toEqual([{ is_current: true, source_stream: null }]);

      await applyMigrations(upgrade, migrations);
      expect(await upgrade.query<{ is_current: boolean; source_stream: string | null }>(
        `SELECT is_current, source_stream FROM source_records WHERE id = $1`,
        [RECORD],
      )).toEqual([{ is_current: false, source_stream: null }]);
      expect(await upgrade.query(`SELECT id FROM source_record_snapshot_retirements`)).toEqual([]);
      expect(await upgrade.query(`SELECT id FROM source_stream_snapshot_acceptances`)).toEqual([]);
      expect(await upgrade.query(`SELECT id FROM source_stream_snapshot_acceptance_artifacts`)).toEqual([]);
      await expect(upgrade.query(
        `INSERT INTO source_records (
           source_id, artifact_id, source_record_key, entity_type,
           raw_payload, extraction_confidence, extractor_version
         ) VALUES ($1, $2, 'missing-stream', 'equipment', '{}'::jsonb, 1, 'test@1')`,
        [SOURCE, ARTIFACT],
      )).rejects.toThrow(/current_requires_stream|source_records_current_requires_stream/);
    } finally {
      await upgrade.close();
    }
  }, 120_000);

  it('binds every omission artifact to one immutable accepted snapshot and effective time', async () => {
    const snapshot = await createPGliteDriver();
    try {
      await applyMigrations(snapshot, migrations);
      await seed(snapshot);
      const acceptance = '88888888-8888-4888-8888-888888888888';
      const artifactTwo = '66666666-6666-4666-8666-666666666666';
      const artifactThree = '77777777-7777-4777-8777-777777777777';
      const observedAt = '2026-08-30T00:00:00.000Z';
      const artifactRows = `
        INSERT INTO source_artifacts (
          id, source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
          http_status, extractor_version, acquisition_provider, acquisition_route
        ) VALUES
          ('${artifactTwo}', '${SOURCE}', 'https://ratings-directory.example.org/two',
           '${observedAt}', '${'b'.repeat(64)}', 'text/html', 'r2://raw/hvac/two.html',
           200, 'html-1.0.0', 'http', 'DIRECT_HTTP'),
          ('${artifactThree}', '${SOURCE}', 'https://ratings-directory.example.org/three',
           '${observedAt}', '${'c'.repeat(64)}', 'text/html', 'r2://raw/hvac/three.html',
           200, 'html-1.0.0', 'http', 'DIRECT_HTTP');`;
      const acceptanceRows = `
        INSERT INTO source_stream_snapshot_acceptances (
          id, source_id, source_stream, observed_at, snapshot_digest,
          artifact_set_digest, mapping_digest, record_set_digest, retrieval_count
        ) VALUES (
          '${acceptance}', '${SOURCE}', 'fixture_records', '${observedAt}',
          '${'d'.repeat(64)}', '${'e'.repeat(64)}', '${'f'.repeat(64)}',
          '${'1'.repeat(64)}', 3
        );
        INSERT INTO source_stream_snapshot_acceptance_artifacts (
          acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id
        ) VALUES
          ('${acceptance}', '${ARTIFACT}', 'retrieval/one', '${'2'.repeat(64)}'),
          ('${acceptance}', '${artifactTwo}', 'retrieval/two', '${'3'.repeat(64)}'),
          ('${acceptance}', '${artifactThree}', 'retrieval/three', '${'4'.repeat(64)}');`;

      await expect(snapshot.exec(`
        BEGIN;
        ${artifactRows}
        ${acceptanceRows}
        UPDATE source_records SET is_current = FALSE WHERE id = '${RECORD}';
        INSERT INTO source_record_snapshot_retirements
          (source_record_id, snapshot_acceptance_id, artifact_id,
           source_id, source_stream, retired_at)
        VALUES
          ('${RECORD}', '${acceptance}', '${ARTIFACT}', '${SOURCE}',
           'fixture_records', '${observedAt}'),
          ('${RECORD}', '${acceptance}', '${artifactTwo}', '${SOURCE}',
           'fixture_records', '${observedAt}'),
          ('${RECORD}', '${acceptance}', '${artifactThree}', '${SOURCE}',
           'fixture_records', '2026-08-30T00:00:01.000Z');
        COMMIT;
      `)).rejects.toThrow(/one effective time|accepted snapshot/i);
      await snapshot.exec('ROLLBACK');

      await snapshot.exec(`
        BEGIN;
        ${artifactRows}
        ${acceptanceRows}
        UPDATE source_records SET is_current = FALSE WHERE id = '${RECORD}';
        INSERT INTO source_record_snapshot_retirements
          (source_record_id, snapshot_acceptance_id, artifact_id,
           source_id, source_stream, retired_at)
        VALUES
          ('${RECORD}', '${acceptance}', '${ARTIFACT}', '${SOURCE}',
           'fixture_records', '${observedAt}'),
          ('${RECORD}', '${acceptance}', '${artifactTwo}', '${SOURCE}',
           'fixture_records', '${observedAt}'),
          ('${RECORD}', '${acceptance}', '${artifactThree}', '${SOURCE}',
           'fixture_records', '${observedAt}');
        COMMIT;
      `);

      expect(await snapshot.query<{ retired_at: string }>(
        `SELECT DISTINCT retired_at FROM source_record_snapshot_retirements
          WHERE source_record_id = $1`,
        [RECORD],
      )).toHaveLength(1);
      await expect(snapshot.query(
        `INSERT INTO source_stream_snapshot_acceptance_artifacts
           (acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id)
         VALUES ($1, $2, 'retrieval/late', $3)`,
        [acceptance, ARTIFACT, '5'.repeat(64)],
      )).rejects.toThrow(/same-source artifact|snapshot acceptance evidence/i);
    } finally {
      await snapshot.close();
    }
  }, 120_000);

  it('rejects a reconciliation timestamp before replacement artifact retrieval', async () => {
    const reconciliation = await createPGliteDriver();
    try {
      await applyMigrations(reconciliation, migrations);
      await seed(reconciliation);
      const replacementArtifact = '66666666-6666-4666-8666-666666666666';
      const replacementRecord = '77777777-7777-4777-8777-777777777777';
      await reconciliation.query(
        `INSERT INTO source_artifacts (
           id, source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
           http_status, extractor_version, acquisition_provider, acquisition_route
         ) VALUES ($1, $2, 'https://ratings-directory.example.org/replacement',
                   '2026-08-30T00:00:00.000Z', $3, 'text/html',
                   'r2://raw/hvac/replacement.html', 200, 'html-1.0.0',
                   'http', 'DIRECT_HTTP')`,
        [replacementArtifact, SOURCE, 'b'.repeat(64)],
      );
      await expect(reconciliation.exec(`
        BEGIN;
        UPDATE source_records SET is_current = FALSE WHERE id = '${RECORD}';
        INSERT INTO source_records (
          id, source_id, artifact_id, source_record_key, source_stream,
          entity_type, raw_payload, extraction_confidence, extractor_version
        ) VALUES (
          '${replacementRecord}', '${SOURCE}', '${replacementArtifact}', 'AHRI-123',
          'fixture_records', 'equipment', '{"replacement":true}'::jsonb, 0.95, 'html-1.0.0'
        );
        INSERT INTO source_record_reconciliations (
          superseded_source_record_id, replacement_source_record_id, reconciled_at
        ) VALUES (
          '${RECORD}', '${replacementRecord}', '2026-08-29T23:59:59.000Z'
        );
        COMMIT;
      `)).rejects.toThrow(/at or after artifact retrieval/i);
      await reconciliation.exec('ROLLBACK');
      expect(await reconciliation.query<{ is_current: boolean }>(
        `SELECT is_current FROM source_records WHERE id = $1`,
        [RECORD],
      )).toEqual([{ is_current: true }]);
    } finally {
      await reconciliation.close();
    }
  }, 120_000);

  it('makes replacement and complete-snapshot omission mutually exclusive', async () => {
    const terminal = await createPGliteDriver();
    try {
      await applyMigrations(terminal, migrations);
      await seed(terminal);
      const artifact = '66666666-6666-4666-8666-666666666666';
      const acceptance = '77777777-7777-4777-8777-777777777777';
      const replacement = '88888888-8888-4888-8888-888888888888';
      await expect(terminal.exec(`
        BEGIN;
        INSERT INTO source_artifacts (
          id, source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
          http_status, extractor_version, acquisition_provider, acquisition_route
        ) VALUES (
          '${artifact}', '${SOURCE}', 'https://ratings-directory.example.org/terminal',
          '2026-08-30T00:00:00.000Z', '${'b'.repeat(64)}', 'text/html',
          'r2://raw/hvac/terminal.html', 200, 'html-1.0.0', 'http', 'DIRECT_HTTP'
        );
        INSERT INTO source_stream_snapshot_acceptances (
          id, source_id, source_stream, observed_at, snapshot_digest,
          artifact_set_digest, mapping_digest, record_set_digest, retrieval_count
        ) VALUES (
          '${acceptance}', '${SOURCE}', 'fixture_records', '2026-08-30T00:00:00.000Z',
          '${'c'.repeat(64)}', '${'d'.repeat(64)}', '${'e'.repeat(64)}',
          '${'f'.repeat(64)}', 1
        );
        INSERT INTO source_stream_snapshot_acceptance_artifacts
          (acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id)
        VALUES ('${acceptance}', '${artifact}', 'retrieval/terminal', '${'1'.repeat(64)}');
        UPDATE source_records SET is_current = FALSE WHERE id = '${RECORD}';
        INSERT INTO source_record_snapshot_retirements
          (source_record_id, snapshot_acceptance_id, artifact_id,
           source_id, source_stream, retired_at)
        VALUES (
          '${RECORD}', '${acceptance}', '${artifact}', '${SOURCE}',
          'fixture_records', '2026-08-30T00:00:00.000Z'
        );
        INSERT INTO source_records (
          id, source_id, artifact_id, source_record_key, source_stream,
          entity_type, raw_payload, extraction_confidence, extractor_version
        ) VALUES (
          '${replacement}', '${SOURCE}', '${artifact}', 'AHRI-123', 'fixture_records',
          'equipment', '{"replacement":true}'::jsonb, 0.95, 'html-1.0.0'
        );
        INSERT INTO source_record_reconciliations
          (superseded_source_record_id, replacement_source_record_id, reconciled_at)
        VALUES ('${RECORD}', '${replacement}', '2026-08-30T00:00:00.000Z');
        COMMIT;
      `)).rejects.toThrow(/exclusively link|exactly one terminal mechanism/i);
    } finally {
      await terminal.close();
    }
  }, 120_000);

  it('refuses to run when an applied migration has been edited', async () => {
    const tampered = migrations.map((migration, index) =>
      index === 0 ? { ...migration, checksum: 'f'.repeat(64) } : migration,
    );
    await expect(applyMigrations(driver, tampered)).rejects.toThrow(/has changed since it was applied/);
  });

  it('refuses a private bootstrap before writing when the required extensions schema is absent', async () => {
    const isolated = await createPGliteDriver();
    try {
      await isolated.exec('DROP SCHEMA extensions');

      await expect(
        applyMigrations(isolated, migrations, { schema: 'data_foundry' }),
      ).rejects.toThrow(/extensions.*before migration/i);
      expect(await listSchemaTables(isolated, 'data_foundry')).toEqual([]);
    } finally {
      await isolated.close();
    }
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

  it('enforces uniqueness on a current (source_id, source_record_key) revision', async () => {
    await expect(
      driver.query(
        `INSERT INTO source_records (source_id, artifact_id, source_record_key, source_stream, entity_type,
                                     raw_payload, extraction_confidence, extractor_version)
         VALUES ($1, $2, 'AHRI-123', 'fixture_records', 'equipment', '{}'::jsonb, 0.9, 'html-1.0.0')`,
        [SOURCE, ARTIFACT],
      ),
    ).rejects.toThrow(/source_records_current_source_key_uniq/);
  });

  it('refuses to retire a current source-record revision without append-only lineage', async () => {
    await expect(
      driver.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [RECORD]),
    ).rejects.toThrow(/requires exactly one terminal mechanism/i);
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
      `INSERT INTO facts (entity_id, property, normalized_value, value_type, output_kind, valid_from,
                          status, confidence, recorded_at)
       VALUES ($1, 'fk_probe_property', '14.5'::jsonb, 'number', 'NORMALIZED_FACT',
               $2, 'ACTIVE', 0.9, $2)
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
describe('API tenancy invariants (0011)', () => {
  /**
   * Every assertion here runs against the real migration in a real database.
   *
   * The unit tests in `packages/api-keys` mirror two of these rules in
   * TypeScript, which review correctly pointed out proves nothing about the
   * schema: a regex copied into a test passes whether or not the CHECK it
   * quotes still exists. These do not mirror. They insert and expect a refusal.
   */
  const TENANT_A = '77777777-7777-4777-8777-777777777777';
  const TENANT_B = '88888888-8888-4888-8888-888888888888';
  const KEY_A = '99999999-9999-4999-8999-999999999999';
  const HASH_A = 'b'.repeat(64);

  async function seedTenancy(): Promise<void> {
    await driver.query(
      `INSERT INTO api_tenants (id, slug, name) VALUES ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B],
    );
    await driver.query(
      `INSERT INTO api_keys
         (id, tenant_id, vertical_id, token_hash, token_prefix, label,
          access_tier, billing_source)
       VALUES ($1, $2, $3, $4, 'df_live_aaaaaaaa', 'primary',
               'API_PAID', 'DIRECT') ON CONFLICT DO NOTHING`,
      [KEY_A, TENANT_A, VERTICAL, HASH_A],
    );
  }

  const usage = (tenant: string, key: string, routeKey = 'entities.detail', method = 'GET') =>
    driver.query(
      `INSERT INTO api_usage_events
         (tenant_id, api_key_id, vertical_id, route_key, method, status,
          access_tier, billing_source)
       VALUES ($1, $2, $3, $4, $5, 200, 'API_PAID', 'DIRECT')`,
      [tenant, key, VERTICAL, routeKey, method],
    );

  beforeAll(seedTenancy);

  /**
   * The one that matters most, and the one that was possible until review.
   *
   * Both foreign keys resolve independently: tenant B exists, key A exists. Only
   * the composite reference compares them. Without it this insert succeeds and
   * tenant B is invoiced for tenant A's traffic.
   */
  it('refuses a usage row that charges a tenant for another tenant\'s key', async () => {
    await expect(usage(TENANT_B, KEY_A)).rejects.toThrow();
  });

  it('accepts the same row when the tenant does own the key', async () => {
    await expect(usage(TENANT_A, KEY_A)).resolves.toBeDefined();
  });

  it('refuses a raw key stored where a hash belongs', async () => {
    await expect(
      driver.query(
        `INSERT INTO api_keys
           (tenant_id, vertical_id, token_hash, token_prefix, label,
            access_tier, billing_source)
         VALUES ($1, $2, 'df_live_Ej8xQ2vN4kLpR7sT1uY6wA9bC3dE5fG8hJ0kL2mN4pQ',
                 'df_live_Ej8xQ2vN', 'raw', 'API_PAID', 'DIRECT')`,
        [TENANT_A, VERTICAL],
      ),
    ).rejects.toThrow();
  });

  it('refuses two keys with the same hash, so a lookup cannot be ambiguous', async () => {
    await expect(
      driver.query(
        `INSERT INTO api_keys
           (tenant_id, vertical_id, token_hash, token_prefix, label,
            access_tier, billing_source)
         VALUES ($1, $2, $3, 'df_live_bbbbbbbb', 'duplicate',
                 'API_PAID', 'DIRECT')`,
        [TENANT_B, VERTICAL, HASH_A],
      ),
    ).rejects.toThrow();
  });

  it('refuses to delete a key whose usage rows would go with it (rule 10, applied to invoices)', async () => {
    await expect(driver.query(`DELETE FROM api_keys WHERE id = $1`, [KEY_A])).rejects.toThrow();
  });

  it('refuses to delete a tenant that still has keys', async () => {
    await expect(driver.query(`DELETE FROM api_tenants WHERE id = $1`, [TENANT_A])).rejects.toThrow();
  });

  // The two route-shape guards 0011 carried are gone, along with the free-text
  // column they guarded. Their replacement is the closed vocabulary asserted in
  // the 0012 block below, which does not have to predict the shape of a leak.

  it('refuses a method this read-only API does not serve', async () => {
    await expect(usage(TENANT_A, KEY_A, 'search', 'POST')).rejects.toThrow();
  });

  it('refuses a status code outside the HTTP range', async () => {
    await expect(
      driver.query(
        `INSERT INTO api_usage_events
           (tenant_id, api_key_id, vertical_id, route_key, method, status,
            access_tier, billing_source)
         VALUES ($1, $2, $3, 'search', 'GET', 999, 'API_PAID', 'DIRECT')`,
        [TENANT_A, KEY_A, VERTICAL],
      ),
    ).rejects.toThrow();
  });
});

describe('migration 0009 over pre-existing judgment history', () => {
  let legacy: MigrationDriver;

  const PAIR = { record: RECORD, entity: ENTITY };

  beforeAll(async () => {
    legacy = await createPGliteDriver();
    // Everything the judgment table needs, and nothing that knows about episodes.
    const before0009 = migrations.filter((migration) => migration.version < '0009');
    await applyMigrations(legacy, before0009);
    await seed(legacy, false, false);

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

/**
 * Corrections to 0011, reproduced before they were made.
 *
 * 0011 reached `main` with four structural defects that review named and did not
 * fix. Every test below failed against it — and the first draft of this block
 * failed for the WRONG REASON, which is worse than not testing at all: an insert
 * naming a column that does not exist throws `42703`, so a bare
 * `rejects.toThrow()` went green against a schema with no control in it
 * whatsoever. Six of these were vacuous before the codes were pinned.
 *
 * So each refusal names the SQLSTATE it expects. `23503` is a foreign key
 * refusing an unregistered value; `23502` is NOT NULL. Neither is `42703`, and
 * that difference is the entire point.
 */
describe('API usage accounting corrections (0012)', () => {
  const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const OTHER_VERTICAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const OTHER_KEY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  /** SQLSTATE classes worth telling apart. */
  const FOREIGN_KEY_VIOLATION = '23503';
  const NOT_NULL_VIOLATION = '23502';
  /**
   * ON DELETE RESTRICT, which the two engines label differently.
   *
   * Measured, not assumed: real PostgreSQL 16.13 raises `23503`
   * (foreign_key_violation) and words it "violates foreign key constraint".
   * PGlite 0.5.5 raises `23001` (restrict_violation) and words it "violates
   * RESTRICT setting of foreign key constraint" — the PostgreSQL 18 behaviour,
   * because PGlite 0.5.x is built on a newer Postgres than the one CI deploys
   * against.
   *
   * The first draft of this pinned `23001` alone. That is the code PGlite
   * emits, and the suite only ever runs these against PGlite — so the
   * assertion was green while being wrong for the database this schema is
   * actually for. Review caught it.
   *
   * Both codes mean the same refusal, so both are accepted, and the pair is
   * named here so the divergence is a recorded fact rather than a loose matcher.
   */
  const RESTRICT_VIOLATION = ['23503', '23001'];

  /** A CHECK constraint refusing a value. */
  const CHECK_VIOLATION = '23514';

  /**
   * Assert a statement is refused, and refused for the stated reason.
   *
   * The reason is the assertion. A missing column, a typo in a table name and a
   * genuine constraint violation are all "it threw", and only one of them is
   * evidence that a control exists.
   */
  async function refusedWith(
    promise: Promise<unknown>,
    sqlState: string | readonly string[],
  ): Promise<void> {
    const accepted = typeof sqlState === 'string' ? [sqlState] : [...sqlState];
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    if (error === null) {
      throw new Error(`expected SQLSTATE ${accepted.join(' or ')}, but the statement succeeded`);
    }
    const code = (error as { code?: unknown }).code;
    expect(
      accepted,
      `${String((error as Error).message)} (SQLSTATE ${String(code)})`,
    ).toContain(code);
  }

  async function seedAccounting(): Promise<void> {
    await driver.query(
      `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
       VALUES ($1, 'solar', 'Solar', '1.0.0', 'ACTIVE', $2::jsonb) ON CONFLICT DO NOTHING`,
      [
        OTHER_VERTICAL,
        JSON.stringify({ cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 }),
      ],
    );
    await driver.query(
      `INSERT INTO api_tenants (id, slug, name) VALUES ($1, 'tenant-metered', 'Metered')
       ON CONFLICT DO NOTHING`,
      [TENANT],
    );
    // One tenant, two keys, one per vertical: the shape a customer buying two
    // industries actually has, and the shape the attribution tests need.
    await driver.query(
      `INSERT INTO api_keys
         (id, tenant_id, vertical_id, token_hash, token_prefix, label,
          access_tier, billing_source)
       VALUES ($1, $2, $3, $4, 'df_live_aaaabbbb', 'hvac', 'API_PAID', 'DIRECT'),
              ($5, $2, $6, $7, 'df_live_ccccdddd', 'solar', 'API_PAID', 'DIRECT')
       ON CONFLICT DO NOTHING`,
      [KEY, TENANT, VERTICAL, 'c'.repeat(64), OTHER_KEY, OTHER_VERTICAL, 'd'.repeat(64)],
    );
  }

  beforeAll(seedAccounting);

  const meter = (routeKey: string, vertical: string = VERTICAL, key: string = KEY) =>
    driver.query(
      `INSERT INTO api_usage_events
         (tenant_id, api_key_id, vertical_id, route_key, method, status,
          access_tier, billing_source)
       VALUES ($1, $2, $3, $4, 'GET', 200, 'API_PAID', 'DIRECT')`,
      [TENANT, key, vertical, routeKey],
    );

  /**
   * ROUTE_PRIVACY_CONTROL.
   *
   * 0011 held a free-text `route` guarded by two regexes — no query string, no
   * UUID — and called the result a template. Both are guesses about what a leak
   * looks like, and its own comment admitted no CHECK can tell a literal path
   * segment from a parameter. A closed vocabulary is not a guess: a value that
   * is not a registered route key has nowhere to be stored.
   */
  describe('the route a usage row records comes from a closed vocabulary', () => {
    it('accepts a key the application actually declares', async () => {
      await expect(meter('entities.detail')).resolves.toBeDefined();
    });

    it('refuses the URL template the old column was designed to hold', async () => {
      await refusedWith(meter('/v1/entities/{id}'), FOREIGN_KEY_VIOLATION);
    });

    it('refuses an identifier neither 0011 guard could see', async () => {
      // No query string and no UUID, so both of 0011's CHECKs pass it — and it
      // names precisely which company a paying customer looked up. This is the
      // leak those regexes were meant to stop and structurally could not.
      await refusedWith(meter('/v1/entities/by-slug/acme-climate'), FOREIGN_KEY_VIOLATION);
    });

    it('refuses a key that is plausible but not registered', async () => {
      // "Looks like one of ours" is not membership. A metering writer allowed to
      // invent keys has re-opened the free-text column this replaced.
      await refusedWith(meter('entities.deleted'), FOREIGN_KEY_VIOLATION);
    });

    it('refuses to drop a route key that usage rows still reference', async () => {
      await refusedWith(
        driver.query(`DELETE FROM api_route_keys WHERE key = 'entities.detail'`),
        RESTRICT_VIOLATION,
      );
    });
  });

  /**
   * VERTICAL_ATTRIBUTION.
   *
   * The product duplicates across industries by configuration rather than by
   * forking (AGENTS.md rule 4). Usage that cannot be split by vertical cannot
   * answer the one question that decides whether a second vertical paid for
   * itself.
   */
  describe('every usage row names the vertical it was served from', () => {
    it('refuses a usage row with no vertical at all', async () => {
      await refusedWith(
        driver.query(
          `INSERT INTO api_usage_events
             (tenant_id, api_key_id, route_key, method, status,
              access_tier, billing_source)
           VALUES ($1, $2, 'search', 'GET', 200, 'API_PAID', 'DIRECT')`,
          [TENANT, KEY],
        ),
        NOT_NULL_VIOLATION,
      );
    });

    it('refuses a vertical the key that made the request cannot read', async () => {
      // The twin of the cross-tenant defect review found in 0011: both foreign
      // keys resolve on their own, and only comparing them catches a row that
      // bills Solar for HVAC traffic.
      await refusedWith(meter('search', OTHER_VERTICAL), FOREIGN_KEY_VIOLATION);
    });

    it('separates two verticals in the aggregate an invoice is built from', async () => {
      await meter('search', VERTICAL, KEY);
      await meter('search', OTHER_VERTICAL, OTHER_KEY);
      const rows = await driver.query<{ vertical_id: string; n: string }>(
        `SELECT vertical_id, count(*) AS n FROM api_usage_events
          WHERE tenant_id = $1 AND route_key = 'search'
          GROUP BY vertical_id ORDER BY vertical_id`,
        [TENANT],
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => Number(row.n))).toEqual([1, 1]);
    });
  });

  /**
   * RATE_LIMIT_PLATFORM_MISMATCH.
   *
   * A per-minute limit in a row is a number nothing can enforce. The database is
   * not on the request path, and an edge that consulted it per request would
   * become the bottleneck the limit exists to prevent. Storing it invites a
   * reader to believe a limit is in force when nothing applies it.
   */
  it('carries no rate limit, which the database is in no position to enforce', async () => {
    const columns = await driver.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_keys'`,
    );
    expect(columns.map((column) => column.column_name)).not.toContain('rate_limit_per_minute');
  });

  /**
   * The scope on a key is now total rather than optional.
   *
   * NULL meant "every vertical", and a NULL satisfies a composite foreign key
   * vacuously — so the attribution constraint above would have been
   * unenforceable for exactly the keys with the widest reach.
   *
   * ## This test is also the guard on a product decision
   *
   * NOT NULL here encodes **one key per vertical**, and that is deliberate
   * rather than incidental. It matches the deployment model: `apps/edge/src/env.ts`
   * refuses to start without a `VERTICAL_SLUG` because "a deployment serves
   * exactly one vertical", so a key presented to a Worker can only ever exercise
   * one vertical anyway. A customer buying two industries holds two keys.
   *
   * The decision it forecloses is multi-vertical customer keys — and the way
   * that would be reintroduced is by quietly making this column nullable again,
   * which would silently re-open the vacuous-composite-FK hole above. If
   * multi-vertical access is ever required, the answer is a grant or junction
   * table (`api_key_verticals`), decided by the owner and migrated explicitly.
   * It is not a nullable column.
   *
   * So when this test fails, read it as "somebody is changing the entitlement
   * model", not as "a constraint got in the way".
   */
  it('refuses a key that names no vertical', async () => {
    await refusedWith(
      driver.query(
        `INSERT INTO api_keys
           (tenant_id, token_hash, token_prefix, label, access_tier, billing_source)
         VALUES ($1, $2, 'df_live_eeeeffff', 'unscoped', 'API_PAID', 'DIRECT')`,
        [TENANT, 'e'.repeat(64)],
      ),
      NOT_NULL_VIOLATION,
    );
  });
});

/**
 * The ownership partition, asserted in both directions.
 *
 * `creates every expected table` asserts only that everything named is present.
 * Nothing asserted the converse — that every table the migrations create is
 * named — so a migration adding a table and forgetting the manifest would have
 * its tables silently classified as a stranger's by the one function whose whole
 * job is telling ours from a stranger's. 0011 happened to update the manifest.
 * Nothing made it.
 */
describe('the table manifest and the migrations agree', () => {
  it('claims every table its own migrations create', async () => {
    const partition = partitionOwnedTables(await listPublicTables(driver));
    expect(partition.unowned).toEqual([]);
  });

  it('names no table the migrations do not create', async () => {
    const partition = partitionOwnedTables(await listPublicTables(driver));
    expect(partition.missing).toEqual([]);
  });
});

/**
 * The widened source_type vocabulary (0013).
 *
 * Asserted against the database rather than against the TypeScript enum,
 * because the two are separate declarations of the same list and only one of
 * them is what a row actually has to satisfy. A test that read `SOURCE_TYPES`
 * would pass whether or not 0013 ever ran.
 */
describe('a regulator-hosted filing is a source type of its own (0013)', () => {
  const insertSource = (type: string) =>
    driver.query(
      `INSERT INTO sources (vertical_id, publisher, domain, source_type, authority_rank,
                            attribution_requirement, robots_policy, refresh_cadence, status)
       VALUES ($1, 'probe', $2, $3, 50, $4::jsonb, $5::jsonb, 'WEEKLY', 'UNDER_REVIEW')`,
      [VERTICAL, `${type.toLowerCase()}.example.com`, type, ATTRIBUTION, ROBOTS],
    );

  it('accepts REGULATORY_FILING', async () => {
    await expect(insertSource('REGULATORY_FILING')).resolves.toBeDefined();
  });

  /**
   * The negative control. Without it, a migration that dropped the CHECK
   * entirely — rather than widening it — would pass the assertion above, and the
   * column would silently accept anything at all.
   *
   * Pinned to `23514` (check_violation) rather than left as a bare
   * `rejects.toThrow()`, for the reason the 0012 block exists: a rejection for
   * an unrelated reason — a missing table, a typo in a column name — is also
   * "it threw", and only one of those is evidence that the constraint is there.
   * Measured on real PostgreSQL 16.13.
   */
  it('still refuses a type that is not in the vocabulary', async () => {
    for (const bogus of ['GOVERNMENT', 'TOTALLY_MADE_UP']) {
      const error = await insertSource(bogus).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error, `${bogus} was accepted`).not.toBeNull();
      expect(
        (error as { code?: unknown }).code,
        `${bogus}: ${String((error as Error).message)}`,
      ).toBe('23514');
    }
  });

  it('keeps accepting the types that were already valid', async () => {
    await expect(insertSource('CERTIFICATION_BODY')).resolves.toBeDefined();
    await expect(insertSource('MANUFACTURER')).resolves.toBeDefined();
  });

  /**
   * The distinction the whole change exists for.
   *
   * `REGULATORY_FILING` must not be storable as, comparable to, or silently
   * folded into `CERTIFICATION_BODY`. A government host is not a claim: DOE says
   * of its own database that appearing in it "is not an indication that DOE has
   * determined that the model is compliant".
   */
  it('does not collapse a filing into a certification', async () => {
    const rows = await driver.query<{ source_type: string; n: string }>(
      `SELECT source_type, count(*) AS n FROM sources
        WHERE source_type IN ('REGULATORY_FILING', 'CERTIFICATION_BODY')
        GROUP BY source_type ORDER BY source_type`,
    );
    expect(rows.map((row) => row.source_type)).toEqual([
      'CERTIFICATION_BODY',
      'REGULATORY_FILING',
    ]);
  });
});
