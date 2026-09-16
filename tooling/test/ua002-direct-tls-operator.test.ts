import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyGrantUpgrade,
  parseOperatorPacket,
  preflightUa002,
  runUa002Operator,
  type OperatorPacket,
} from '../scripts/ua002-direct-tls-operator.js';
import {
  DATA_FOUNDRY_PRIVATE_SCHEMA,
  effectiveMigrationChecksum,
  scopeMigrationSql,
  type AppliedMigration,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';

const RELEASE_SHA = 'a'.repeat(40);
const SCHEMA = DATA_FOUNDRY_PRIVATE_SCHEMA;
const RUNTIME_ROLES = ['df_edge', 'df_web', 'df_mcp', 'df_usage', 'df_acquisition', 'df_ingestion'] as const;

function migration(version: string, name: string): Migration {
  const sql = `CREATE TABLE ${name} (id text primary key);`;
  return {
    version,
    filename: `${version}_${name}.sql`,
    sql,
    checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
  };
}

function expectedChecksum(entry: Migration): string {
  return effectiveMigrationChecksum(entry, SCHEMA, scopeMigrationSql(entry.sql, SCHEMA));
}

const APPLIED = [migration('0001', 'alpha'), migration('0002', 'beta')];
const PENDING = [migration('0003', 'gamma'), migration('0004', 'delta')];
const ALL_MIGRATIONS = [...APPLIED, ...PENDING];

function packet(overrides: Partial<OperatorPacket> = {}): OperatorPacket {
  return {
    releaseSha: RELEASE_SHA,
    schema: SCHEMA,
    migrationRole: 'df_migration',
    appliedMigrationCount: APPLIED.length,
    pendingMigrationCount: PENDING.length,
    packets: PENDING.map((entry) => ({
      version: entry.version,
      filename: entry.filename,
      checksum: expectedChecksum(entry),
    })),
    postMigrationGrants: {
      upgradeFrom0028Sql: 'DO $$ BEGIN END $$;',
      upgradeFrom0028Checksum: 'd'.repeat(64),
      verificationSql: 'DO $$ BEGIN END $$;',
      roles: [...RUNTIME_ROLES],
    },
    ...overrides,
  };
}

interface FakeState {
  readonly currentUser?: string;
  readonly sessionUser?: string;
  readonly transactionReadOnly?: string;
  readonly inRecovery?: boolean;
  readonly durableViolations?: ReadonlyArray<{ violation: string; role_name: string; setting_item: string }>;
  readonly missingRoles?: readonly string[];
  readonly migrationRoleCanLogin?: boolean;
  readonly ledgerMarker?: string | null;
  readonly ledger?: readonly Migration[];
  readonly ledgerChecksumOverride?: Readonly<Record<string, string>>;
}

interface Fake {
  readonly driver: MigrationDriver;
  readonly executed: string[];
}

/**
 * A driver that answers the preflight's four reads and records everything it is
 * asked to execute, so a test can assert that a blocked run mutated nothing.
 */
function fakeDriver(state: FakeState = {}): Fake {
  const executed: string[] = [];
  const ledger = state.ledger ?? APPLIED;
  const driver: MigrationDriver = {
    label: 'fake',
    async exec(sql) {
      executed.push(sql);
    },
    async query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      if (sql.includes('current_user::text AS current_user_name')) {
        return [
          {
            current_user_name: state.currentUser ?? 'df_migration',
            session_user_name: state.sessionUser ?? 'df_migration',
            transaction_read_only: state.transactionReadOnly ?? 'off',
            in_recovery: state.inRecovery ?? false,
          },
        ] as T[];
      }
      if (sql.includes('role_global_setting')) {
        return (state.durableViolations ?? []) as unknown as T[];
      }
      if (sql.includes('obj_description')) {
        const marker = state.ledgerMarker === undefined
          ? 'data-foundry:schema_migrations:v1'
          : state.ledgerMarker;
        return [{ marker }] as T[];
      }
      if (sql.includes('membership_count')) {
        const requested = (params?.[0] ?? []) as readonly string[];
        const missing = new Set(state.missingRoles ?? []);
        return requested
          .filter((name) => !missing.has(name))
          .map((name) => ({
            rolname: name,
            rolcanlogin: name === 'df_migration' ? state.migrationRoleCanLogin ?? true : false,
            rolinherit: false,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolbypassrls: false,
            membership_count: 0,
          })) as T[];
      }
      if (sql.includes('schema_migrations ORDER BY version')) {
        return ledger.map((entry) => ({
          version: entry.version,
          filename: entry.filename,
          checksum: state.ledgerChecksumOverride?.[entry.version] ?? expectedChecksum(entry),
        })) as T[];
      }
      if (sql === 'SELECT 1') return [] as T[];
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
    async close() {},
  };
  return { driver, executed };
}

describe('parseOperatorPacket', () => {
  it('accepts the exporter manifest shape', () => {
    const parsed = parseOperatorPacket({ format: 'data-foundry-supabase-migration-plan/v1', ...packet() });
    expect(parsed.pendingMigrationCount).toBe(2);
    expect(parsed.packets).toHaveLength(2);
  });

  it('refuses a manifest for another schema or another role', () => {
    expect(() =>
      parseOperatorPacket({ format: 'data-foundry-supabase-migration-plan/v1', ...packet(), schema: 'public' }),
    ).toThrow(/data_foundry/u);
    expect(() =>
      parseOperatorPacket({
        format: 'data-foundry-supabase-migration-plan/v1',
        ...packet(),
        migrationRole: 'postgres',
      }),
    ).toThrow(/df_migration/u);
  });

  it('refuses a manifest that disagrees with itself about the pending count', () => {
    expect(() =>
      parseOperatorPacket({
        format: 'data-foundry-supabase-migration-plan/v1',
        ...packet(),
        pendingMigrationCount: 9,
      }),
    ).toThrow(/disagrees with itself/u);
  });

  it('refuses anything that is not this manifest format', () => {
    expect(() => parseOperatorPacket({ ...packet(), format: 'something-else/v1' })).toThrow(/format/u);
  });
});

describe('preflightUa002', () => {
  it('passes on a database that is ready', async () => {
    const { driver } = fakeDriver();
    await expect(preflightUa002(driver, packet(), ALL_MIGRATIONS)).resolves.toEqual([]);
  });

  it('reports every durable-setting violation the grant packet would raise on', async () => {
    const { driver } = fakeDriver({
      durableViolations: [
        { violation: 'role_global_setting', role_name: 'df_migration', setting_item: 'search_path=data_foundry' },
        { violation: 'missing_current_database_role_setting', role_name: 'df_edge', setting_item: '' },
      ],
    });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.filter((finding) => finding.check === 'durable-settings')).toHaveLength(2);
    expect(findings[0]?.detail).toContain('df_migration: role_global_setting');
    expect(findings[1]?.detail).toContain('df_edge: missing_current_database_role_setting');
  });

  it('rejects a SET ROLE session instead of a direct migration login', async () => {
    const { driver } = fakeDriver({ sessionUser: 'postgres' });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.some((finding) => finding.check === 'identity')).toBe(true);
    expect(findings.find((finding) => finding.check === 'identity')?.detail).toContain('SET ROLE');
  });

  it('reports a read-only session rather than discovering it mid-migration', async () => {
    const { driver } = fakeDriver({ transactionReadOnly: 'on' });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.some((finding) => finding.check === 'session-writable')).toBe(true);
  });

  it('names the absent role and why the migration identity cannot create it', async () => {
    const { driver } = fakeDriver({ missingRoles: ['df_ingestion'] });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    const missing = findings.find((finding) => finding.detail.startsWith('df_ingestion'));
    expect(missing?.check).toBe('roles');
    expect(missing?.detail).toContain('NOCREATEROLE');
  });

  it('reports a NOLOGIN migration role as the credential step it is', async () => {
    const { driver } = fakeDriver({ migrationRoleCanLogin: false });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.find((finding) => finding.check === 'roles')?.detail).toContain('NOLOGIN');
  });

  it('refuses a ledger this project did not create', async () => {
    const { driver } = fakeDriver({ ledgerMarker: null });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.find((finding) => finding.check === 'ledger')?.detail).toContain('not the ledger');
  });

  it('refuses to replay a migration the ledger already holds', async () => {
    const { driver } = fakeDriver({ ledger: [...APPLIED, PENDING[0] as Migration] });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.some((finding) => finding.detail.includes('would replay it'))).toBe(true);
  });

  it('catches a packet checksum that does not match the Git object', async () => {
    const { driver } = fakeDriver();
    const tampered = packet({
      packets: PENDING.map((entry, index) => ({
        version: entry.version,
        filename: entry.filename,
        checksum: index === 0 ? 'f'.repeat(64) : expectedChecksum(entry),
      })),
    });
    const findings = await preflightUa002(driver, tampered, ALL_MIGRATIONS);
    expect(findings.find((finding) => finding.check === 'checksums')?.detail).toContain('0003_gamma.sql');
  });

  it('catches an applied migration that changed since it was applied', async () => {
    const { driver } = fakeDriver({ ledgerChecksumOverride: { '0001': 'e'.repeat(64) } });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS);
    expect(findings.find((finding) => finding.check === 'checksums')?.detail).toContain('no longer matches');
  });
});

describe('runUa002Operator', () => {
  it('mutates nothing when preflight finds a blocker', async () => {
    const { driver, executed } = fakeDriver({
      durableViolations: [{ violation: 'role_global_setting', role_name: 'df_migration', setting_item: 'x' }],
    });
    const report = await runUa002Operator(driver, packet(), ALL_MIGRATIONS, {
      apply: true,
      applyMigrationsImpl: async () => {
        throw new Error('migrations must not run behind a blocker');
      },
    });
    expect(report.findings).toHaveLength(1);
    expect(report.applied).toEqual([]);
    expect(report.grantsApplied).toBe(false);
    expect(executed).toEqual([]);
  });

  it('mutates nothing on a clean database without --apply', async () => {
    const { driver, executed } = fakeDriver();
    const report = await runUa002Operator(driver, packet(), ALL_MIGRATIONS, {
      applyMigrationsImpl: async () => {
        throw new Error('migrations must not run without --apply');
      },
    });
    expect(report.findings).toEqual([]);
    expect(report.grantsApplied).toBe(false);
    expect(executed).toEqual([]);
  });

  it('applies migrations, then the grant upgrade in one transaction, then verification', async () => {
    const { driver, executed } = fakeDriver();
    const applied: AppliedMigration[] = PENDING.map((entry) => ({
      version: entry.version,
      filename: entry.filename,
      skipped: false,
      executionMs: 1,
    }));
    const report = await runUa002Operator(driver, packet(), ALL_MIGRATIONS, {
      apply: true,
      applyMigrationsImpl: async () => applied,
    });
    expect(report.applied).toEqual(applied);
    expect(report.grantsApplied).toBe(true);
    expect(report.verified).toBe(true);
    expect(executed).toEqual(['BEGIN', 'DO $$ BEGIN END $$;', 'COMMIT', 'DO $$ BEGIN END $$;']);
  });
});

describe('applyGrantUpgrade', () => {
  it('rolls back and confirms the session recovered before reporting failure', async () => {
    const executed: string[] = [];
    const driver: MigrationDriver = {
      label: 'fake',
      async exec(sql) {
        executed.push(sql);
        if (sql.includes('RAISE')) throw new Error('grant drift');
      },
      async query<T>(): Promise<T[]> {
        return [] as T[];
      },
      async close() {},
    };
    await expect(applyGrantUpgrade(driver, 'DO $$ BEGIN RAISE EXCEPTION $$;')).rejects.toThrow(
      /rolled back cleanly/u,
    );
    expect(executed).toEqual(['BEGIN', 'DO $$ BEGIN RAISE EXCEPTION $$;', 'ROLLBACK']);
  });

  it('says so when the rollback could not be confirmed', async () => {
    const driver: MigrationDriver = {
      label: 'fake',
      async exec(sql) {
        if (sql.includes('RAISE')) throw new Error('grant drift');
      },
      async query<T>(): Promise<T[]> {
        throw new Error('session still in a failed transaction');
      },
      async close() {},
    };
    await expect(applyGrantUpgrade(driver, 'DO $$ BEGIN RAISE EXCEPTION $$;')).rejects.toThrow(
      /NOT confirmed rolled back/u,
    );
  });
});
