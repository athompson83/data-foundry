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
  buildRuntimeRoleReachableExternalCapabilitySql,
  PRIVATE_CANARY_RUNTIME_BINDING_SQL,
} from '@data-foundry/private-canary';
import { createCanonicalStore, type SqlDriver } from '@data-foundry/canonical-store';
import type { IsoDateTime } from '@data-foundry/canonical-schema';

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
    CREATE ROLE df_migration LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT df_migration TO postgres;
    ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    GRANT USAGE ON SCHEMA extensions TO df_migration;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    ${RUNTIME_ROLES.map((role) => `CREATE ROLE ${role} NOLOGIN NOINHERIT;`).join('\n    ')}
    ${RUNTIME_ROLES.map((role) => `GRANT USAGE ON SCHEMA extensions TO ${role};`).join('\n    ')}
    DO $runtime_database_connect$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_edge');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_web');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_mcp');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_usage');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_acquisition');
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), 'df_migration');
    END
    $runtime_database_connect$;
    DO $runtime_database_settings$
    BEGIN
      EXECUTE format('ALTER ROLE df_migration IN DATABASE %I SET search_path TO data_foundry, pg_catalog, extensions', current_database());
      ${RUNTIME_ROLES.map(
        (role) =>
          `EXECUTE format('ALTER ROLE ${role} IN DATABASE %I SET search_path TO data_foundry, pg_catalog, extensions', current_database());`,
      ).join('\n      ')}
    END
    $runtime_database_settings$;
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
  await database.exec('REVOKE CONNECT ON DATABASE runtime_grant_wrong_target FROM PUBLIC');
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
    expect(first.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "data_foundry"."sources" TO "df_acquisition";',
    );
    expect(first.sql).toContain(
      'GRANT UPDATE ("kill_switch_engaged") ON TABLE "data_foundry"."sources" TO "df_acquisition";',
    );
    expect(first.sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "data_foundry"."source_artifacts" TO "df_acquisition";',
    );
    expect(first.sql).not.toMatch(
      /GRANT[^;]*UPDATE ON TABLE "data_foundry"\."(?:sources|source_artifacts)"/,
    );
    expect(first.functionSignatures).toHaveLength(57);
    expect(first.expectedGrants).toHaveLength(199);
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
    expect(first.sql).toContain('has_parameter_privilege');
    expect(first.sql).toContain("('SET'::text), ('ALTER SYSTEM'::text)");
    expect(first.sql).toContain('pg_catalog.pg_largeobject_metadata');
    expect(first.sql).toContain('pg_catalog.aclexplode(large_object.lomacl)');
    expect(first.sql).toContain('large_object.lomowner = runtime_role.oid');
    expect(first.sql).toContain('acl.grantee = 0');
    expect(first.sql).toContain("('SELECT'::text), ('UPDATE'::text)");
    expect(first.sql).toContain("current_setting('lo_compat_privileges') = 'on'");
    expect(first.sql).not.toContain('has_largeobject_privilege');
    expect(first.sql).toContain(
      'default_acl_object_types(catalog_object_type, default_object_type)',
    );
    expect(first.sql).toContain(`('S'::"char", 's'::"char")`);
    expect(first.sql).toContain(
      'pg_catalog.acldefault(default_acl_type.default_object_type, migration_owner.oid)',
    );
    expect(first.sql).toContain("default_acl.defaclobjtype IN ('f', 'r', 'S')");
    expect(first.sql).toContain("'non_owner_default_privilege'::text");
    expect(first.sql).toContain('acl.grantee <> source.migration_owner_oid');
    expect(first.sql).toContain('pg_catalog.pg_db_role_setting');
    expect(first.sql).toContain('setting.setdatabase = 0');
    expect(first.sql).toContain('setting.setdatabase IN (0, database.oid)');
    expect(first.sql).toContain("setting.setconfig IS DISTINCT FROM ARRAY['search_path=data_foundry, pg_catalog, extensions']::text[]");
    expect(first.sql).toContain("'lo_compat_privileges'");
    expect(first.sql).toContain("'session_replication_role'");
    expect(first.sql).toContain('r.rolinherit');
    expect(first.verificationSql).toContain('WHERE false');
    expect(first.postCredentialVerificationSql).toContain('WHERE true');
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
               has_table_privilege('df_acquisition', 'data_foundry.sources', 'UPDATE') AS acquisition_relation_update,
               has_column_privilege('df_acquisition', 'data_foundry.sources', 'kill_switch_engaged', 'UPDATE') AS acquisition_kill_switch_update,
               has_table_privilege('df_acquisition', 'data_foundry.source_artifacts', 'UPDATE') AS acquisition_artifact_update,
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
        acquisition_relation_update: false,
        acquisition_kill_switch_update: true,
        acquisition_artifact_update: false,
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

  it('allows inert public types but refuses public data and custom SECURITY DEFINER reachability', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        CREATE SCHEMA runtime_inert;
        REVOKE ALL ON SCHEMA runtime_inert FROM PUBLIC;
        CREATE TABLE runtime_inert.publicly_granted_relation (id integer);
        GRANT SELECT ON runtime_inert.publicly_granted_relation TO PUBLIC;
        CREATE FUNCTION runtime_inert.publicly_executable_definer()
          RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      `);

      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();
      const [inertBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(inertBinding?.privilege_matrix_is_exact).toBe(true);

      await database.exec('CREATE TABLE public.runtime_public_relation (id integer)');
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();
      const [inertPublicBinding] = await database.query<{
        readonly privilege_matrix_is_exact: boolean;
      }>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, ['df_edge']);
      expect(inertPublicBinding?.privilege_matrix_is_exact).toBe(true);

      await database.exec('GRANT SELECT ON public.runtime_public_relation TO PUBLIC');
      const [relationAccess] = await database.query<{
        readonly schema_usage: boolean;
        readonly relation_select: boolean;
      }>(`
        SELECT has_schema_privilege('df_edge', 'public', 'USAGE') AS schema_usage,
               has_table_privilege('df_edge', 'public.runtime_public_relation', 'SELECT') AS relation_select
      `);
      expect(relationAccess).toEqual({ schema_usage: true, relation_select: true });
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
      const [relationBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(relationBinding?.privilege_matrix_is_exact).toBe(false);

      await database.exec(`
        DROP TABLE public.runtime_public_relation;
        CREATE FUNCTION public.runtime_public_definer()
          RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      `);
      const [functionAccess] = await database.query<{
        readonly schema_usage: boolean;
        readonly function_execute: boolean;
        readonly security_definer: boolean;
      }>(`
        SELECT has_schema_privilege('df_edge', 'public', 'USAGE') AS schema_usage,
               has_function_privilege('df_edge', 'public.runtime_public_definer()', 'EXECUTE') AS function_execute,
               (SELECT prosecdef FROM pg_proc WHERE oid = 'public.runtime_public_definer()'::regprocedure)
                 AS security_definer
      `);
      expect(functionAccess).toEqual({
        schema_usage: true,
        function_execute: true,
        security_definer: true,
      });
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
      const [functionBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(functionBinding?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('does not trust the extensions namespace for custom data or callable routines', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        CREATE FUNCTION extensions.runtime_trigger_helper()
          RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();

      await database.exec(`
        CREATE TABLE extensions.runtime_public_relation (id integer);
        GRANT SELECT ON extensions.runtime_public_relation TO PUBLIC;
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );

      await database.exec('DROP TABLE extensions.runtime_public_relation');
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();

      await database.exec(`
        CREATE FUNCTION extensions.runtime_custom_function()
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects ownership of an extension member outside relation, routine, and type catalogs', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary
          (TEMPLATE = pg_catalog.simple);
        ALTER TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary OWNER TO df_edge;
        ALTER EXTENSION plpgsql ADD TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary;
      `);

      const [extensionMember] = await database.query<{
        description: string;
        owner_name: string;
      }>(`
        SELECT pg_catalog.pg_describe_object(member.classid, member.objid, member.objsubid)::text
                 AS description,
               pg_catalog.pg_get_userbyid(owner_dependency.refobjid)::text AS owner_name
          FROM pg_catalog.pg_depend member
          JOIN pg_catalog.pg_extension extension ON extension.oid = member.refobjid
          JOIN pg_catalog.pg_shdepend owner_dependency
            ON owner_dependency.dbid = (
                 SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()
               )
           AND owner_dependency.classid = member.classid
           AND owner_dependency.objid = member.objid
           AND owner_dependency.objsubid = member.objsubid
           AND owner_dependency.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
           AND owner_dependency.deptype = 'o'
         WHERE extension.extname = 'plpgsql'
           AND member.objsubid = 0
           AND member.refobjsubid = 0
           AND member.deptype = 'e'
           AND pg_catalog.pg_describe_object(member.classid, member.objid, member.objsubid)
                 LIKE '%runtime_owned_dictionary%'
      `);
      expect(extensionMember).toEqual({
        description: 'text search dictionary extensions.runtime_owned_dictionary',
        owner_name: 'df_edge',
      });
      const migrationModeCapabilities = await database.query<{
        scope: string;
        object_name: string;
        role_name: string;
        privilege: string;
      }>(
        buildRuntimeRoleReachableExternalCapabilitySql(
          'data_foundry',
          "runtime_role.rolname = 'df_edge'",
          false,
        ),
      );
      expect(migrationModeCapabilities).toContainEqual({
        scope: 'extension_member',
        object_name: 'text search dictionary extensions.runtime_owned_dictionary',
        role_name: 'df_edge',
        privilege: 'OWNER',
      });
      expect(migrationModeCapabilities.some(({ scope }) => scope === 'owned_object')).toBe(false);

      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/reachable external capability/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(`
        ALTER EXTENSION plpgsql DROP TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary;
        ALTER TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary OWNER TO postgres;
        DROP TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary;
      `);
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        CREATE TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary
          (TEMPLATE = pg_catalog.simple);
        ALTER TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary OWNER TO df_edge;
        ALTER EXTENSION plpgsql ADD TEXT SEARCH DICTIONARY extensions.runtime_owned_dictionary;
      `);

      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /reachable external capability/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/reachable external capability/i);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    {
      name: 'non-extension text-search dictionary',
      createSql: `
        CREATE TEXT SEARCH DICTIONARY extensions.runtime_unmanaged_dictionary
          (TEMPLATE = pg_catalog.simple);
        ALTER TEXT SEARCH DICTIONARY extensions.runtime_unmanaged_dictionary OWNER TO df_edge;
      `,
      cleanupSql: [
        `ALTER TEXT SEARCH DICTIONARY extensions.runtime_unmanaged_dictionary OWNER TO postgres;
         DROP TEXT SEARCH DICTIONARY extensions.runtime_unmanaged_dictionary;`,
      ],
      postCreateSql: undefined,
    },
    {
      name: 'foreign server',
      createSql: `
        CREATE FOREIGN DATA WRAPPER runtime_owner_test_fdw NO HANDLER;
        CREATE SERVER runtime_owned_server FOREIGN DATA WRAPPER runtime_owner_test_fdw;
        ALTER SERVER runtime_owned_server OWNER TO df_edge;
      `,
      cleanupSql: [
        `ALTER SERVER runtime_owned_server OWNER TO postgres;
         DROP SERVER runtime_owned_server;
         DROP FOREIGN DATA WRAPPER runtime_owner_test_fdw;`,
      ],
      postCreateSql: undefined,
    },
    {
      name: 'shared database object',
      createSql: 'CREATE DATABASE runtime_owned_database OWNER df_edge;',
      cleanupSql: [
        'ALTER DATABASE runtime_owned_database OWNER TO postgres;',
        'DROP DATABASE runtime_owned_database;',
      ],
      postCreateSql: `
        REVOKE CONNECT ON DATABASE runtime_owned_database FROM PUBLIC;
        REVOKE ALL PRIVILEGES ON DATABASE runtime_owned_database FROM df_edge;
      `,
    },
  ])(
    'rejects runtime ownership of a $name in every generated guard',
    async ({ name, createSql, cleanupSql, postCreateSql }) => {
      const { database, plan } = await createMigratedDatabase();
      try {
        await database.exec(createSql);
        if (postCreateSql !== undefined) {
          await database.exec(postCreateSql);
        }
        const [ownedObject] = await database.query<{ owned_count: number }>(`
        SELECT count(*)::int AS owned_count
          FROM pg_catalog.pg_shdepend ownership
         WHERE ownership.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
           AND ownership.refobjid = 'df_edge'::pg_catalog.regrole
           AND ownership.deptype = 'o'
           AND ownership.objsubid = 0
        `);
        expect(ownedObject?.owned_count).toBe(1);
        if (name === 'shared database object') {
          const [databaseIdentity] = await database.query<{
            database_oid: number;
            catalog_class_oid: number;
          }>(`
            SELECT database.oid::int AS database_oid,
                   'pg_catalog.pg_database'::pg_catalog.regclass::oid::int AS catalog_class_oid
              FROM pg_catalog.pg_database database
             WHERE database.datname = 'runtime_owned_database'
          `);
          const reachableCapabilities = await database.query<{
            scope: string;
            object_name: string;
            role_name: string;
            privilege: string;
          }>(
            buildRuntimeRoleReachableExternalCapabilitySql(
              'data_foundry',
              "runtime_role.rolname = 'df_edge'",
            ),
          );
          expect(reachableCapabilities).toContainEqual({
            scope: 'owned_object',
            object_name: `0:${databaseIdentity?.catalog_class_oid}:${databaseIdentity?.database_oid}:0`,
            role_name: 'df_edge',
            privilege: 'OWNER',
          });
        }

        await expect(
          database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
        ).rejects.toThrow(/reachable external capability/i);
        await database.exec('ROLLBACK').catch(() => undefined);
        const [preGrantState] = await database.query<{ has_usage: boolean }>(
          "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
        );
        expect(preGrantState?.has_usage).toBe(false);

        for (const cleanupStatement of cleanupSql) {
          await database.exec(cleanupStatement);
        }
        await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
        await database.exec(createSql);
        if (postCreateSql !== undefined) {
          await database.exec(postCreateSql);
        }

        await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
          /reachable external capability/i,
        );
        await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
        await expect(
          database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
        ).rejects.toThrow(/reachable external capability/i);
        const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
          PRIVATE_CANARY_RUNTIME_BINDING_SQL,
          ['df_edge'],
        );
        expect(binding?.privilege_matrix_is_exact).toBe(false);
      } finally {
        await database.close();
      }
    },
    120_000,
  );

  it.each(['verificationSql', 'postCredentialVerificationSql'] as const)(
    'enforces migration posture, external confinement, and session safety in %s',
    async (verifierName) => {
      const { database, plan } = await createMigratedDatabase();
      try {
        await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
        if (verifierName === 'postCredentialVerificationSql') {
          await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
        }
        const verifier = plan.postMigrationGrants[verifierName];
        const scenarios = [
          {
            apply: 'ALTER ROLE df_migration INHERIT;',
            revert: 'ALTER ROLE df_migration NOINHERIT;',
            message: /migration-role posture is unsafe/i,
          },
          {
            apply: 'ALTER ROLE df_migration SET lo_compat_privileges TO on;',
            revert: 'ALTER ROLE df_migration RESET lo_compat_privileges;',
            message: /migration-role durable settings are unsafe/i,
          },
          {
            apply: `CREATE TABLE public.migration_external_probe (id integer);
                    GRANT SELECT ON public.migration_external_probe TO df_migration;`,
            revert: `REVOKE SELECT ON public.migration_external_probe FROM df_migration;
                     DROP TABLE public.migration_external_probe;`,
            message: /migration-role external capability is unsafe/i,
          },
          {
            apply: `CREATE TABLE public.migration_owned_probe (id integer);
                    ALTER TABLE public.migration_owned_probe OWNER TO df_migration;`,
            revert: `ALTER TABLE public.migration_owned_probe OWNER TO postgres;
                     DROP TABLE public.migration_owned_probe;`,
            message: /migration-role external capability is unsafe/i,
          },
          {
            apply: 'SET lo_compat_privileges TO on;',
            revert: 'RESET lo_compat_privileges;',
            message: /migration session is unsafe/i,
          },
        ] as const;

        for (const scenario of scenarios) {
          await database.exec(scenario.apply);
          await expect(database.exec(verifier)).rejects.toThrow(scenario.message);
          const [unsafeBinding] = await database.query<{
            readonly privilege_matrix_is_exact: boolean;
          }>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, ['df_edge']);
          expect(unsafeBinding?.privilege_matrix_is_exact).toBe(false);
          await database.exec(scenario.revert);
          const [restoredBinding] = await database.query<{
            readonly privilege_matrix_is_exact: boolean;
          }>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, ['df_edge']);
          expect(restoredBinding?.privilege_matrix_is_exact).toBe(true);
        }
      } finally {
        await database.close();
      }
    },
    120_000,
  );

  it('refuses a reachable external relation before issuing any runtime grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE TABLE public.pregrant_runtime_relation (id integer);
        GRANT SELECT ON public.pregrant_runtime_relation TO PUBLIC;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(state?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects migration-role durable-setting drift before grants and in live readiness', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('ALTER ROLE df_migration SET lo_compat_privileges TO on');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/canonical df_migration durable settings/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      const [unsafeBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(unsafeBinding?.privilege_matrix_is_exact).toBe(false);

      await database.exec('ALTER ROLE df_migration RESET lo_compat_privileges');
      await database.exec(`
        DO $migration_database_setting_drift$
        BEGIN
          EXECUTE format(
            'ALTER ROLE df_migration IN DATABASE %I SET search_path TO public',
            current_database()
          );
        END
        $migration_database_setting_drift$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/canonical df_migration durable settings/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [noncanonicalBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(noncanonicalBinding?.privilege_matrix_is_exact).toBe(false);
      await database.exec(`
        DO $migration_database_setting_restore$
        BEGIN
          EXECUTE format(
            'ALTER ROLE df_migration IN DATABASE %I SET search_path TO data_foundry, pg_catalog, extensions',
            current_database()
          );
        END
        $migration_database_setting_restore$;
      `);
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();
      const [restoredBinding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(restoredBinding?.privilege_matrix_is_exact).toBe(true);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC-derived CREATE on every database before grants and in every verifier', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('CREATE DATABASE runtime_public_create_escape');
      await database.exec('REVOKE CONNECT ON DATABASE runtime_public_create_escape FROM PUBLIC');
      await database.exec('GRANT CREATE ON DATABASE runtime_public_create_escape TO PUBLIC');
      const [effectivePrivilege] = await database.query<{
        migration_connect: boolean;
        migration_create: boolean;
        runtime_connect: boolean;
        runtime_create: boolean;
      }>(`
        SELECT has_database_privilege('df_migration', 'runtime_public_create_escape', 'CREATE') AS migration_create,
               has_database_privilege('df_edge', 'runtime_public_create_escape', 'CREATE') AS runtime_create,
               has_database_privilege('df_migration', 'runtime_public_create_escape', 'CONNECT') AS migration_connect,
               has_database_privilege('df_edge', 'runtime_public_create_escape', 'CONNECT') AS runtime_connect
      `);
      expect(effectivePrivilege).toEqual({
        migration_connect: false,
        migration_create: true,
        runtime_connect: false,
        runtime_create: true,
      });
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);

      await database.exec('REVOKE CREATE ON DATABASE runtime_public_create_escape FROM PUBLIC');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT CREATE ON DATABASE runtime_public_create_escape TO PUBLIC');
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/migration-role external capability/i);
    } finally {
      await database.exec('REVOKE CREATE ON DATABASE runtime_public_create_escape FROM PUBLIC').catch(() => undefined);
      await database.exec('DROP DATABASE runtime_public_create_escape').catch(() => undefined);
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC-derived CONNECT to another live database before grants and in every verifier', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('CREATE DATABASE runtime_public_connect_escape');
      const [effectivePrivilege] = await database.query<{ migration_connect: boolean; runtime_connect: boolean }>(`
        SELECT has_database_privilege('df_migration', 'runtime_public_connect_escape', 'CONNECT') AS migration_connect,
               has_database_privilege('df_edge', 'runtime_public_connect_escape', 'CONNECT') AS runtime_connect
      `);
      expect(effectivePrivilege).toEqual({ migration_connect: true, runtime_connect: true });
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);

      await database.exec('REVOKE CONNECT ON DATABASE runtime_public_connect_escape FROM PUBLIC');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT CONNECT ON DATABASE runtime_public_connect_escape TO PUBLIC');
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/migration-role external capability/i);
    } finally {
      await database.exec('REVOKE CONNECT ON DATABASE runtime_public_connect_escape FROM PUBLIC').catch(() => undefined);
      await database.exec('DROP DATABASE runtime_public_connect_escape').catch(() => undefined);
      await database.close();
    }
  }, 120_000);

  it('refuses PUBLIC-derived current-database CREATE before issuing any runtime grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        DO $public_database_create$
        BEGIN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO PUBLIC', current_database());
        END
        $public_database_create$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(state?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('reconciles the previously hosted broad acquisition UPDATE grants during 0027', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        BEGIN;
        ${plan.postMigrationGrants.sql}
        COMMIT;
        REVOKE UPDATE (kill_switch_engaged) ON data_foundry.sources FROM df_acquisition;
        GRANT UPDATE ON data_foundry.sources TO df_acquisition;
        GRANT UPDATE ON data_foundry.source_artifacts TO df_acquisition;
      `);
      const [before] = await database.query<Record<string, boolean>>(`
        SELECT has_table_privilege('df_acquisition', 'data_foundry.sources', 'UPDATE') AS sources_update,
               has_table_privilege('df_acquisition', 'data_foundry.source_artifacts', 'UPDATE') AS artifacts_update
      `);
      expect(before).toEqual({ sources_update: true, artifacts_update: true });

      const migration = plan.packets.find((packet) => packet.version === '0027');
      expect(migration).toBeDefined();
      await database.exec(`
        BEGIN;
        SET LOCAL ROLE df_migration;
        SET LOCAL search_path TO data_foundry, pg_catalog, extensions;
        ${migration!.transformedSql}
        COMMIT;
      `);

      await database.exec(plan.postMigrationGrants.verificationSql);
      const [after] = await database.query<Record<string, boolean>>(`
        SELECT has_table_privilege('df_acquisition', 'data_foundry.sources', 'UPDATE') AS sources_update,
               has_column_privilege('df_acquisition', 'data_foundry.sources', 'kill_switch_engaged', 'UPDATE') AS kill_switch_update,
               has_table_privilege('df_acquisition', 'data_foundry.source_artifacts', 'UPDATE') AS artifacts_update
      `);
      expect(after).toEqual({
        sources_update: false,
        kill_switch_update: true,
        artifacts_update: false,
      });
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    {
      name: 'partial legacy relation grant',
      sql: `REVOKE UPDATE (kill_switch_engaged) ON data_foundry.sources FROM df_acquisition;
            GRANT UPDATE ON data_foundry.sources TO df_acquisition;`,
    },
    {
      name: 'extra source column grant',
      sql: 'GRANT UPDATE (status) ON data_foundry.sources TO df_acquisition;',
    },
  ])('refuses $name before changing acquisition ACLs', async ({ sql }) => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;\n${sql}`);
      const migration = plan.packets.find((packet) => packet.version === '0027');
      await expect(database.exec(`
        BEGIN;
        SET LOCAL ROLE df_migration;
        SET LOCAL search_path TO data_foundry, pg_catalog, extensions;
        ${migration!.transformedSql}
        COMMIT;
      `)).rejects.toThrow(/unexpected acquisition UPDATE ACL/i);
      await database.exec('ROLLBACK').catch(() => undefined);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('verifies every private function has the exact pinned runtime search path', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(plan.postMigrationGrants.verificationSql);
      await database.exec(`
        ALTER FUNCTION data_foundry.scheduled_acquisition_validators_valid(jsonb)
        SET search_path TO public
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /function search path/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses function search-path drift before granting any runtime privilege', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        ALTER FUNCTION data_foundry.scheduled_acquisition_validators_valid(jsonb)
        SET search_path TO public
      `);
      await expect(database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`)).rejects.toThrow(
        /function search path/i,
      );
      await database.exec('ROLLBACK').catch(() => undefined);
      const [privileges] = await database.query<{
        readonly schema_usage: boolean;
        readonly verticals_select: boolean;
      }>(`
        SELECT has_schema_privilege('df_acquisition', 'data_foundry', 'USAGE') AS schema_usage,
               has_table_privilege('df_acquisition', 'data_foundry.verticals', 'SELECT') AS verticals_select
      `);
      expect(privileges).toEqual({ schema_usage: false, verticals_select: false });
    } finally {
      await database.close();
    }
  }, 120_000);

  it('enforces acquisition-role source and artifact boundaries while preserving normal persistence', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        BEGIN;
        ${plan.postMigrationGrants.sql}
        COMMIT;
        ALTER ROLE df_acquisition LOGIN;
        SET SESSION AUTHORIZATION df_acquisition;
        SET search_path TO data_foundry, pg_catalog, extensions;
      `);
      const store = createCanonicalStore(database as unknown as SqlDriver);
      const vertical = await store.registerVertical({
        slug: 'runtime-acquisition',
        name: 'Runtime acquisition',
        schema_version: '1.0.0',
        status: 'ACTIVE',
        default_refresh_policy: { cadence: 'DAILY', max_staleness_hours: 24, priority: 50 },
      });
      const sourceInput = {
        vertical_id: vertical.id,
        publisher: 'Runtime fixture',
        domain: 'runtime-acquisition.example',
        source_type: 'OTHER' as const,
        authority_rank: 50,
        rights_classification: 'GREEN' as const,
        attribution_requirement: { required: false, text: null, url: null },
        robots_policy: {
          respect_robots: true,
          user_agent: 'data-foundry-bot',
          crawl_delay_seconds: 1,
          disallowed_paths: [],
          allowed_paths: [],
          robots_url: null,
          snapshot_hash: null,
          snapshot_at: null,
        },
        refresh_cadence: 'DAILY' as const,
        status: 'ACTIVE' as const,
      };
      const source = await store.registerSource({ ...sourceInput, kill_switch_engaged: false });

      for (const statement of [
        `UPDATE sources SET rights_classification = 'RED' WHERE id = '${source.id}'`,
        `UPDATE sources SET status = 'PAUSED' WHERE id = '${source.id}'`,
        `UPDATE sources SET robots_policy = '{}'::jsonb WHERE id = '${source.id}'`,
      ]) {
        await expect(database.exec(statement)).rejects.toThrow(/permission denied/i);
      }

      await database.exec(`UPDATE sources SET kill_switch_engaged = TRUE WHERE id = '${source.id}'`);
      const [afterEngage] = await database.query<{ updated_at: string }>(
        `SELECT updated_at::text FROM sources WHERE id = '${source.id}'`,
      );
      expect(Date.parse(afterEngage!.updated_at)).toBeGreaterThan(Date.parse(source.updated_at));
      await expect(
        database.exec(`UPDATE sources SET kill_switch_engaged = FALSE WHERE id = '${source.id}'`),
      ).rejects.toThrow(/kill switch/i);
      const engaged = await store.registerSource({ ...sourceInput, kill_switch_engaged: true });
      expect(engaged.kill_switch_engaged).toBe(true);
      expect(Date.parse(engaged.updated_at)).toBe(Date.parse(afterEngage!.updated_at));

      const artifactInput = {
        source_id: source.id,
        url: 'https://runtime-acquisition.example/artifact',
        retrieved_at: '2026-09-02T12:00:00.000Z' as IsoDateTime,
        content_hash: 'a'.repeat(64),
        mime_type: 'application/json',
        r2_uri: 'r2://data-foundry-raw-artifacts/runtime-acquisition/a.json',
        http_status: 200,
        extractor_version: 'runtime-test@1.0.0',
        policy_snapshot_id: null,
        byte_size: 128,
        acquisition_provider: 'http',
        acquisition_route: 'DIRECT_HTTP' as const,
        account_or_product_plan: null,
        acquisition_jurisdiction: null,
      };
      const artifact = await store.recordSourceArtifact(artifactInput);
      expect((await store.recordSourceArtifact(artifactInput)).id).toBe(artifact.id);
      for (const statement of [
        `UPDATE source_artifacts SET http_status = 204 WHERE id = '${artifact.id}'`,
        `UPDATE source_artifacts SET r2_uri = 'r2://tampered' WHERE id = '${artifact.id}'`,
      ]) {
        await expect(database.exec(statement)).rejects.toThrow(/permission denied/i);
      }
      await database.exec(`
        SET SESSION AUTHORIZATION df_migration;
        SET search_path TO data_foundry, pg_catalog, extensions;
      `);
      await database.exec(`UPDATE data_foundry.sources SET kill_switch_engaged = FALSE WHERE id = '${source.id}'`);
      const [ownerCleared] = await database.query<{ kill_switch_engaged: boolean }>(
        `SELECT kill_switch_engaged FROM data_foundry.sources WHERE id = '${source.id}'`,
      );
      expect(ownerCleared?.kill_switch_engaged).toBe(false);
    } finally {
      await database.exec('RESET SESSION AUTHORIZATION').catch(() => undefined);
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

  it('rejects PUBLIC-derived current-database CREATE in verification and runtime binding', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        DO $public_database_create$
        BEGIN
          EXECUTE format('GRANT CREATE ON DATABASE %I TO PUBLIC', current_database());
        END
        $public_database_create$;
      `);
      const [effectivePrivilege] = await database.query<{ database_create: boolean }>(`
        SELECT has_database_privilege('df_edge', current_database(), 'CREATE') AS database_create
      `);
      expect(effectivePrivilege?.database_create).toBe(true);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC-derived parameter privileges before grants and in every runtime check', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('GRANT SET ON PARAMETER session_replication_role TO PUBLIC');
      const [effectivePrivilege] = await database.query<{ parameter_set: boolean }>(`
        SELECT has_parameter_privilege('df_edge', 'session_replication_role', 'SET') AS parameter_set
      `);
      expect(effectivePrivilege?.parameter_set).toBe(true);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec('REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT SET ON PARAMETER session_replication_role TO PUBLIC');
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects PUBLIC-derived large-object privileges before grants and in every runtime check', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        SELECT lo_from_bytea(4242, decode('cafe', 'hex'));
        GRANT SELECT, UPDATE ON LARGE OBJECT 4242 TO PUBLIC;
        SET ROLE df_edge;
      `);
      const [readable] = await database.query<{ bytes: string }>(`
        SELECT encode(lo_get(4242), 'hex') AS bytes
      `);
      expect(readable?.bytes).toBe('cafe');
      await database.exec(`
        SELECT lo_put(4242, 0, decode('beef', 'hex'));
        RESET ROLE;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec('REVOKE SELECT, UPDATE ON LARGE OBJECT 4242 FROM PUBLIC');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('GRANT SELECT, UPDATE ON LARGE OBJECT 4242 TO PUBLIC');
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects runtime-role large-object ownership but permits an ungranted administrator object', async () => {
    const first = await createMigratedDatabase();
    try {
      await first.database.exec("SELECT lo_from_bytea(4243, decode('cafe', 'hex'))");
      await expect(
        first.database.exec(`BEGIN;\n${first.plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).resolves.toBeUndefined();
      await expect(
        first.database.exec(first.plan.postMigrationGrants.verificationSql),
      ).resolves.toBeUndefined();
    } finally {
      await first.database.close();
    }

    const second = await createMigratedDatabase();
    try {
      await second.database.exec(`
        SET ROLE df_edge;
        SELECT lo_from_bytea(4244, decode('cafe', 'hex'));
        RESET ROLE;
      `);
      await expect(
        second.database.exec(`BEGIN;\n${second.plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/reachable external capability/i);
      await second.database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await second.database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);
    } finally {
      await second.database.close();
    }
  }, 120_000);

  it('rejects the PostgreSQL large-object compatibility bypass', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec("SET lo_compat_privileges = 'on'");
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/session_replication_role=origin and lo_compat_privileges=off/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('preserves NOLOGIN staging without durable rows but requires canonical rows for live verification', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        DO $reset_runtime_settings$
        BEGIN
          ${RUNTIME_ROLES.map(
            (role) =>
              `EXECUTE format('ALTER ROLE ${role} IN DATABASE %I RESET ALL', current_database());`,
          ).join('\n          ')}
        END
        $reset_runtime_settings$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).resolves.toBeUndefined();
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();

      const [bindingWithoutDurableRows] = await database.query<{
        readonly privilege_matrix_is_exact: boolean;
      }>(PRIVATE_CANARY_RUNTIME_BINDING_SQL, ['df_edge']);
      expect(bindingWithoutDurableRows?.privilege_matrix_is_exact).toBe(false);
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/runtime-role durable settings/i);

      await database.exec(`
        DO $restore_runtime_settings$
        BEGIN
          ${RUNTIME_ROLES.map(
            (role) =>
              `EXECUTE format('ALTER ROLE ${role} IN DATABASE %I SET search_path TO data_foundry, pg_catalog, extensions', current_database());`,
          ).join('\n          ')}
        END
        $restore_runtime_settings$;
      `);
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    {
      name: 'lo_compat_privileges',
      setClause: 'SET lo_compat_privileges TO on',
      resetClause: 'RESET lo_compat_privileges',
    },
    {
      name: 'session_replication_role',
      setClause: 'SET session_replication_role TO replica',
      resetClause: 'RESET session_replication_role',
    },
  ])('rejects a role-specific current-database $name override in every phase', async ({ setClause, resetClause }) => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        DO $set_unsafe_role_setting$
        BEGIN
          EXECUTE format('ALTER ROLE df_edge IN DATABASE %I ${setClause}', current_database());
        END
        $set_unsafe_role_setting$;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/staged runtime-role durable settings/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(`
        DO $reset_unsafe_role_setting$
        BEGIN
          EXECUTE format('ALTER ROLE df_edge IN DATABASE %I ${resetClause}', current_database());
        END
        $reset_unsafe_role_setting$;
      `);
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        DO $restore_unsafe_role_setting$
        BEGIN
          EXECUTE format('ALTER ROLE df_edge IN DATABASE %I ${setClause}', current_database());
        END
        $restore_unsafe_role_setting$;
      `);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /runtime-role durable settings/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/runtime-role durable settings/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects a dangerous ALTER ROLE ALL setting stored at database OID zero', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('ALTER ROLE ALL SET lo_compat_privileges TO on');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/canonical df_migration durable settings/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec('ALTER ROLE ALL RESET lo_compat_privileges');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('ALTER ROLE ALL SET lo_compat_privileges TO on');
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role durable settings/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/migration-role durable settings/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects every role-global runtime setting even when the value is otherwise inert', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec("ALTER ROLE df_edge SET statement_timeout TO '5s'");
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/staged runtime-role durable settings/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('requires NOINHERIT in the installer, both generated verifiers, and private canary', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec('ALTER ROLE df_edge INHERIT');
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/NOLOGIN, nonprivileged, non-member roles/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec('ALTER ROLE df_edge NOINHERIT');
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec('ALTER ROLE df_edge INHERIT');
      const [binding] = await database.query<{ readonly role_is_login_nonprivileged: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.role_is_login_nonprivileged).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /staged NOLOGIN roles/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/direct LOGIN roles/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses implicit or schema-added PUBLIC function defaults before issuing grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(
        'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
      );
      const [implicitDefault] = await database.query<{
        global_row_count: number;
        public_execute_is_effective: boolean;
      }>(`
        SELECT (
                 SELECT count(*)::int
                   FROM pg_default_acl
                  WHERE defaclrole = 'df_migration'::regrole
                    AND defaclnamespace = 0
                    AND defaclobjtype = 'f'
               ) AS global_row_count,
               EXISTS (
                 SELECT 1
                   FROM pg_roles owner
                   CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('f', owner.oid)) acl
                  WHERE owner.rolname = 'df_migration'
                    AND acl.grantee = 0
                    AND acl.privilege_type = 'EXECUTE'
               ) AS public_execute_is_effective
      `);
      expect(implicitDefault).toEqual({
        global_row_count: 0,
        public_execute_is_effective: true,
      });
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/default object ACL/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(`
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
          GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/default object ACL/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects later PUBLIC function-default drift in both verifiers and runtime binding', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(
        'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
      );
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /default object ACL/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/default object ACL/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('rejects a named observer in migration-owner object defaults before grants and after drift', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE ROLE observer NOLOGIN;
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration
          GRANT SELECT ON TABLES TO observer;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/default object ACL/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(`
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration
          REVOKE SELECT ON TABLES FROM observer;
      `);
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(`
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
          GRANT EXECUTE ON FUNCTIONS TO observer;
      `);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /default object ACL/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/default object ACL/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it.each([
    {
      name: 'global table',
      grantSql: 'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT SELECT ON TABLES TO PUBLIC',
      revokeSql: 'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE SELECT ON TABLES FROM PUBLIC',
    },
    {
      name: 'schema table',
      grantSql: `ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
        GRANT INSERT ON TABLES TO PUBLIC`,
      revokeSql: `ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
        REVOKE INSERT ON TABLES FROM PUBLIC`,
    },
    {
      name: 'global sequence',
      grantSql: 'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT USAGE ON SEQUENCES TO PUBLIC',
      revokeSql: 'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE USAGE ON SEQUENCES FROM PUBLIC',
    },
    {
      name: 'schema sequence',
      grantSql: `ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
        GRANT SELECT ON SEQUENCES TO PUBLIC`,
      revokeSql: `ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
        REVOKE SELECT ON SEQUENCES FROM PUBLIC`,
    },
  ])('rejects $name PUBLIC defaults before grants and after runtime drift', async ({ grantSql, revokeSql }) => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(grantSql);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/default object ACL/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(revokeSql);
      await database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`);
      await database.exec(grantSql);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /default object ACL/i,
      );
      await database.exec(RUNTIME_ROLES.map((role) => `ALTER ROLE ${role} LOGIN;`).join('\n'));
      await expect(
        database.exec(plan.postMigrationGrants.postCredentialVerificationSql),
      ).rejects.toThrow(/default object ACL/i);
    } finally {
      await database.close();
    }
  }, 120_000);

  it('keeps PUBLIC type defaults inert while enforcing object defaults that can expose runtime data or code', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry
          GRANT USAGE ON TYPES TO PUBLIC;
      `);
      const [typeDefault] = await database.query<{ public_usage_is_effective: boolean }>(`
        SELECT EXISTS (
          SELECT 1
            FROM pg_roles owner
            CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('T', owner.oid)) acl
           WHERE owner.rolname = 'df_migration'
             AND acl.grantee = 0
             AND acl.privilege_type = 'USAGE'
        ) AS public_usage_is_effective
      `);
      expect(typeDefault?.public_usage_is_effective).toBe(true);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).resolves.toBeUndefined();
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(true);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();
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

  it('rejects PUBLIC-inherited foreign-data-wrapper and server USAGE for migration and runtime roles', async () => {
    const { database, plan } = await createMigratedDatabase();
    const reachableFor = (role: string, rejectAllObjectOwnership = true) =>
      database.query<{ scope: string; object_name: string; privilege: string }>(
        buildRuntimeRoleReachableExternalCapabilitySql(
          'data_foundry',
          `runtime_role.rolname = '${role}'`,
          rejectAllObjectOwnership,
        ),
      );
    try {
      await database.exec(`
        CREATE FOREIGN DATA WRAPPER public_usage_wrapper NO HANDLER;
        CREATE SERVER public_usage_server FOREIGN DATA WRAPPER public_usage_wrapper;
        GRANT USAGE ON FOREIGN DATA WRAPPER public_usage_wrapper TO PUBLIC;
        GRANT USAGE ON FOREIGN SERVER public_usage_server TO PUBLIC;
      `);
      const runtimeReachable = await reachableFor('df_edge');
      const migrationReachable = await reachableFor('df_migration', false);
      for (const [roleName, reachable] of [
        ['df_edge', runtimeReachable],
        ['df_migration', migrationReachable],
      ] as const) {
        expect(reachable).toEqual(expect.arrayContaining([
          {
            scope: 'foreign_data_wrapper',
            object_name: 'public_usage_wrapper',
            role_name: roleName,
            privilege: 'USAGE',
          },
          {
            scope: 'foreign_server',
            object_name: 'public_usage_server',
            role_name: roleName,
            privilege: 'USAGE',
          },
        ]));
      }

      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/confined df_migration external privilege and ownership boundary/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [preGrantState] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(preGrantState?.has_usage).toBe(false);

      await database.exec(`
        REVOKE USAGE ON FOREIGN SERVER public_usage_server FROM PUBLIC;
        REVOKE USAGE ON FOREIGN DATA WRAPPER public_usage_wrapper FROM PUBLIC;
        BEGIN;
        ${plan.postMigrationGrants.sql}
        COMMIT;
        GRANT USAGE ON FOREIGN DATA WRAPPER public_usage_wrapper TO PUBLIC;
        GRANT USAGE ON FOREIGN SERVER public_usage_server TO PUBLIC;
      `);
      const [binding] = await database.query<{ readonly privilege_matrix_is_exact: boolean }>(
        PRIVATE_CANARY_RUNTIME_BINDING_SQL,
        ['df_edge'],
      );
      expect(binding?.privilege_matrix_is_exact).toBe(false);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /migration-role external capability/i,
      );
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
