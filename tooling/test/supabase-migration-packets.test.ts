import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  LEDGER_MARKER,
  createPGliteDriver,
  loadMigrations,
  scopeMigrationSql,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';
import {
  buildSupabaseMigrationPlan,
  RELEVANT_SOURCE_PATHS,
  renderSupabaseMigrationManifest,
  verifyGitSourceIdentity,
} from '../scripts/export-supabase-migration-packets.js';

const RELEASE_SHA = '290df1342094433e92978ec97eb37cc02fc4eb50';
const FIRST_PRIVATE_CHECKSUM = '4fd11a2dc41ab740ba92b3a4758c908b1a9bfbf5787485429b3e78b15027357a';
const execFileAsync = promisify(execFile);
const VERIFIED_SOURCE_IDENTITY = {
  releaseSha: RELEASE_SHA,
  headSha: RELEASE_SHA,
  relevantInputsClean: true,
  relevantPaths: RELEVANT_SOURCE_PATHS,
} as const;

let migrations: Migration[];

beforeAll(async () => {
  migrations = await loadMigrations();
});

function build(
  overrides: Partial<Parameters<typeof buildSupabaseMigrationPlan>[0]> = {},
) {
  return buildSupabaseMigrationPlan({
    sourceIdentity: VERIFIED_SOURCE_IDENTITY,
    schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
    migrationRole: 'df_migration',
    migrations,
    appliedMigrations: [],
    ...overrides,
  });
}

describe('Supabase connector migration packet export', () => {
  it('binds export identity to Git HEAD and only the defined clean source inputs', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'data-foundry-export-source-'));
    try {
      for (const relativePath of RELEVANT_SOURCE_PATHS) {
        const target = join(repository, relativePath);
        if (relativePath === 'db/migrations') {
          await mkdir(target, { recursive: true });
          await writeFile(join(target, '0001_fixture.sql'), 'SELECT 1;\n');
        } else {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, `// ${relativePath}\n`);
        }
      }
      await execFileAsync('git', ['init'], { cwd: repository });
      await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
        cwd: repository,
      });
      await execFileAsync('git', ['config', 'user.name', 'Data Foundry Test'], {
        cwd: repository,
      });
      await execFileAsync('git', ['add', '.'], { cwd: repository });
      await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repository });
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repository });
      const headSha = stdout.trim();

      await writeFile(join(repository, 'unrelated-untracked.txt'), 'ignored by source binding\n');
      await expect(verifyGitSourceIdentity(headSha, repository)).resolves.toMatchObject({
        releaseSha: headSha,
        headSha,
        relevantInputsClean: true,
        relevantPaths: RELEVANT_SOURCE_PATHS,
      });
      await expect(verifyGitSourceIdentity('0'.repeat(40), repository)).rejects.toThrow(
        /supplied release SHA.*Git HEAD/i,
      );

      await writeFile(
        join(repository, 'db/migrations/0001_fixture.sql'),
        'SELECT 2;\n',
      );
      await expect(verifyGitSourceIdentity(headSha, repository)).rejects.toThrow(
        /relevant source inputs differ from Git HEAD[\s\S]*db\/migrations\/0001_fixture\.sql/i,
      );
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('requires the pure planner to receive a matching verified source identity', () => {
    expect(() =>
      buildSupabaseMigrationPlan({
        sourceIdentity: {
          releaseSha: RELEASE_SHA,
          headSha: '0'.repeat(40),
          relevantInputsClean: true,
          relevantPaths: RELEVANT_SOURCE_PATHS,
        },
        schema: DATA_FOUNDRY_PRIVATE_SCHEMA,
        migrationRole: 'df_migration',
        migrations,
        appliedMigrations: [],
      } as Parameters<typeof buildSupabaseMigrationPlan>[0]),
    ).toThrow(/verified source identity.*release SHA.*HEAD/i);
  });

  it('requires the independently pinned contiguous 0001 through 0026 repository chain', () => {
    expect(() =>
      build({ migrations: migrations.filter(({ version }) => version !== '0002') }),
    ).toThrow(/expected 26 contiguous migrations.*missing.*0002/i);
  });
  it('uses the private-schema transform checksum as the application ledger authority', () => {
    const plan = build();

    expect(plan.format).toBe('data-foundry-supabase-migration-plan/v1');
    expect(plan.releaseSha).toBe(RELEASE_SHA);
    expect(plan.schema).toBe(DATA_FOUNDRY_PRIVATE_SCHEMA);
    expect(plan.migrationRole).toBe('df_migration');
    expect(plan.repositoryMigrationCount).toBe(26);
    expect(plan.pendingMigrationCount).toBe(26);
    expect(plan.packets[0]).toMatchObject({
      version: '0001',
      filename: '0001_verticals_and_sources.sql',
      checksum: FIRST_PRIVATE_CHECKSUM,
      providerMigrationName: `data_foundry_0001_${FIRST_PRIVATE_CHECKSUM.slice(0, 12)}`,
    });
  });

  it('emits one transaction-scoped packet per pending app migration and preserves exact transformed SQL', () => {
    const plan = build({
      appliedMigrations: [
        {
          version: '0001',
          filename: '0001_verticals_and_sources.sql',
          checksum: FIRST_PRIVATE_CHECKSUM,
        },
      ],
    });
    const migration = migrations.find(({ version }) => version === '0022');
    const packet = plan.packets.find(({ version }) => version === '0022');

    expect(migration).toBeDefined();
    expect(packet).toBeDefined();
    expect(plan.pendingMigrationCount).toBe(25);
    expect(plan.packets[0]?.version).toBe('0002');
    expect(packet?.transformedSql).toBe(
      scopeMigrationSql(migration!.sql, DATA_FOUNDRY_PRIVATE_SCHEMA),
    );
    expect(packet?.transformedSql).toContain("'data_foundry.source_records'::regclass");
    expect(packet?.transformedSql).not.toMatch(/\bpublic\./i);
    expect(packet?.sql).toContain('SET LOCAL ROLE "df_migration";');
    expect(packet?.sql).toContain(
      'SET LOCAL search_path TO "data_foundry", pg_catalog, extensions;',
    );
    expect(packet?.sql).toContain(
      'LOCK TABLE "data_foundry"."schema_migrations" IN EXCLUSIVE MODE;',
    );
    expect(packet?.expectedAppliedCount).toBe(21);
    expect(packet?.sql).toContain("('0001', '0001_verticals_and_sources.sql'");
    expect(packet?.sql).toContain("('0021', '0021_source_record_evidence_reconciliation.sql'");
    expect(packet?.sql).toContain(packet!.transformedSql);
    expect(packet?.sql).toContain(
      'INSERT INTO "data_foundry"."schema_migrations" (version, filename, checksum, execution_ms)',
    );
    expect(packet?.sql).toContain(packet!.checksum);
    expect(packet?.sql).toMatch(/RESET search_path;\s*RESET ROLE;\s*$/);
    expect(packet?.sql).not.toMatch(/^\s*BEGIN\b/i);
    expect(packet?.sql).not.toMatch(/\bCOMMIT\s*;\s*$/i);
  });

  it('provides read-only preflight, safe marked-ledger bootstrap, and exact verification SQL', () => {
    const plan = build();

    expect(plan.preflightSql).toContain("nspname = 'extensions'");
    expect(plan.preflightSql).toContain("rolname = 'df_migration'");
    expect(plan.preflightSql).toContain(
      "pg_has_role(current_user, 'df_migration', 'MEMBER')",
    );
    expect(plan.preflightSql).toContain("nspname = 'data_foundry'");
    expect(plan.preflightSql).toContain('target_schema_owner');
    expect(plan.preflightSql).toContain('target_ledger_columns');
    expect(plan.preflightSql).toContain("nspname = 'public'");
    expect(plan.preflightSql).toContain(LEDGER_MARKER);
    expect(plan.preflightSql).not.toMatch(/\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/i);

    expect(plan.bootstrapSql).toContain('SET LOCAL ROLE "df_migration";');
    expect(plan.bootstrapSql).toContain('SELECT pg_advisory_xact_lock(');
    expect(plan.bootstrapSql).toContain('CREATE SCHEMA IF NOT EXISTS "data_foundry" AUTHORIZATION "df_migration";');
    expect(plan.bootstrapSql).toContain(
      'CREATE TABLE "data_foundry"."schema_migrations"',
    );
    expect(plan.bootstrapSql).not.toContain('CREATE TABLE IF NOT EXISTS');
    expect(plan.bootstrapSql).toContain(
      `COMMENT ON TABLE "data_foundry"."schema_migrations" IS '${LEDGER_MARKER}';`,
    );
    const createOnlyWhenAbsent = plan.bootstrapSql.indexOf(
      "IF to_regclass('data_foundry.schema_migrations') IS NULL THEN",
    );
    const createLedger = plan.bootstrapSql.indexOf(
      'CREATE TABLE "data_foundry"."schema_migrations"',
    );
    const markLedger = plan.bootstrapSql.indexOf(
      `COMMENT ON TABLE "data_foundry"."schema_migrations" IS '${LEDGER_MARKER}';`,
    );
    expect(createOnlyWhenAbsent).toBeGreaterThan(-1);
    expect(createLedger).toBeGreaterThan(createOnlyWhenAbsent);
    expect(markLedger).toBeGreaterThan(createLedger);
    expect(plan.bootstrapSql).toMatch(/RESET search_path;\s*RESET ROLE;\s*$/);

    expect(plan.verificationSql).toContain("('0001', '0001_verticals_and_sources.sql'");
    expect(plan.verificationSql).toContain("('0026', '0026_surface_authorization_streaming_indexes.sql'");
    expect(plan.verificationSql).toContain(LEDGER_MARKER);
    expect(plan.verificationSql).toContain('canonical_columns_match');
    expect(plan.verificationSql).toContain('primary_key_on_version');
    expect(plan.verificationSql).toContain('row_count_matches');
    expect(plan.verificationSql).toContain('duplicate_ordinal');
    expect(plan.verificationSql).toContain('unexpected_or_mismatched');
    expect(plan.verificationSql).toContain('missing');
  });

  it('is byte-for-byte deterministic and never serializes credentials', () => {
    const first = renderSupabaseMigrationManifest(build());
    const second = renderSupabaseMigrationManifest(build());

    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(first).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(first).not.toMatch(/POSTGRES_URL\s*=|"password"\s*:|"secret"\s*:/i);
  });

  it('fails closed on wrong targets, unsafe identifiers, invalid release identity, and ledger drift', () => {
    expect(() => build({ schema: 'public' })).toThrow(/only targets.*data_foundry/i);
    expect(() => build({ migrationRole: 'df_migration; RESET ROLE' })).toThrow(
      /migration role.*identifier/i,
    );
    expect(() =>
      build({
        sourceIdentity: {
          ...VERIFIED_SOURCE_IDENTITY,
          releaseSha: 'moving-main',
        },
      }),
    ).toThrow(/40-character.*Git SHA/i);
    expect(() =>
      build({
        appliedMigrations: [
          {
            version: '0001',
            filename: '0001_verticals_and_sources.sql',
            checksum: '0'.repeat(64),
          },
        ],
      }),
    ).toThrow(/checksum mismatch/i);
    expect(() =>
      build({
        appliedMigrations: [
          {
            version: '9999',
            filename: '9999_unknown.sql',
            checksum: '0'.repeat(64),
          },
        ],
      }),
    ).toThrow(/not present in the repository/i);
    expect(() =>
      build({
        appliedMigrations: [
          {
            version: '0001',
            filename: '0001_verticals_and_sources.sql',
            checksum: FIRST_PRIVATE_CHECKSUM,
          },
          {
            version: '0001',
            filename: '0001_verticals_and_sources.sql',
            checksum: FIRST_PRIVATE_CHECKSUM,
          },
        ],
      }),
    ).toThrow(/duplicate application-ledger version/i);
    expect(() =>
      build({
        appliedMigrations: [
          {
            version: '0002',
            filename: '0002_evidence.sql',
            checksum: '742403ea54e0ad8cf385cb41ca9d438437a734988950538993298c0561a8705c',
          },
        ],
      }),
    ).toThrow(/not a contiguous repository prefix/i);
  });

  it('locks and rejects any live ledger that is not the packet exact expected prefix before DDL', async () => {
    let database: MigrationDriver | undefined;
    try {
      database = await createPGliteDriver();
      await database.exec(`
        CREATE ROLE df_migration NOLOGIN;
        GRANT df_migration TO postgres;
        GRANT USAGE ON SCHEMA extensions TO df_migration;
      `);
      const plan = build();
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);
      await database.query(
        `INSERT INTO data_foundry.schema_migrations (version, filename, checksum, execution_ms)
         VALUES ($1, $2, $3, 0)`,
        ['9999', '9999_foreign.sql', 'f'.repeat(64)],
      );

      await expect(
        database.exec(`BEGIN;\n${plan.packets[0]!.sql}\nCOMMIT;`),
      ).rejects.toThrow(/entire application ledger.*expected prefix/i);
      await database.exec('ROLLBACK').catch(() => undefined);

      const privateTables = await database.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'data_foundry' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      );
      const ledgerRows = await database.query<{ version: string }>(
        'SELECT version FROM data_foundry.schema_migrations ORDER BY version',
      );
      expect(privateTables).toEqual([{ table_name: 'schema_migrations' }]);
      expect(ledgerRows).toEqual([{ version: '9999' }]);
    } finally {
      await database?.close();
    }
  }, 120_000);

  it('rejects duplicate identical prefix rows when the marked ledger has lost its primary key', async () => {
    let database: MigrationDriver | undefined;
    try {
      database = await createPGliteDriver();
      await database.exec(`
        CREATE ROLE df_migration NOLOGIN;
        GRANT df_migration TO postgres;
        GRANT USAGE ON SCHEMA extensions TO df_migration;
      `);
      const plan = build();
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);
      await database.exec(`BEGIN;\n${plan.packets[0]!.sql}\nCOMMIT;`);
      await database.exec(`
        ALTER TABLE data_foundry.schema_migrations
          DROP CONSTRAINT schema_migrations_pkey;
        INSERT INTO data_foundry.schema_migrations
          (version, filename, checksum, applied_at, execution_ms)
        SELECT version, filename, checksum, applied_at, execution_ms
          FROM data_foundry.schema_migrations
         WHERE version = '0001';
      `);

      await expect(
        database.exec(`BEGIN;\n${plan.packets[1]!.sql}\nCOMMIT;`),
      ).rejects.toThrow(/ledger.*primary key.*version|canonical ledger schema/i);
      await database.exec('ROLLBACK').catch(() => undefined);

      const [state] = await database.query<{
        evidence_table: string | null;
        ledger_count: number;
        marker: string | null;
      }>(`SELECT to_regclass('data_foundry.source_artifacts')::text AS evidence_table,
                (SELECT count(*)::int FROM data_foundry.schema_migrations) AS ledger_count,
                obj_description('data_foundry.schema_migrations'::regclass, 'pg_class') AS marker`);
      expect(state).toEqual({
        evidence_table: null,
        ledger_count: 2,
        marker: LEDGER_MARKER,
      });
    } finally {
      await database?.close();
    }
  }, 120_000);

  it('rolls back both migration DDL and its app-ledger insert when a packet transaction fails', async () => {
    let database: MigrationDriver | undefined;
    try {
      database = await createPGliteDriver();
      await database.exec(`
        CREATE ROLE df_migration NOLOGIN;
        GRANT df_migration TO postgres;
        GRANT USAGE ON SCHEMA extensions TO df_migration;
      `);
      const plan = build();
      expect(plan.transactionContract).toEqual({
        packetTransaction: 'provider-managed-required',
        providerMigrationLedgerAtomicity: 'unverified',
        liveUseAuthorized: false,
      });
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);
      const deliberatelyFailingPacket = plan.packets[0]!.sql.replace(
        'RESET search_path;',
        `CREATE TABLE data_foundry.packet_rollback_probe (id integer);\n` +
          `SELECT 1 / 0;\n` +
          `RESET search_path;`,
      );

      await expect(
        database.exec(`BEGIN;\n${deliberatelyFailingPacket}\nCOMMIT;`),
      ).rejects.toThrow(/division by zero/i);
      await database.exec('ROLLBACK').catch(() => undefined);

      const [state] = await database.query<{
        migration_table: string | null;
        probe_table: string | null;
        ledger_count: number;
      }>(`SELECT to_regclass('data_foundry.verticals')::text AS migration_table,
                to_regclass('data_foundry.packet_rollback_probe')::text AS probe_table,
                (SELECT count(*)::int FROM data_foundry.schema_migrations) AS ledger_count`);
      expect(state).toEqual({ migration_table: null, probe_table: null, ledger_count: 0 });
    } finally {
      await database?.close();
    }
  }, 120_000);

  it('executes the bootstrap and each packet atomically against an isolated PostgreSQL database', async () => {
    let database: MigrationDriver | undefined;
    try {
      database = await createPGliteDriver();
      await database.exec(`
        CREATE ROLE df_migration NOLOGIN;
        GRANT df_migration TO postgres;
        GRANT USAGE ON SCHEMA extensions TO df_migration;
      `);

      const plan = build();
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);
      for (const packet of plan.packets) {
        await database.exec(`BEGIN;\n${packet.sql}\nCOMMIT;`);
      }

      const rows = await database.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM data_foundry.schema_migrations ORDER BY version',
      );
      const publicTables = await database.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(rows).toHaveLength(26);
      expect(rows[0]).toEqual({ version: '0001', checksum: FIRST_PRIVATE_CHECKSUM });
      expect(rows.at(-1)?.version).toBe('0026');
      expect(publicTables).toEqual([]);
    } finally {
      await database?.close();
    }
  }, 120_000);
});
