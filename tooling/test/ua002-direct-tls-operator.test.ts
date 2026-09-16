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
  loadMigrations,
  scopeMigrationSql,
  type AppliedMigration,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';
import {
  buildGrantPrerequisiteProbeSql,
  buildRuntimeGrantPayloadForRelease,
  type SupabaseRuntimeGrantPayload,
} from '../scripts/export-supabase-migration-packets.js';
import { createPGliteDriver } from '../scripts/migrate.js';

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

/**
 * The real builder insists on the full contiguous release set, so the unit
 * tests inject a small stand-in through the same seam production leaves unset.
 * One test below exercises the real builder against the real migrations.
 */
const STUB_GRANTS = {
  providerMigrationName: 'data_foundry_runtime_grants_stub',
  checksum: 'a'.repeat(64),
  applicationLedgerMutation: false,
  roles: [...RUNTIME_ROLES],
  functionGrantPolicy: 'explicit-all-private-functions-to-acquisition-invoker',
  functionSignatures: [],
  expectedGrants: [],
  sql: 'DO $$ BEGIN END $$;',
  upgradeFrom0028Sql: 'DO $$ BEGIN END $$;',
  upgradeFrom0028Checksum: 'd'.repeat(64),
  verificationSql: 'DO $$ BEGIN /* verify */ END $$;',
  postCredentialVerificationSql: 'DO $$ BEGIN END $$;',
} as unknown as SupabaseRuntimeGrantPayload;

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
      upgradeFrom0028Sql: STUB_GRANTS.upgradeFrom0028Sql,
      upgradeFrom0028Checksum: STUB_GRANTS.upgradeFrom0028Checksum,
      verificationSql: STUB_GRANTS.verificationSql,
      roles: [...STUB_GRANTS.roles],
    },
    ...overrides,
  };
}

interface FakeState {
  readonly currentUser?: string;
  readonly sessionUser?: string;
  readonly transactionReadOnly?: string;
  readonly inRecovery?: boolean;
  readonly prerequisiteViolations?: ReadonlyArray<{ probe: string; detail: string }>;
  readonly missingRoles?: readonly string[];
  readonly migrationRoleCanLogin?: boolean;
  readonly outgoingMemberships?: Readonly<Record<string, number>>;
  readonly incomingMembers?: Readonly<Record<string, number>>;
  readonly ledgerMarker?: string | null;
  readonly ledger?: readonly Migration[];
  readonly ledgerChecksumOverride?: Readonly<Record<string, string>>;
  readonly ledgerFilenameOverride?: Readonly<Record<string, string>>;
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
      if (sql.includes('AS probe')) {
        return (state.prerequisiteViolations ?? []) as unknown as T[];
      }
      if (sql.includes('obj_description')) {
        const marker = state.ledgerMarker === undefined
          ? 'data-foundry:schema_migrations:v1'
          : state.ledgerMarker;
        return [{ marker }] as T[];
      }
      if (sql.includes('outgoing_memberships')) {
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
            outgoing_memberships: state.outgoingMemberships?.[name] ?? 0,
            incoming_members: state.incomingMembers?.[name] ?? 0,
          })) as T[];
      }
      if (sql.includes('schema_migrations ORDER BY version')) {
        return ledger.map((entry) => ({
          version: entry.version,
          filename: state.ledgerFilenameOverride?.[entry.version] ?? entry.filename,
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
    await expect(preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS)).resolves.toEqual([]);
  });

  it('reports every grant prerequisite the install would raise on, not just durable settings', async () => {
    const { driver } = fakeDriver({
      prerequisiteViolations: [
        { probe: 'migration-role-durable-settings', detail: '{"violation": "role_global_setting"}' },
        { probe: 'migration-role-default-acl', detail: '{"violation": "unsafe_default_acl"}' },
        { probe: 'runtime-role-external-acl', detail: '{"scope": "schema", "object_name": "public"}' },
      ],
    });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    const prerequisites = findings.filter((finding) => finding.check === 'grant-prerequisites');
    expect(prerequisites).toHaveLength(3);
    expect(prerequisites[0]?.detail).toContain('migration-role-durable-settings');
    // The whole point of the fix: an ACL or capability invariant is caught here
    // rather than after the migrations have already committed.
    expect(prerequisites[2]?.detail).toContain('runtime-role-external-acl');
  });

  it('flags an outgoing membership on the migration role, while allowing incoming members', async () => {
    const outgoing = await preflightUa002(
      fakeDriver({ outgoingMemberships: { df_migration: 1 } }).driver,
      packet(),
      ALL_MIGRATIONS,
      STUB_GRANTS,
    );
    expect(outgoing.find((finding) => finding.check === 'roles')?.detail).toContain(
      'outgoing memberships',
    );
    // `postgres` being a member of df_migration is how a provider session
    // assumes it, and must not be reported as drift.
    const incoming = await preflightUa002(
      fakeDriver({ incomingMembers: { df_migration: 1 } }).driver,
      packet(),
      ALL_MIGRATIONS,
      STUB_GRANTS,
    );
    expect(incoming).toEqual([]);
  });

  it('rejects a SET ROLE session instead of a direct migration login', async () => {
    const { driver } = fakeDriver({ sessionUser: 'postgres' });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.some((finding) => finding.check === 'identity')).toBe(true);
    expect(findings.find((finding) => finding.check === 'identity')?.detail).toContain('SET ROLE');
  });

  it('reports a read-only session rather than discovering it mid-migration', async () => {
    const { driver } = fakeDriver({ transactionReadOnly: 'on' });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.some((finding) => finding.check === 'session-writable')).toBe(true);
  });

  it('names the absent role and why the migration identity cannot create it', async () => {
    const { driver } = fakeDriver({ missingRoles: ['df_ingestion'] });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    const missing = findings.find((finding) => finding.detail.startsWith('df_ingestion'));
    expect(missing?.check).toBe('roles');
    expect(missing?.detail).toContain('NOCREATEROLE');
  });

  it('reports a NOLOGIN migration role as the credential step it is', async () => {
    const { driver } = fakeDriver({ migrationRoleCanLogin: false });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'roles')?.detail).toContain('NOLOGIN');
  });

  it('refuses a ledger this project did not create', async () => {
    const { driver } = fakeDriver({ ledgerMarker: null });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'ledger')?.detail).toContain('not the ledger');
  });

  it('refuses to replay a migration the ledger already holds', async () => {
    const { driver } = fakeDriver({ ledger: [...APPLIED, PENDING[0] as Migration] });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
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
    const findings = await preflightUa002(driver, tampered, ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'checksums')?.detail).toContain('0003_gamma.sql');
  });

  it('refuses a packet that omits an unapplied release migration', async () => {
    const { driver } = fakeDriver();
    // The packet names only 0003, but 0004 is unapplied at the release — and
    // `applyMigrations` would apply it anyway, unlisted.
    const partial = packet({
      pendingMigrationCount: 1,
      packets: [
        {
          version: '0003',
          filename: '0003_gamma.sql',
          checksum: expectedChecksum(PENDING[0] as Migration),
        },
      ],
    });
    const findings = await preflightUa002(driver, partial, ALL_MIGRATIONS, STUB_GRANTS);
    const coverage = findings.find((finding) => finding.check === 'coverage');
    expect(coverage?.detail).toContain('0004_delta.sql');
    expect(coverage?.detail).toContain('would apply it anyway');
  });

  it('refuses grant SQL that does not match the payload derived from the release', async () => {
    const { driver } = fakeDriver();
    const tampered = packet({
      postMigrationGrants: {
        upgradeFrom0028Sql: 'GRANT ALL ON ALL TABLES IN SCHEMA data_foundry TO PUBLIC;',
        upgradeFrom0028Checksum: STUB_GRANTS.upgradeFrom0028Checksum,
        verificationSql: STUB_GRANTS.verificationSql,
        roles: [...STUB_GRANTS.roles],
      },
    });
    const findings = await preflightUa002(driver, tampered, ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'grant-payload')?.detail).toContain(
      'upgradeFrom0028Sql',
    );
  });

  it('refuses a substituted verifier that would report success on an unverified database', async () => {
    const { driver } = fakeDriver();
    const tampered = packet({
      postMigrationGrants: {
        upgradeFrom0028Sql: STUB_GRANTS.upgradeFrom0028Sql,
        upgradeFrom0028Checksum: STUB_GRANTS.upgradeFrom0028Checksum,
        verificationSql: 'SELECT 1;',
        roles: [...STUB_GRANTS.roles],
      },
    });
    const findings = await preflightUa002(driver, tampered, ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'grant-payload')?.detail).toContain(
      'substituted verifier',
    );
  });

  it('refuses a manifest that declares the wrong runtime roles', async () => {
    const { driver } = fakeDriver();
    const tampered = packet({
      postMigrationGrants: {
        upgradeFrom0028Sql: STUB_GRANTS.upgradeFrom0028Sql,
        upgradeFrom0028Checksum: STUB_GRANTS.upgradeFrom0028Checksum,
        verificationSql: STUB_GRANTS.verificationSql,
        roles: ['df_edge'],
      },
    });
    const findings = await preflightUa002(driver, tampered, ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'grant-payload')?.detail).toContain('df_edge');
  });

  it('catches an applied ledger row whose filename drifted from the release', async () => {
    const { driver } = fakeDriver({
      ledgerFilenameOverride: { '0001': '0001_renamed.sql' },
    });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    const drift = findings.find((finding) => finding.check === 'checksums');
    expect(drift?.detail).toContain('0001_renamed.sql');
    // The grant upgrade compares the ledger on filename too, so an intact
    // checksum is not enough to let this through.
    expect(drift?.detail).toContain('filename');
  });

  it('catches an applied migration that changed since it was applied', async () => {
    const { driver } = fakeDriver({ ledgerChecksumOverride: { '0001': 'e'.repeat(64) } });
    const findings = await preflightUa002(driver, packet(), ALL_MIGRATIONS, STUB_GRANTS);
    expect(findings.find((finding) => finding.check === 'checksums')?.detail).toContain('no longer matches');
  });
});

describe('runUa002Operator', () => {
  it('mutates nothing when preflight finds a blocker', async () => {
    const { driver, executed } = fakeDriver({
      prerequisiteViolations: [{ probe: 'migration-role-durable-settings', detail: '{"violation": "x"}' }],
    });
    const report = await runUa002Operator(driver, packet(), ALL_MIGRATIONS, {
      apply: true,
      releaseGrants: STUB_GRANTS,
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
      releaseGrants: STUB_GRANTS,
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
      releaseGrants: STUB_GRANTS,
      applyMigrationsImpl: async () => applied,
    });
    expect(report.applied).toEqual(applied);
    expect(report.grantsApplied).toBe(true);
    expect(report.verified).toBe(true);
    expect(executed).toEqual([
      'BEGIN',
      STUB_GRANTS.upgradeFrom0028Sql,
      'COMMIT',
      STUB_GRANTS.verificationSql,
    ]);
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

describe('buildRuntimeGrantPayloadForRelease', () => {
  it('derives a payload from the real migration set, independently of any manifest', async () => {
    const migrations = await loadMigrations();
    const payload = buildRuntimeGrantPayloadForRelease(migrations);
    expect(payload.roles).toEqual(RUNTIME_ROLES);
    expect(payload.upgradeFrom0028Sql.length).toBeGreaterThan(0);
    expect(payload.upgradeFrom0028Checksum).toMatch(/^[0-9a-f]{64}$/u);
    // Deterministic: the same release must produce the same bytes, or checking a
    // manifest against it would be meaningless.
    const again = buildRuntimeGrantPayloadForRelease(migrations);
    expect(again.upgradeFrom0028Sql).toBe(payload.upgradeFrom0028Sql);
    expect(again.verificationSql).toBe(payload.verificationSql);
  });

  it('refuses a partial migration set rather than deriving a payload for it', async () => {
    const migrations = await loadMigrations();
    expect(() => buildRuntimeGrantPayloadForRelease(migrations.slice(0, 10))).toThrow(/contiguous/u);
  });
});

describe('buildGrantPrerequisiteProbeSql against real PostgreSQL', () => {
  it('catches pre-existing object drift the grant install would reject after migrations', async () => {
    const driver = await createPGliteDriver();
    try {
      await driver.exec('CREATE SCHEMA IF NOT EXISTS extensions');
      await driver.exec('CREATE SCHEMA IF NOT EXISTS data_foundry');
      // Exactly the case that motivated this probe: an object already sitting in
      // the schema, which survives the pending migrations and is then rejected
      // as noncanonical — after the ledger has been caught up.
      await driver.exec('CREATE TABLE data_foundry.someone_elses_table (id text primary key)');
      await driver.exec(
        'CREATE FUNCTION data_foundry.rogue_fn() RETURNS int LANGUAGE sql SECURITY DEFINER AS $rogue$ SELECT 1 $rogue$',
      );

      const rows = await driver.query<{ probe: string; detail: string }>(
        buildGrantPrerequisiteProbeSql(),
      );
      const probes = new Set(rows.map((row) => row.probe));
      expect(probes).toContain('unexpected-relation');
      expect(probes).toContain('relation-ownership');
      expect(probes).toContain('unexpected-function');
      expect(probes).toContain('function-posture');

      const relation = rows.find((row) => row.probe === 'unexpected-relation');
      expect(relation?.detail).toContain('someone_elses_table');
      const posture = rows.find((row) => row.probe === 'function-posture');
      expect(posture?.detail).toContain('rogue_fn()');
      expect(posture?.detail).toContain('"security_definer": true');
    } finally {
      await driver.close();
    }
  });
});
