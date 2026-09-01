import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPGliteDriver,
  loadMigrations,
  type Migration,
  type MigrationDriver,
} from '../scripts/migrate.js';
import {
  RELEVANT_SOURCE_PATHS,
  buildSupabaseMigrationPlan,
} from '../scripts/export-supabase-migration-packets.js';
import {
  buildRuntimeRoleExpectedExternalAclValuesSql,
  buildRuntimeRoleExpectedGrants,
  PRIVATE_CANARY_RUNTIME_BINDING_SQL,
} from '@data-foundry/private-canary';

const RELEASE_SHA = '290df1342094433e92978ec97eb37cc02fc4eb50';
const SOURCE_IDENTITY = {
  releaseSha: RELEASE_SHA,
  headSha: RELEASE_SHA,
  relevantInputsClean: true,
  relevantPaths: RELEVANT_SOURCE_PATHS,
} as const;
const RUNTIME_ROLES = ['df_edge', 'df_web', 'df_mcp', 'df_usage', 'df_acquisition'] as const;

let migrations: Migration[];

beforeAll(async () => {
  migrations = await loadMigrations();
});

function build() {
  return buildSupabaseMigrationPlan({
    sourceIdentity: SOURCE_IDENTITY,
    schema: 'data_foundry',
    migrationRole: 'df_migration',
    migrations,
    appliedMigrations: [],
  });
}

async function createMigratedDatabase(): Promise<{
  database: MigrationDriver;
  plan: ReturnType<typeof build>;
}> {
  const database = await createPGliteDriver();
  await database.exec(`
    CREATE ROLE df_migration NOLOGIN;
    GRANT df_migration TO postgres;
    GRANT USAGE ON SCHEMA extensions TO df_migration;
    ${RUNTIME_ROLES.map((role) => `CREATE ROLE ${role} NOLOGIN;`).join('\n    ')}
    ${RUNTIME_ROLES.map((role) => `GRANT USAGE ON SCHEMA extensions TO ${role};`).join('\n    ')}
    DO $runtime_database_connect$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_edge');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_web');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_mcp');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_usage');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_acquisition');
    END
    $runtime_database_connect$;
  `);
  const plan = build();
  await database.exec(`BEGIN;\n${plan.bootstrapSql}\nCOMMIT;`);
  for (const packet of plan.packets) {
    await database.exec(`BEGIN;\n${packet.sql}\nCOMMIT;`);
  }
  await database.exec(`
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON SCHEMA data_foundry FROM PUBLIC;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA data_foundry FROM PUBLIC;
  `);
  return { database, plan };
}

async function grantConnectOnWrongDatabase(database: MigrationDriver): Promise<void> {
  await database.exec('CREATE DATABASE runtime_grant_wrong_target');
  await database.exec('GRANT CONNECT ON DATABASE runtime_grant_wrong_target TO df_edge');
}

describe('Supabase post-migration runtime grants', () => {
  it('emits one deterministic, provider-only payload with exact narrow grants', () => {
    const first = build().postMigrationGrants;
    const second = build().postMigrationGrants;

    expect(second).toEqual(first);
    expect(first.applicationLedgerMutation).toBe(false);
    expect(first.providerMigrationName).toBe(
      `data_foundry_runtime_grants_${createHash('sha256').update(first.sql).digest('hex').slice(0, 12)}`,
    );
    expect(first.roles).toEqual(RUNTIME_ROLES);
    expect(first.sql).toContain('LOCK TABLE "data_foundry"."schema_migrations" IN EXCLUSIVE MODE;');
    expect(first.sql).toContain('GRANT SELECT ON TABLE "data_foundry"."verticals" TO "df_edge";');
    expect(first.sql).toContain(
      'GRANT SELECT ("id", "tenant_id", "token_hash", "token_prefix", "vertical_id", "access_tier", "billing_source", "revoked_at", "expires_at") ON TABLE "data_foundry"."api_keys" TO "df_edge";',
    );
    expect(first.sql).toContain(
      'GRANT INSERT ("id", "tenant_id", "api_key_id", "vertical_id", "occurred_at", "route_key", "method", "status", "rows_served", "duration_ms", "access_tier", "billing_source") ON TABLE "data_foundry"."api_usage_events" TO "df_usage";',
    );
    expect(first.sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "data_foundry"."scheduled_acquisition_runs" TO "df_acquisition";',
    );
    expect(first.functionSignatures).toHaveLength(57);
    expect(first.expectedGrants).toHaveLength(200);
    expect(first.expectedGrants).toEqual(buildRuntimeRoleExpectedGrants('data_foundry'));
    for (const signature of first.functionSignatures) {
      expect(first.sql).toContain(
        `GRANT EXECUTE ON FUNCTION "data_foundry".${signature} TO "df_acquisition";`,
      );
    }
    expect(first.sql).not.toMatch(/GRANT\s+ALL|ALL TABLES|ALTER DEFAULT PRIVILEGES/i);
    expect(first.sql).not.toMatch(/^\s*GRANT\s+[^;]*(?:DELETE|TRUNCATE|CREATE)/im);
    expect(first.sql).not.toContain('schema_migrations (version');
    expect(first.sql).toContain(
      "('database', current_database()::text, '', 'df_edge', 'CONNECT', false)",
    );
    expect(first.verificationSql).toContain(buildRuntimeRoleExpectedExternalAclValuesSql());
    expect(first.verificationSql).toContain('public_schema_create_is_false');
    expect(first.verificationSql).toContain('unexpected_private_privilege_count');
    expect(first.verificationSql).toContain('public_fingerprint_input');
  });

  it('executes after all migrations and proves representative positive and negative privileges', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(plan.postMigrationGrants.verificationSql);
      const [checks] = await database.query<Record<string, boolean>>(`
        SELECT has_table_privilege('df_edge', 'data_foundry.verticals', 'SELECT') AS edge_core_select,
               has_column_privilege('df_edge', 'data_foundry.api_keys', 'token_hash', 'SELECT') AS edge_auth_hash,
               has_column_privilege('df_edge', 'data_foundry.api_keys', 'created_at', 'SELECT') AS edge_auth_extra,
               has_any_column_privilege('df_web', 'data_foundry.api_keys', 'SELECT') AS web_auth_select,
               has_column_privilege('df_usage', 'data_foundry.api_usage_events', 'route_key', 'INSERT') AS usage_insert,
               has_table_privilege('df_usage', 'data_foundry.api_usage_events', 'UPDATE') AS usage_update,
               has_table_privilege('df_acquisition', 'data_foundry.sources', 'UPDATE') AS acquisition_update,
               has_table_privilege('df_acquisition', 'data_foundry.sources', 'DELETE') AS acquisition_delete,
               has_function_privilege('df_acquisition', 'data_foundry.scheduled_acquisition_validators_valid(jsonb)', 'EXECUTE') AS acquisition_execute,
               has_function_privilege('df_edge', 'data_foundry.scheduled_acquisition_validators_valid(jsonb)', 'EXECUTE') AS edge_execute,
               has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS edge_schema_usage,
               has_schema_privilege('df_edge', 'data_foundry', 'CREATE') AS edge_schema_create
      `);
      expect(checks).toEqual({
        edge_core_select: true,
        edge_auth_hash: true,
        edge_auth_extra: false,
        web_auth_select: false,
        usage_insert: true,
        usage_update: false,
        acquisition_update: true,
        acquisition_delete: false,
        acquisition_execute: true,
        edge_execute: false,
        edge_schema_usage: true,
        edge_schema_create: false,
      });
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects every effective private-schema privilege not present in the generated runtime grant inventory', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        BEGIN;
        ${plan.postMigrationGrants.sql}
        COMMIT;
        ALTER ROLE df_web LOGIN;
      `);
      const [baseline] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_web'],
      );
      expect(baseline?.privilege_matrix_is_exact).toBe(true);

      await database.exec(`
        GRANT SELECT ON data_foundry.api_keys TO df_web;
        SET SESSION AUTHORIZATION df_web;
      `);
      const [observed] = await database.query<{
        readonly current_user: string;
        readonly sensitive_select_is_effective: boolean;
      }>(`
        SELECT current_user::text AS current_user,
               has_table_privilege('df_web', 'data_foundry.api_keys', 'SELECT') AS sensitive_select_is_effective
      `);
      expect(observed).toEqual({ current_user: 'df_web', sensitive_select_is_effective: true });
      const [drift] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_web'],
      );
      expect(drift?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects grant-option drift even when the underlying private privilege is expected', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT SELECT ON data_foundry.verticals TO df_edge WITH GRANT OPTION');
      const [grantOption] = await database.query<{ readonly select_with_grant_option: boolean }>(`
        SELECT has_table_privilege('df_edge', 'data_foundry.verticals', 'SELECT WITH GRANT OPTION')
          AS select_with_grant_option
      `);
      expect(grantOption?.select_with_grant_option).toBe(true);
      const [drift] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(drift?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC-derived private-schema access even when role-effective usage remains expected', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT USAGE ON SCHEMA data_foundry TO PUBLIC');
      const [drift] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(drift?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC function access even when the acquisition role otherwise expects EXECUTE', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(
        'GRANT EXECUTE ON FUNCTION data_foundry.scheduled_acquisition_validators_valid(jsonb) TO PUBLIC',
      );
      const [drift] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_acquisition'],
      );
      expect(drift?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects direct external database and schema capability drift in the runtime binding matrix', async () => {
    const { database, plan } = await createMigratedDatabase();
    const bindingIsExact = async () => {
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      return binding?.privilege_matrix_is_exact;
    };
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      expect(await bindingIsExact()).toBe(true);

      await database.exec(`
        DO $runtime_database_create_drift$
        BEGIN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), 'df_edge');
        END
        $runtime_database_create_drift$;
      `);
      expect(await bindingIsExact()).toBe(false);
      await database.exec(`
        DO $runtime_database_create_restore$
        BEGIN
          EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), 'df_edge');
        END
        $runtime_database_create_restore$;
      `);

      await database.exec(`
        DO $runtime_database_temporary_drift$
        BEGIN
          EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO %I', current_database(), 'df_edge');
        END
        $runtime_database_temporary_drift$;
      `);
      expect(await bindingIsExact()).toBe(false);
      await database.exec(`
        DO $runtime_database_temporary_restore$
        BEGIN
          EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), 'df_edge');
        END
        $runtime_database_temporary_restore$;
      `);

      await database.exec(`
        DO $runtime_database_connect_option_drift$
        BEGIN
          EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM %I', current_database(), 'df_edge');
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I WITH GRANT OPTION', current_database(), 'df_edge');
        END
        $runtime_database_connect_option_drift$;
      `);
      expect(await bindingIsExact()).toBe(false);
      await database.exec(`
        DO $runtime_database_connect_restore$
        BEGIN
          EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM %I', current_database(), 'df_edge');
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_edge');
        END
        $runtime_database_connect_restore$;
      `);

      await grantConnectOnWrongDatabase(database);
      expect(await bindingIsExact()).toBe(false);
      await database.exec('REVOKE CONNECT ON DATABASE runtime_grant_wrong_target FROM df_edge');

      await database.exec('GRANT CREATE ON SCHEMA extensions TO df_edge');
      expect(await bindingIsExact()).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('accepts exact non-grantable CONNECT for each runtime role on the current database', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(plan.postMigrationGrants.verificationSql);
      const [checks] = await database.query<Record<string, boolean>>(`
        SELECT has_database_privilege('df_edge', current_database(), 'CONNECT') AS edge_connect,
               has_database_privilege('df_web', current_database(), 'CONNECT') AS web_connect,
               has_database_privilege('df_mcp', current_database(), 'CONNECT') AS mcp_connect,
               has_database_privilege('df_usage', current_database(), 'CONNECT') AS usage_connect,
               has_database_privilege('df_acquisition', current_database(), 'CONNECT') AS acquisition_connect,
               has_database_privilege('df_edge', current_database(), 'CREATE') AS edge_create
      `);
      expect(checks).toEqual({
        edge_connect: true,
        web_connect: true,
        mcp_connect: true,
        usage_connect: true,
        acquisition_connect: true,
        edge_create: false,
      });
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses pre-existing runtime-role database CREATE before issuing grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        DO $unexpected_runtime_database_create$
        BEGIN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), 'df_edge');
        END
        $unexpected_runtime_database_create$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/unexpected direct object privilege outside data_foundry/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses pre-existing runtime-role CONNECT WITH GRANT OPTION before issuing grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        DO $runtime_database_grant_option$
        BEGIN
          EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM %I', current_database(), 'df_edge');
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I WITH GRANT OPTION', current_database(), 'df_edge');
        END
        $runtime_database_grant_option$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/unexpected direct object privilege outside data_foundry/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses a pre-existing runtime-role database ACL on a different database before issuing grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await grantConnectOnWrongDatabase(database);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/unexpected direct object privilege outside data_foundry/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects a runtime-role database ACL on a different database during post-grant verification', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(plan.postMigrationGrants.verificationSql);
      await grantConnectOnWrongDatabase(database);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /external direct ACL drift/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects current-database CREATE and CONNECT WITH GRANT OPTION during post-grant verification', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        DO $unexpected_runtime_database_privilege$
        BEGIN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), 'df_edge');
        END
        $unexpected_runtime_database_privilege$;
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /external direct ACL drift/i,
      );
      await database.exec(`
        DO $runtime_database_grant_option$
        BEGIN
          EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), 'df_edge');
          EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM %I', current_database(), 'df_edge');
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I WITH GRANT OPTION', current_database(), 'df_edge');
        END
        $runtime_database_grant_option$;
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /external direct ACL drift/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects membership in either direction for every runtime role', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('CREATE ROLE outsider NOLOGIN; GRANT df_edge TO outsider;');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/member roles/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects any outsider direct private ACL and any runtime object ACL outside the private schema', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE ROLE observer NOLOGIN;
        GRANT SELECT ON data_foundry.verticals TO observer;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/direct ACL baseline/i);
    } finally {
      await database.close();
    }

    const externalFixture = await createMigratedDatabase();
    try {
      await externalFixture.database.exec(`
        CREATE SCHEMA external_fixture;
        CREATE TABLE external_fixture.secret (id integer);
        GRANT SELECT ON external_fixture.secret TO df_edge;
      `);
      await expect(
        externalFixture.database.exec(
          `BEGIN;\n${externalFixture.plan.postMigrationGrants.sql}\nCOMMIT;`,
        ),
      ).rejects.toThrow(/outside data_foundry/i);
    } finally {
      await externalFixture.database.close();
    }
  }, 120_000);

  it('rejects foreign-table and aggregate inventory drift', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE FOREIGN DATA WRAPPER drift_wrapper NO HANDLER;
        CREATE SERVER drift_server FOREIGN DATA WRAPPER drift_wrapper;
        CREATE FOREIGN TABLE data_foundry.drift_foreign (id integer) SERVER drift_server;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/canonical object inventory/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      await database.exec(`
        DROP FOREIGN TABLE data_foundry.drift_foreign;
        CREATE AGGREGATE data_foundry.drift_count(*) (SFUNC = int8inc, STYPE = bigint, INITCOND = '0');
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/function inventory/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('verification executes and fails closed on post-grant ACL drift', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(plan.postMigrationGrants.verificationSql);
      await database.exec('CREATE ROLE observer NOLOGIN; GRANT SELECT ON data_foundry.verticals TO observer;');
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /runtime grant verification/i,
      );
      await database.exec(`
        REVOKE SELECT ON data_foundry.verticals FROM observer;
        CREATE FOREIGN DATA WRAPPER verification_drift_wrapper NO HANDLER;
        CREATE SERVER verification_drift_server FOREIGN DATA WRAPPER verification_drift_wrapper;
        CREATE FOREIGN TABLE data_foundry.verification_drift_foreign (id integer)
          SERVER verification_drift_server;
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /relation inventory drift/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects WITH GRANT OPTION even when the underlying privilege is expected', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(
        'GRANT SELECT ON data_foundry.verticals TO df_edge WITH GRANT OPTION',
      );
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /complete private direct ACL drift/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects direct foreign-server and foreign-data-wrapper privileges outside data_foundry', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE FOREIGN DATA WRAPPER external_acl_wrapper NO HANDLER;
        CREATE SERVER external_acl_server FOREIGN DATA WRAPPER external_acl_wrapper;
        GRANT USAGE ON FOREIGN DATA WRAPPER external_acl_wrapper TO df_edge;
        GRANT USAGE ON FOREIGN SERVER external_acl_server TO df_web;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/outside data_foundry/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects a runtime role named in an external default ACL', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO df_edge');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/outside data_foundry/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('stages NOLOGIN grants before a direct LOGIN credential transition', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/direct LOGIN/i);
      await database.exec(
        RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'),
      );
      await database.exec(plan.postMigrationGrants.postCredentialVerificationSql);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses a missing canonical object before granting anything', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('ALTER TABLE data_foundry.media_assets RENAME TO missing_media_assets');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/canonical object inventory/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(state?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses unexpected existing target privileges instead of normalizing them', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('GRANT SELECT ON data_foundry.verticals TO df_edge');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/unexpected existing private privileges/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ old_grant: boolean; new_grant: boolean }>(`
        SELECT has_table_privilege('df_edge', 'data_foundry.verticals', 'SELECT') AS old_grant,
               has_table_privilege('df_edge', 'data_foundry.entities', 'SELECT') AS new_grant
      `);
      expect(state).toEqual({ old_grant: true, new_grant: false });
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses any private SECURITY DEFINER function before granting anything', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(
        'ALTER FUNCTION data_foundry.scheduled_acquisition_validators_valid(jsonb) SECURITY DEFINER',
      );
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/SECURITY DEFINER/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_acquisition', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(state?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);
});
