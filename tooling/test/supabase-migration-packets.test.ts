import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  buildSupabaseMigrationPlanFromGit,
  buildSupabaseMigrationPlan,
  parseSupabaseMigrationCliArguments,
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

async function provisionSafeMigrationRole(database: MigrationDriver): Promise<void> {
  await database.exec(`
    CREATE ROLE df_migration LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT df_migration TO postgres;
    ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    GRANT USAGE ON SCHEMA extensions TO df_migration;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    DO $migration_role_connect$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO df_migration', current_database());
    END
    $migration_role_connect$;
    DO $migration_role_setting$
    BEGIN
      EXECUTE format('ALTER ROLE df_migration IN DATABASE %I SET search_path TO data_foundry, pg_catalog, extensions', current_database());
    END
    $migration_role_setting$;
  `);
}

async function createGitSourceFixture(repository: string, migrationCount = 1): Promise<string> {
  await mkdir(join(repository, 'db/migrations'), { recursive: true });
  for (let ordinal = 1; ordinal <= migrationCount; ordinal += 1) {
    const version = String(ordinal).padStart(4, '0');
    await writeFile(
      join(repository, `db/migrations/${version}_fixture.sql`),
      `SELECT 'committed-${version}';\n`,
    );
  }
  await writeFile(join(repository, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(repository, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  await writeFile(join(repository, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  await writeFile(join(repository, 'tsconfig.json'), '{"compilerOptions":{}}\n');
  await execFileAsync('git', ['init'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repository });
  await execFileAsync('git', ['config', 'user.name', 'Data Foundry Test'], { cwd: repository });
  await execFileAsync('git', ['add', '.'], { cwd: repository });
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repository });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repository });
  return stdout.trim();
}

describe('Supabase connector migration packet export', () => {
  it('accepts only the leading separator forwarded by the documented pnpm command', () => {
    expect(parseSupabaseMigrationCliArguments(['--', '--release-sha', RELEASE_SHA])).toEqual({
      releaseSha: RELEASE_SHA,
      appliedLedgerPath: undefined,
    });
    expect(() =>
      parseSupabaseMigrationCliArguments(['--release-sha', RELEASE_SHA, '--']),
    ).toThrow(
      /Unknown or incomplete argument: --/,
    );
  });

  it('binds export identity to Git HEAD and the entire non-ignored clean worktree', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'data-foundry-export-source-'));
    try {
      const headSha = await createGitSourceFixture(repository);
      expect(RELEVANT_SOURCE_PATHS).toEqual(['.']);

      await expect(verifyGitSourceIdentity(headSha, repository)).resolves.toMatchObject({
        releaseSha: headSha,
        headSha,
        relevantInputsClean: true,
        relevantPaths: RELEVANT_SOURCE_PATHS,
      });
      await expect(verifyGitSourceIdentity('0'.repeat(40), repository)).rejects.toThrow(
        /supplied release SHA.*Git HEAD/i,
      );

      for (const [relativePath, dirtyBytes, cleanBytes] of [
        ['package.json', '{"type":"commonjs"}\n', '{"type":"module"}\n'],
        ['tsconfig.json', '{"compilerOptions":{"module":"commonjs"}}\n', '{"compilerOptions":{}}\n'],
      ] as const) {
        await writeFile(join(repository, relativePath), dirtyBytes);
        await expect(verifyGitSourceIdentity(headSha, repository)).rejects.toThrow(
          new RegExp(`relevant source inputs differ from Git HEAD[\\s\\S]*${relativePath.replace('.', '\\.')}`, 'i'),
        );
        await writeFile(join(repository, relativePath), cleanBytes);
      }

      await writeFile(join(repository, 'unrelated-untracked.txt'), 'must invalidate exact-SHA export\n');
      await expect(verifyGitSourceIdentity(headSha, repository)).rejects.toThrow(
        /relevant source inputs differ from Git HEAD[\s\S]*unrelated-untracked\.txt/i,
      );
      await rm(join(repository, 'unrelated-untracked.txt'));

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

  it('requires the independently pinned contiguous 0001 through 0028 repository chain', () => {
    expect(() =>
      build({ migrations: migrations.filter(({ version }) => version !== '0002') }),
    ).toThrow(/expected 28 contiguous migrations.*missing.*0002/i);
  });
  it('uses the private-schema transform checksum as the application ledger authority', () => {
    const plan = build();

    expect(plan.format).toBe('data-foundry-supabase-migration-plan/v1');
    expect(plan.releaseSha).toBe(RELEASE_SHA);
    expect(plan.schema).toBe(DATA_FOUNDRY_PRIVATE_SCHEMA);
    expect(plan.migrationRole).toBe('df_migration');
    expect(plan.repositoryMigrationCount).toBe(28);
    expect(plan.pendingMigrationCount).toBe(28);
    expect(plan.packets[0]).toMatchObject({
      version: '0001',
      filename: '0001_verticals_and_sources.sql',
      checksum: FIRST_PRIVATE_CHECKSUM,
      providerMigrationName: `data_foundry_0001_${FIRST_PRIVATE_CHECKSUM.slice(0, 12)}`,
    });
  });

  it('exports only 0027 and 0028 for the exact hosted 0001 through 0026 ledger prefix', () => {
    const fullPlan = build();
    const appliedMigrations = fullPlan.packets.slice(0, 26).map(
      ({ version, filename, checksum }) => ({ version, filename, checksum }),
    );

    const upgradePlan = build({ appliedMigrations });

    expect(upgradePlan.appliedMigrationCount).toBe(26);
    expect(upgradePlan.pendingMigrationCount).toBe(2);
    expect(upgradePlan.packets.map(({ version }) => version)).toEqual(['0027', '0028']);
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
    expect(plan.pendingMigrationCount).toBe(27);
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
    expect(plan.bootstrapSql).toContain('unsafe_migration_role_posture');
    expect(plan.bootstrapSql).toContain('unsafe_migration_role_durable_settings');
    expect(plan.bootstrapSql).toContain('unsafe_migration_session');
    expect(plan.bootstrapSql).toContain('unsafe_migration_role_default_object_acl');
    expect(plan.bootstrapSql.indexOf('unsafe_migration_role_posture')).toBeLessThan(
      plan.bootstrapSql.indexOf('SET LOCAL ROLE "df_migration";'),
    );
    expect(plan.bootstrapSql.indexOf('unsafe_migration_session')).toBeLessThan(
      plan.bootstrapSql.indexOf('CREATE SCHEMA IF NOT EXISTS "data_foundry"'),
    );
    expect(plan.bootstrapSql.indexOf('unsafe_migration_role_default_object_acl')).toBeLessThan(
      plan.bootstrapSql.indexOf('CREATE TABLE "data_foundry"."schema_migrations"'),
    );
    expect(plan.bootstrapSql).toContain('SELECT pg_advisory_xact_lock(');
    expect(plan.bootstrapSql).toContain('CREATE SCHEMA IF NOT EXISTS "data_foundry" AUTHORIZATION "df_migration";');
    expect(plan.bootstrapSql).toContain('GRANT USAGE, CREATE ON SCHEMA "data_foundry" TO "df_migration";');
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
    expect(plan.verificationSql).toContain("('0028', '0028_audited_foreign_key_indexes.sql'");
    expect(plan.verificationSql).toContain(LEDGER_MARKER);
    expect(plan.verificationSql).toContain('canonical_columns_match');
    expect(plan.verificationSql).toContain('primary_key_on_version');
    expect(plan.verificationSql).toContain('row_count_matches');
    expect(plan.verificationSql).toContain('duplicate_ordinal');
    expect(plan.verificationSql).toContain('unexpected_or_mismatched');
    expect(plan.verificationSql).toContain('missing');
    expect(plan.verificationSql).toContain('unsafe_migration_role_posture');
    expect(plan.verificationSql).toContain('unsafe_migration_role_durable_settings');
    expect(plan.verificationSql).toContain('unsafe_migration_session');

    const firstPacket = plan.packets[0]!;
    const preRolePosture = firstPacket.sql.indexOf('unsafe_migration_role_posture');
    const preRoleDurableSettings = firstPacket.sql.indexOf('unsafe_migration_role_durable_settings');
    const preSessionSafety = firstPacket.sql.indexOf('unsafe_migration_session');
    const preDefaultAcl = firstPacket.sql.indexOf('unsafe_migration_role_default_object_acl');
    const setRole = firstPacket.sql.indexOf('SET LOCAL ROLE "df_migration";');
    const setSearchPath = firstPacket.sql.indexOf(
      'SET LOCAL search_path TO "data_foundry", pg_catalog, extensions;',
    );
    const exactSearchPathSetting =
      "pg_catalog.current_setting('search_path'::pg_catalog.text) OPERATOR(pg_catalog.=) 'data_foundry, pg_catalog, extensions'::pg_catalog.text";
    const exactSearchPathSchemas =
      "pg_catalog.current_schemas(false) OPERATOR(pg_catalog.=) ARRAY['data_foundry', 'pg_catalog', 'extensions']::pg_catalog.name[]";
    const preDdlSearchPathSafety = firstPacket.sql.indexOf(exactSearchPathSetting);
    const activeRoleSetting =
      "current_user::pg_catalog.text OPERATOR(pg_catalog.=) 'df_migration'::pg_catalog.text";
    const preDdlActiveRole = firstPacket.sql.indexOf(activeRoleSetting);
    const ledgerLock = firstPacket.sql.indexOf(
      'LOCK TABLE "data_foundry"."schema_migrations" IN EXCLUSIVE MODE;',
    );
    const migrationSql = firstPacket.sql.indexOf(firstPacket.transformedSql);
    const postMigrationActiveRole = firstPacket.sql.lastIndexOf(activeRoleSetting);
    const postMigrationSearchPathSafety = firstPacket.sql.lastIndexOf(exactSearchPathSetting);
    const postRoleDurableSettings = firstPacket.sql.lastIndexOf('unsafe_migration_role_durable_settings');
    const postSessionSafety = firstPacket.sql.lastIndexOf('unsafe_migration_session');
    const postDefaultAcl = firstPacket.sql.lastIndexOf('unsafe_migration_role_default_object_acl');
    const ledgerInsert = firstPacket.sql.indexOf(
      'INSERT INTO "data_foundry"."schema_migrations" (version, filename, checksum, execution_ms)',
    );
    expect(preRolePosture).toBeGreaterThan(-1);
    expect(preRoleDurableSettings).toBeGreaterThan(-1);
    expect(preSessionSafety).toBeGreaterThan(-1);
    expect(preDefaultAcl).toBeGreaterThan(-1);
    expect(preRolePosture).toBeLessThan(setRole);
    expect(preRoleDurableSettings).toBeLessThan(setRole);
    expect(preSessionSafety).toBeLessThan(setRole);
    expect(preDefaultAcl).toBeLessThan(migrationSql);
    expect(firstPacket.sql.slice(0, setSearchPath)).not.toContain(exactSearchPathSetting);
    expect(firstPacket.sql.match(new RegExp(exactSearchPathSetting.replace(/[()[\]']/g, '\\$&'), 'g')))
      .toHaveLength(2);
    expect(firstPacket.sql.match(new RegExp(exactSearchPathSchemas.replace(/[()[\]']/g, '\\$&'), 'g')))
      .toHaveLength(2);
    expect(firstPacket.sql.match(
      /IF EXISTS \(\s*SELECT 'noncanonical_migration_search_path'::pg_catalog\.text AS violation/g,
    )).toHaveLength(2);
    expect(firstPacket.sql.match(new RegExp(activeRoleSetting.replace(/[()[\]']/g, '\\$&'), 'g')))
      .toHaveLength(2);
    expect(preDdlActiveRole).toBeGreaterThan(setSearchPath);
    expect(preDdlActiveRole).toBeLessThan(preDdlSearchPathSafety);
    expect(preDdlSearchPathSafety).toBeGreaterThan(setSearchPath);
    expect(preDdlSearchPathSafety).toBeLessThan(ledgerLock);
    expect(postMigrationActiveRole).toBeGreaterThan(migrationSql);
    expect(postMigrationActiveRole).toBeLessThan(postMigrationSearchPathSafety);
    expect(postMigrationSearchPathSafety).toBeGreaterThan(migrationSql);
    expect(postMigrationSearchPathSafety).toBeLessThan(postSessionSafety);
    expect(postSessionSafety).toBeGreaterThan(migrationSql);
    expect(postDefaultAcl).toBeGreaterThan(migrationSql);
    expect(postRoleDurableSettings).toBeGreaterThan(migrationSql);
    expect(postSessionSafety).toBeLessThan(ledgerInsert);
    expect(postDefaultAcl).toBeLessThan(ledgerInsert);

    expect(plan.postMigrationGrants.sql.indexOf('unsafe_migration_role_posture')).toBeLessThan(
      plan.postMigrationGrants.sql.indexOf('SET LOCAL ROLE "df_migration";'),
    );
    expect(plan.postMigrationGrants.sql.indexOf('unsafe_migration_session')).toBeLessThan(
      plan.postMigrationGrants.sql.indexOf('SET LOCAL ROLE "df_migration";'),
    );
    for (const verifier of [
      plan.postMigrationGrants.verificationSql,
      plan.postMigrationGrants.postCredentialVerificationSql,
    ]) {
      expect(verifier).toContain('unsafe_migration_role_posture');
      expect(verifier).toContain('unsafe_migration_role_durable_settings');
      expect(verifier).toContain('unsafe_migration_session');
      expect(verifier).toContain('Runtime grant verification failed: migration-role posture is unsafe.');
      expect(verifier).toContain('Runtime grant verification failed: migration-role durable settings are unsafe.');
      expect(verifier).toContain('Runtime grant verification failed: migration session is unsafe.');
    }
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
      await provisionSafeMigrationRole(database);
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
      await provisionSafeMigrationRole(database);
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
      await provisionSafeMigrationRole(database);
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
      await provisionSafeMigrationRole(database);

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
      expect(rows).toHaveLength(28);
      expect(rows[0]).toEqual({ version: '0001', checksum: FIRST_PRIVATE_CHECKSUM });
      expect(rows.at(-1)?.version).toBe('0028');
      expect(publicTables).toEqual([]);
    } finally {
      await database?.close();
    }
  }, 120_000);

  it.each([
    ['NOLOGIN', 'ALTER ROLE df_migration NOLOGIN'],
    ['INHERIT', 'ALTER ROLE df_migration INHERIT'],
    ['SUPERUSER', 'ALTER ROLE df_migration SUPERUSER'],
    ['CREATEDB', 'ALTER ROLE df_migration CREATEDB'],
    ['CREATEROLE', 'ALTER ROLE df_migration CREATEROLE'],
    ['REPLICATION', 'ALTER ROLE df_migration REPLICATION'],
    ['BYPASSRLS', 'ALTER ROLE df_migration BYPASSRLS'],
  ])('rejects an unsafe %s migration-role attribute before bootstrap DDL', async (_name, mutation) => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      await database.exec(`${mutation};`);
      const plan = build();

      await expect(database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`)).rejects.toThrow(
        /LOGIN, NOINHERIT, nonprivileged role with no outgoing memberships/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ schema_exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'data_foundry') AS schema_exists",
      );
      expect(state?.schema_exists).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('allows incoming connector membership but rejects outgoing migration-role membership', async () => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      await database.exec('CREATE ROLE migration_parent NOLOGIN NOINHERIT');
      const plan = build();

      await expect(database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`)).resolves.toBeUndefined();
      await database.exec('GRANT migration_parent TO df_migration');
      await expect(database.exec(`BEGIN;\n${plan.packets[0]!.sql}\nCOMMIT;`)).rejects.toThrow(
        /LOGIN, NOINHERIT, nonprivileged role with no outgoing memberships/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ ledger_count: number; first_table: string | null }>(
        `SELECT (SELECT count(*)::int FROM data_foundry.schema_migrations) AS ledger_count,
                to_regclass('data_foundry.verticals')::text AS first_table`,
      );
      expect(state).toEqual({ ledger_count: 0, first_table: null });
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    ['session_replication_role', 'SET session_replication_role TO replica', 'RESET session_replication_role'],
    ['lo_compat_privileges', 'SET lo_compat_privileges TO on', 'RESET lo_compat_privileges'],
  ])('rejects unsafe %s session state before bootstrap DDL', async (_name, mutation, reset) => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      await database.exec(`${mutation};`);
      const plan = build();

      await expect(database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`)).rejects.toThrow(
        /session_replication_role=origin and lo_compat_privileges=off/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      await database.exec(reset);
      const [state] = await database.query<{ schema_exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'data_foundry') AS schema_exists",
      );
      expect(state?.schema_exists).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects unsafe default ACLs before bootstrap ledger DDL', async () => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      await database.exec(
        'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
      );
      const plan = build();

      await expect(database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`)).rejects.toThrow(
        /safe df_migration default object ACLs/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ schema_exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'data_foundry') AS schema_exists",
      );
      expect(state?.schema_exists).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    [
      'external direct ACL',
      `CREATE TABLE public.migration_acl_escape (id integer);
       GRANT SELECT ON public.migration_acl_escape TO df_migration;`,
    ],
    [
      'external object ownership',
      `CREATE TABLE public.migration_owner_escape (id integer);
       ALTER TABLE public.migration_owner_escape OWNER TO df_migration;`,
    ],
    [
      'external-schema default-ACL ownership',
      `ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA public
         GRANT SELECT ON TABLES TO df_migration;`,
    ],
    [
      'shared database ownership',
      'CREATE DATABASE migration_owned_database OWNER df_migration;',
    ],
  ])('rejects migration-role %s before bootstrap DDL', async (_name, mutation) => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      await database.exec(mutation);
      const plan = build();

      await expect(database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`)).rejects.toThrow(
        /confined df_migration external privilege and ownership boundary/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ schema_exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'data_foundry') AS schema_exists",
      );
      expect(state?.schema_exists).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    [
      'session safety',
      'RESET ROLE; SET LOCAL lo_compat_privileges TO on; SET LOCAL ROLE df_migration;',
      /session_replication_role=origin and lo_compat_privileges=off/i,
    ],
    [
      'default ACL safety',
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT SELECT ON TABLES TO PUBLIC;',
      /safe df_migration default object ACLs/i,
    ],
    [
      'external ownership safety',
      `RESET ROLE;
       CREATE SCHEMA migration_owner_escape AUTHORIZATION df_migration;
       SET LOCAL ROLE df_migration;`,
      /confined df_migration external privilege and ownership boundary/i,
    ],
    [
      'target foreign-table ownership safety',
      `RESET ROLE;
       CREATE FOREIGN DATA WRAPPER packet_escape_wrapper NO HANDLER;
       CREATE SERVER packet_escape_server FOREIGN DATA WRAPPER packet_escape_wrapper;
       CREATE FOREIGN TABLE "data_foundry".packet_foreign_escape (id integer)
         SERVER packet_escape_server;
       ALTER FOREIGN TABLE "data_foundry".packet_foreign_escape OWNER TO df_migration;
       SET LOCAL ROLE df_migration;`,
      /confined df_migration external privilege and ownership boundary/i,
    ],
    [
      'durable migration-role setting safety',
      `RESET ROLE;
       ALTER ROLE df_migration SET lo_compat_privileges TO on;
       SET LOCAL ROLE df_migration;`,
      /canonical df_migration durable settings/i,
    ],
    [
      'active migration role safety',
      'RESET ROLE;',
      /current_user=df_migration/i,
    ],
  ])('rolls back packet DDL and omits its ledger stamp when migration SQL introduces %s drift', async (_name, driftSql, message) => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      const driftMigrations = migrations.map((migration, index) =>
        index === 0 ? { ...migration, sql: `${migration.sql}\n${driftSql}\n` } : migration,
      );
      const plan = build({ migrations: driftMigrations });
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);

      await expect(database.exec(`BEGIN;\n${plan.packets[0]!.sql}\nCOMMIT;`)).rejects.toThrow(message);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ ledger_count: number; first_table: string | null }>(
        `SELECT (SELECT count(*)::int FROM data_foundry.schema_migrations) AS ledger_count,
                to_regclass('data_foundry.verticals')::text AS first_table`,
      );
      expect(state).toEqual({ ledger_count: 0, first_table: null });
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    ['transaction-local', 'SET LOCAL search_path TO public, pg_catalog, extensions;'],
    ['session-level', 'SET search_path TO public, pg_catalog, extensions;'],
  ])('rolls back packet DDL and its ledger stamp after %s search_path poisoning', async (_name, searchPathSql) => {
    const database = await createPGliteDriver();
    try {
      await provisionSafeMigrationRole(database);
      const poisonedMigrations = migrations.map((migration, index) =>
        index === 0
          ? {
              ...migration,
              sql: `${migration.sql}\nRESET ROLE;\n${searchPathSql}\nCREATE TABLE packet_search_path_escape (id integer);\nSET LOCAL ROLE df_migration;\n`,
            }
          : migration,
      );
      const plan = build({ migrations: poisonedMigrations });
      await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);

      await expect(database.exec(`BEGIN;\n${plan.packets[0]!.sql}\nCOMMIT;`)).rejects.toThrow(
        /exact search_path.*data_foundry, pg_catalog, extensions/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{
        ledger_count: number;
        first_table: string | null;
        public_escape: string | null;
      }>(
        `SELECT (SELECT count(*)::int FROM data_foundry.schema_migrations) AS ledger_count,
                to_regclass('data_foundry.verticals')::text AS first_table,
                to_regclass('public.packet_search_path_escape')::text AS public_escape`,
      );
      expect(state).toEqual({ ledger_count: 0, first_table: null, public_escape: null });
    } finally {
      await database.close();
    }
  }, 120_000);

  it('loads packet bytes from the immutable Git object after source identity verification', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'data-foundry-export-race-'));
    try {
      const releaseSha = await createGitSourceFixture(repository, 28);

      const plan = await buildSupabaseMigrationPlanFromGit(
        { releaseSha, repositoryRoot: repository, appliedMigrations: [] },
        {
          verifySourceIdentity: async (sha, root) => {
            const identity = await verifyGitSourceIdentity(sha, root);
            await writeFile(
              join(repository, 'db/migrations/0028_fixture.sql'),
              "SELECT 'mutated-worktree';\n",
            );
            return identity;
          },
        },
      );

      expect(plan.packets.at(-1)?.transformedSql).toContain("SELECT 'committed-0028'");
      expect(plan.packets.at(-1)?.transformedSql).not.toContain('mutated-worktree');
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });
});
