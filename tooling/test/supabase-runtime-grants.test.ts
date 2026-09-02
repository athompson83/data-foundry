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
        /reachable external data\/custom-routine capability/i,
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
        /reachable external data\/custom-routine capability/i,
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
        /reachable external data\/custom-routine capability/i,
      );

      await database.exec('DROP TABLE extensions.runtime_public_relation');
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).resolves.toBeUndefined();

      await database.exec(`
        CREATE FUNCTION extensions.runtime_custom_function()
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `);
      await expect(database.exec(plan.postMigrationGrants.verificationSql)).rejects.toThrow(
        /reachable external data\/custom-routine capability/i,
      );
    } finally {
      await database.close();
    }
  }, 120_000);

  it('refuses a reachable external relation before issuing any runtime grants', async () => {
    const { database, plan } = await createMigratedDatabase();
    try {
      await database.exec(`
        CREATE TABLE public.pregrant_runtime_relation (id integer);
        GRANT SELECT ON public.pregrant_runtime_relation TO PUBLIC;
      `);
      await expect(
        database.exec(`BEGIN;\n${plan.postMigrationGrants.sql}\nCOMMIT;`),
      ).rejects.toThrow(/reachable external data\/custom-routine capability/i);
      await database.exec('ROLLBACK').catch(() => undefined);
      const [state] = await database.query<{ has_usage: boolean }>(
        "SELECT has_schema_privilege('df_edge', 'data_foundry', 'USAGE') AS has_usage",
      );
      expect(state?.has_usage).toBe(false);
    } finally {
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
      ).rejects.toThrow(/reachable external data\/custom-routine capability/i);
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
        /reachable external data\/custom-routine capability/i,
      );
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
