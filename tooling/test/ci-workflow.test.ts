import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { migrationFailureMessage } from '../scripts/migrate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_VERIFY = "needs.scope.outputs.run_verify == 'true'";
const NON_DRAFT_EVENT = "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)";
const SCOPE_FAILURE_GUARD = "always() && needs.scope.result != 'success'";
const CANDIDATE_SHA_EXPRESSION = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
const CANDIDATE_SHA_REFERENCE = '${{ env.DATA_FOUNDRY_CANDIDATE_SHA }}';
const MIGRATION_SEARCH_PATH_REJECTION = migrationFailureMessage(
  new Error(
    'Direct private-schema migrations require the exact search_path data_foundry, pg_catalog, extensions throughout each migration transaction.',
  ),
  {
    DATA_FOUNDRY_MIGRATION_DATABASE_URL:
      'postgres://df_migration:fixture-only@db.invalid/data_foundry',
  },
);

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type Workflow = {
  env?: Record<string, string>;
  jobs: {
    scope: { steps: Step[] };
    verify: { if?: string; steps: Step[] };
    'migrations-postgres': { if?: string; steps: Step[] };
  };
};

const workflowSource = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const workflow = parseYaml(workflowSource) as Workflow;
const scopeScript = workflow.jobs.scope.steps.find((step) => step.id === 'changes')?.run ?? '';

function postgresScopePatterns(): readonly string[] {
  const caseArms = [...scopeScript.matchAll(/case "\$path" in([\s\S]*?)\n\s+esac/g)];
  const postgresArm = caseArms[1]?.[1];
  const protectedPatterns = postgresArm?.match(/\s+([^\n]+)\)\n\s+run_postgres=true/m)?.[1];
  if (protectedPatterns === undefined) throw new Error('CI scope selector has no real-Postgres branch.');
  return protectedPatterns.split('|');
}

function shellGlobMatches(path: string, pattern: string): boolean {
  const marker = '\u0000GLOBSTAR\u0000';
  const escaped = pattern
    .replaceAll('**', marker)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll(marker, '.*');
  return new RegExp(`^${escaped}$`).test(path);
}

function selectsRealPostgres(path: string): boolean {
  return postgresScopePatterns().some((pattern) => shellGlobMatches(path, pattern));
}

describe('CI workflow policy', () => {
  it('keeps both protected jobs present and fail-closed when scope selection fails', () => {
    const verify = workflow.jobs.verify;
    const postgres = workflow.jobs['migrations-postgres'];

    expect(verify.if).toBe(`always() && ${NON_DRAFT_EVENT}`);
    expect(postgres.if).toBe(
      `always() && ${NON_DRAFT_EVENT} && (needs.scope.result != 'success' || needs.scope.outputs.run_postgres == 'true')`,
    );
    for (const job of [verify, postgres]) {
      expect(job.steps[0]).toMatchObject({
        name: 'Fail when scope selection fails',
        if: SCOPE_FAILURE_GUARD,
        run: expect.stringContaining('exit 1'),
      });
    }
  });

  it('keeps documentation-only verification successful without installing dependencies', () => {
    const steps = workflow.jobs.verify.steps;
    const documentationOnly = steps.find((step) => step.name === 'Documentation-only change');
    const dependencySteps = steps.filter(
      (step) =>
        step.name !== 'Fail when scope selection fails' &&
        step.name !== 'Documentation-only change' &&
        !step.uses?.startsWith('actions/checkout@'),
    );

    expect(documentationOnly).toMatchObject({
      if: "needs.scope.outputs.run_verify != 'true'",
      run: expect.stringContaining('No executable or workflow files changed'),
    });
    expect(dependencySteps.length).toBeGreaterThan(0);
    for (const step of dependencySteps) {
      expect(step.if, step.name ?? step.uses).toBe(RUN_VERIFY);
    }
  });

  it('retains every verification command exactly once', () => {
    const commands = workflow.jobs.verify.steps.flatMap((step) => (step.run ? [step.run] : []));
    for (const command of [
      'pnpm typecheck',
      'pnpm test',
      'pnpm migrate:check',
      'pnpm schemas:check',
      'pnpm openapi:check',
      'pnpm cloudflare:topology:check',
      'pnpm verticals:validate',
      'pnpm verticals:compile:check',
      'pnpm acquisition:check',
      'pnpm mcp:compile:check',
      'pnpm web:compile:check',
      'pnpm cloudflare:artifacts:check',
    ]) {
      expect(commands.filter((candidate) => candidate === command), command).toHaveLength(1);
    }
  });

  it('labels the artifact gate as ordinary and six route-less private-canary artifacts', () => {
    const artifactGate = workflow.jobs.verify.steps.find((step) => step.run === 'pnpm cloudflare:artifacts:check');
    expect(artifactGate?.name).toBe(
      'Cloudflare ordinary and six route-less private-canary artifacts build and are PGlite-free',
    );
  });

  it('boots a disposable certificate-verified Postgres service and confines migration DDL to data_foundry', () => {
    const steps = workflow.jobs['migrations-postgres'].steps;
    const start = steps.find((step) => step.name === 'Start disposable TLS PostgreSQL');
    const bootstrap = steps.find((step) => step.name === 'Bootstrap narrow private migration role');
    const privateSchemaAcl = steps.find((step) => step.name === 'Verify raw private schema owner ACL baseline');
    const databaseCreateProbe = steps.find((step) => step.name === 'Refuse database-wide migration CREATE');
    const apply = steps.find((step) => step.name === 'Apply migrations to Postgres');

    expect(start?.run).toMatch(/hostssl\s+all\s+all\s+0\.0\.0\.0\/0\s+scram-sha-256/);
    expect(start?.run).toMatch(/hostnossl\s+all\s+all\s+0\.0\.0\.0\/0\s+reject/);
    expect(start?.run).toContain('NODE_EXTRA_CA_CERTS');
    expect(start?.run).toContain('DATA_FOUNDRY_MIGRATION_DATABASE_URL');
    expect(start?.run).toContain('DATA_FOUNDRY_RELEASE_SHA');
    expect(start?.run).toContain(`printf '::add-mask::%s\\n' "$postgres_password"`);
    expect(start?.run).toContain(`printf '::add-mask::%s\\n' "$migration_password"`);
    expect(start?.run?.indexOf('postgres_password="$(openssl rand -hex 24)"')).toBeLessThan(
      start?.run?.indexOf(`printf '::add-mask::%s\\n' "$postgres_password"`) ?? -1,
    );
    expect(start?.run?.indexOf(`printf '::add-mask::%s\\n' "$postgres_password"`)).toBeLessThan(
      start?.run?.indexOf('--env POSTGRES_PASSWORD="$postgres_password"') ?? -1,
    );
    expect(start?.run?.indexOf('migration_password="$(openssl rand -hex 24)"')).toBeLessThan(
      start?.run?.indexOf(`printf '::add-mask::%s\\n' "$migration_password"`) ?? -1,
    );
    expect(start?.run?.indexOf(`printf '::add-mask::%s\\n' "$migration_password"`)).toBeLessThan(
      start?.run?.indexOf('DATA_FOUNDRY_MIGRATION_DATABASE_URL=postgres://df_migration:%s') ?? -1,
    );
    expect(start?.run).toContain('classify_startup_failure()');
    expect(start?.run).toContain('on_startup_error()');
    expect(start?.run).toContain("trap 'on_startup_error' ERR");
    expect(start?.run).toContain("data-foundry-ci-postgres-startup: state=%s category=%s\\n");
    expect(start?.run).toContain(
      "printf 'data-foundry-ci-postgres-startup: state=%s category=%s\\n' \"$container_state\" \"$category\"",
    );
    for (const category of [
      'container-name-conflict',
      'port-conflict',
      'image-pull',
      'tls-file-access',
      'not-classified',
      'tls-directory',
      'certificate-generation',
      'tls-key-owner',
      'tls-key-mode',
      'credential-generation',
      'docker-start',
      'readiness',
      'environment-export',
    ]) {
      expect(start?.run).toContain(category);
    }
    expect(start?.run).toContain("startup_stage='tls-key-owner'");
    expect(start?.run).toContain("startup_stage='tls-key-mode'");
    expect(start?.run).toContain('sudo chmod 600 "$tls_dir/server.key"');
    expect(start?.run).toContain('docker logs "$container_name" 2>&1 | grep -Eqi');
    expect(bootstrap?.run).toContain('CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres');
    expect(bootstrap?.run).toContain('CREATE ROLE df_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(bootstrap?.run).toContain('CREATE SCHEMA IF NOT EXISTS data_foundry AUTHORIZATION df_migration');
    expect(bootstrap?.run).toContain('GRANT USAGE, CREATE ON SCHEMA data_foundry TO df_migration;');
    expect(bootstrap?.run).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
    expect(bootstrap?.run).toContain('REVOKE ALL PRIVILEGES ON SCHEMA data_foundry FROM PUBLIC;');
    expect(bootstrap?.run).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA data_foundry FROM PUBLIC;');
    expect(bootstrap?.run).toContain('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA data_foundry FROM PUBLIC;');
    expect(bootstrap?.run).toContain('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA data_foundry FROM PUBLIC;');
    expect(bootstrap?.run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;',
    );
    expect(bootstrap?.run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;',
    );
    expect(bootstrap?.run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    );
    expect(bootstrap?.run).not.toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;',
    );
    expect(bootstrap?.run).toContain('GRANT CONNECT ON DATABASE data_foundry TO df_migration;');
    expect(bootstrap?.run).toContain('REVOKE CREATE ON DATABASE data_foundry FROM df_migration;');
    expect(bootstrap?.run).not.toMatch(/GRANT\s+CONNECT\s*,\s*CREATE\s+ON\s+DATABASE\s+data_foundry\s+TO\s+df_migration/i);
    expect(bootstrap?.run).toContain('GRANT USAGE ON SCHEMA extensions TO df_migration');
    expect(bootstrap?.run).toContain(
      'ALTER ROLE df_migration IN DATABASE data_foundry SET search_path TO data_foundry, pg_catalog, extensions;',
    );
    expect(bootstrap?.run).toContain('REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;');
    expect(privateSchemaAcl?.run).toContain('CROSS JOIN LATERAL aclexplode(n.nspacl) acl');
    expect(privateSchemaAcl?.run).toContain("n.nspname = 'data_foundry'");
    expect(privateSchemaAcl?.run).toContain("COALESCE(grantee.rolname, 'PUBLIC')::text");
    expect(privateSchemaAcl?.run).toContain("'df_migration'::text, 'CREATE'::text, false");
    expect(privateSchemaAcl?.run).toContain("'df_migration'::text, 'USAGE'::text, false");
    expect(privateSchemaAcl?.run).toContain('EXCEPT ALL');
    expect(privateSchemaAcl?.run).toContain("nspowner = 'df_migration'::regrole");
    expect(privateSchemaAcl?.run).toContain('Private migration schema ACL baseline is not canonical.');
    expect(databaseCreateProbe?.run).toContain(
      "SELECT has_database_privilege('df_migration', current_database(), 'CREATE');",
    );
    expect(databaseCreateProbe?.run).toContain('effective_database_create');
    expect(databaseCreateProbe?.run).toContain('[[ "$effective_database_create" != "f" ]]');
    expect(databaseCreateProbe?.run).toContain('SET ROLE df_migration;');
    expect(databaseCreateProbe?.run).toContain(
      'probe_schema="data_foundry_ci_unrelated_probe_$(openssl rand -hex 12)"',
    );
    expect(databaseCreateProbe?.run).toContain('CREATE SCHEMA "$probe_schema";');
    expect(databaseCreateProbe?.run).toContain('-v probe_schema="$probe_schema"');
    expect(databaseCreateProbe?.run).toContain('DROP SCHEMA IF EXISTS :"probe_schema";');
    expect(databaseCreateProbe?.run).not.toContain('CREATE SCHEMA data_foundry_ci_unrelated_probe;');
    expect(apply?.run).toBe('pnpm migrate');
    expect(steps.indexOf(start as Step)).toBeLessThan(steps.indexOf(bootstrap as Step));
    expect(steps.indexOf(bootstrap as Step)).toBeLessThan(steps.indexOf(apply as Step));
    expect(steps.indexOf(bootstrap as Step)).toBeLessThan(steps.indexOf(privateSchemaAcl as Step));
    expect(steps.indexOf(privateSchemaAcl as Step)).toBeLessThan(steps.indexOf(apply as Step));
    expect(steps.indexOf(apply as Step)).toBeLessThan(steps.indexOf(databaseCreateProbe as Step));
  });

  it('checks out and records one explicit candidate SHA instead of a pull-request merge ref', () => {
    expect(workflow.env).toMatchObject({
      DATA_FOUNDRY_CANDIDATE_SHA: CANDIDATE_SHA_EXPRESSION,
    });

    for (const jobName of ['scope', 'verify', 'migrations-postgres'] as const) {
      const checkout = workflow.jobs[jobName].steps.find((step) => step.uses?.startsWith('actions/checkout@'));
      expect(checkout?.with).toMatchObject({
        'persist-credentials': false,
        ref: CANDIDATE_SHA_REFERENCE,
      });
    }

    const migrationSteps = workflow.jobs['migrations-postgres'].steps;
    const start = migrationSteps.find((step) => step.name === 'Start disposable TLS PostgreSQL');
    const stageRuntimeRoles = migrationSteps.find((step) => step.name === 'Stage disposable runtime roles and apply exact grants');
    expect(start?.run).toContain('printf \'DATA_FOUNDRY_RELEASE_SHA=%s\\n\' "$DATA_FOUNDRY_CANDIDATE_SHA"');
    expect(stageRuntimeRoles?.run).toContain(
      'node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha "$DATA_FOUNDRY_CANDIDATE_SHA" > "$plan_path"',
    );
    expect(stageRuntimeRoles?.run).not.toContain('pnpm migrate:supabase:export');
    expect(start?.run).not.toContain('$GITHUB_SHA');
    expect(stageRuntimeRoles?.run).not.toContain('$GITHUB_SHA');
  });

  it('proves five direct least-privilege runtime roles against the disposable TLS Postgres service', () => {
    const steps = workflow.jobs['migrations-postgres'].steps;
    const replay = steps.find((step) => step.name === 'Re-apply must be a no-op');
    const stageRuntimeRoles = steps.find((step) => step.name === 'Stage disposable runtime roles and apply exact grants');
    const activateRuntimeRoles = steps.find((step) => step.name === 'Activate disposable runtime roles with isolated credentials');
    const runtimeRoleConnections = steps.find((step) => step.name === 'Direct runtime-role TLS connection regression');

    for (const role of ['df_edge', 'df_web', 'df_mcp', 'df_usage', 'df_acquisition']) {
      expect(stageRuntimeRoles?.run).toMatch(new RegExp(`CREATE ROLE ${role} NOLOGIN`));
      expect(stageRuntimeRoles?.run).toMatch(new RegExp(`GRANT CONNECT ON DATABASE data_foundry TO ${role};`));
      expect(stageRuntimeRoles?.run).toMatch(new RegExp(`GRANT USAGE ON SCHEMA extensions TO ${role};`));
      expect(activateRuntimeRoles?.run).toMatch(new RegExp(`ALTER ROLE ${role} LOGIN PASSWORD`));
      expect(activateRuntimeRoles?.run).toMatch(
        new RegExp(`ALTER ROLE ${role} IN DATABASE data_foundry SET search_path TO data_foundry, pg_catalog, extensions;`),
      );
      expect(activateRuntimeRoles?.run).toContain(
        `printf '::add-mask::%s\\n' "$${role}_password"`,
      );
      expect(activateRuntimeRoles?.run?.indexOf(`${role}_password="$(openssl rand -hex 24)"`)).toBeLessThan(
        activateRuntimeRoles?.run?.indexOf(`printf '::add-mask::%s\\n' "$${role}_password"`) ?? -1,
      );
      expect(activateRuntimeRoles?.run?.indexOf(`printf '::add-mask::%s\\n' "$${role}_password"`)).toBeLessThan(
        activateRuntimeRoles?.run?.indexOf(`printf "ALTER ROLE ${role} LOGIN PASSWORD`) ?? -1,
      );
    }
    expect(stageRuntimeRoles?.run).toContain(
      'node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha "$DATA_FOUNDRY_CANDIDATE_SHA" > "$plan_path"',
    );
    expect(stageRuntimeRoles?.run).not.toContain('pnpm migrate:supabase:export');
    expect(stageRuntimeRoles?.run).toContain('postMigrationGrants.sql');
    expect(activateRuntimeRoles?.run).toContain('postCredentialVerification.sql');
    expect(activateRuntimeRoles?.run).toContain('DATA_FOUNDRY_EDGE_POSTGRES_URL=postgres://df_edge:');
    expect(activateRuntimeRoles?.run).toContain('DATA_FOUNDRY_ACQUISITION_POSTGRES_URL=postgres://df_acquisition:');
    expect(runtimeRoleConnections).toMatchObject({
      env: {
        DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST: '1',
        PGOPTIONS: '',
      },
      run: 'pnpm runtime-roles:postgres:check',
    });
    expect(steps.indexOf(replay as Step)).toBeLessThan(steps.indexOf(stageRuntimeRoles as Step));
    expect(steps.indexOf(stageRuntimeRoles as Step)).toBeLessThan(steps.indexOf(activateRuntimeRoles as Step));
    expect(steps.indexOf(activateRuntimeRoles as Step)).toBeLessThan(steps.indexOf(runtimeRoleConnections as Step));
  });

  it('rejects effective PostgreSQL 16 privilege, durable-setting, ownership, and migration-posture drift', () => {
    const steps = workflow.jobs['migrations-postgres'].steps;
    const start = steps.find((step) => step.name === 'Start disposable TLS PostgreSQL');
    const runtimeRoleConnections = steps.find((step) => step.name === 'Direct runtime-role TLS connection regression');
    const negativeControls = steps.find(
      (step) => step.name === 'Effective runtime and migration-role privilege negative controls',
    );
    const reconciliation = steps.find((step) => step.name === 'Source-record reconciliation concurrency regression');
    const run = negativeControls?.run ?? '';
    const expectOrderedAfter = (first: string, ...rest: readonly string[]): void => {
      let cursor = run.indexOf(first);
      let previous = first;
      expect(cursor, `missing ordered workflow fragment: ${first}`).toBeGreaterThanOrEqual(0);
      for (const fragment of rest) {
        const next = run.indexOf(fragment, cursor + previous.length);
        expect(next, `missing or out-of-order workflow fragment: ${fragment}`).toBeGreaterThan(cursor);
        cursor = next;
        previous = fragment;
      }
    };

    expect(start?.run).toContain('postgres:16');
    expect(negativeControls?.shell).toBe('bash');
    expect(run).toContain('postCredentialVerification.sql');
    expect(run).toContain('expect_runtime_role_rejection');
    expect(run).toContain('expect_post_credential_rejection');
    expect(run.match(/local expected_signature="\$2"/g)).toHaveLength(3);
    expect(run.match(/grep -Fqx -- "\$expected_signature" "\$negative_control_capture"/g)).toHaveLength(3);
    expect(run).toContain('local verification_prefix="${3-}"');
    expect(run).toContain("printf '%s\\n' \"$verification_prefix\"");
    expect(run).toContain('command cat -- "$post_credential_verification_path"');
    expect(run).toContain('cleanup_privilege_negative_controls');
    expect(run).toContain("trap 'on_privilege_negative_control_exit' EXIT");
    expect(run).toMatch(
      /cleanup_privilege_negative_controls\(\) \{[\s\S]*?REVOKE CREATE ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;[\s\S]*?REVOKE CONNECT ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;[\s\S]*?DROP DATABASE data_foundry_cross_database_connect_probe;[\s\S]*?return "\$cleanup_status"/,
    );
    expect(run).toContain(
      'negative_control_capture="$(mktemp "$RUNNER_TEMP/data-foundry-privilege-negative-control.XXXXXX")"',
    );
    expect(run).toContain('chmod 600 "$negative_control_capture"');
    expect(run).toContain('if ! rm -f -- "$negative_control_capture"; then');
    expect(run).toMatch(
      /if ! clear_negative_control_capture; then\s+cleanup_status=1\s+fi/,
    );
    expect(run).toContain('for cleanup_statement in "${cleanup_statements[@]}"; do');
    expect(run).toContain('run_admin_sql -c "$cleanup_statement" >/dev/null 2>&1');
    expect(run).toContain('pnpm runtime-roles:postgres:check >"$negative_control_capture" 2>&1');
    expect(run).toContain(
      'run_admin_sql < "$post_credential_verification_path" >"$negative_control_capture" 2>&1',
    );
    expect(run).toContain('failed with an unexpected signature');
    expect(run).not.toMatch(/(?:cat|tee)\s+[^\n]*negative_control_capture/);
    expect(run).toContain('GRANT SET ON PARAMETER session_replication_role TO PUBLIC;');
    expect(run).toContain('REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC;');
    expect(run).toContain('pg_catalog.lo_from_bytea');
    expect(run).toContain('GRANT SELECT, UPDATE ON LARGE OBJECT :large_object_oid TO PUBLIC;');
    expect(run).toContain('pg_catalog.lo_get(:large_object_oid::oid)');
    expect(run).toContain('pg_catalog.lo_put(:large_object_oid::oid');
    expect(run).toContain('pg_catalog.lo_unlink(:large_object_oid::oid)');
    expect(run).toContain('ALTER DATABASE data_foundry SET lo_compat_privileges TO on;');
    expect(run).toContain('ALTER DATABASE data_foundry RESET lo_compat_privileges;');
    expect(run).toContain("expect_runtime_role_rejection 'lo_compat_privileges enabled for new connections'");
    expect(run).toContain(
      'ALTER ROLE df_edge IN DATABASE data_foundry SET session_replication_role TO replica;',
    );
    expect(run).toContain(
      'ALTER ROLE df_edge IN DATABASE data_foundry RESET session_replication_role;',
    );
    expect(run).toContain('ALTER ROLE ALL SET lo_compat_privileges TO on;');
    expect(run).toContain('ALTER ROLE ALL RESET lo_compat_privileges;');
    expect(run).toContain(
      'CREATE TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe',
    );
    expect(run).toContain(
      'ALTER EXTENSION plpgsql ADD TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
    );
    expect(run).toContain(
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe OWNER TO df_edge;',
    );
    expect(run).toContain(
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe OWNER TO postgres;',
    );
    expect(run).toContain(
      'ALTER EXTENSION plpgsql DROP TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
    );
    expect(run).toContain(
      'DROP TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
    );
    expect(run).toContain(
      'CREATE TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe',
    );
    expect(run).toContain(
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe OWNER TO df_edge;',
    );
    expect(run).toContain('unmanaged_dictionary_is_attested');
    expect(run).toContain(
      "ownership.classid = 'pg_catalog.pg_ts_dict'::pg_catalog.regclass",
    );
    expect(run).toContain(
      "dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass",
    );
    expect(run).toContain(
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe OWNER TO postgres;',
    );
    expect(run).toContain(
      'DROP TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe;',
    );
    expect(run).toContain('$data_foundry_unmanaged_owner_cleanup$');
    expect(run).toContain(
      "migration_external_capability_rejection_signature='ERROR:  Runtime grant verification failed: migration-role external capability is unsafe.'",
    );
    expect(run).toContain(
      'CREATE FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw NO HANDLER NO VALIDATOR;',
    );
    expect(run).toContain(
      'CREATE SERVER data_foundry_public_usage_probe_server FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw;',
    );
    expect(run).toContain(
      'GRANT USAGE ON FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw TO PUBLIC;',
    );
    expect(run).toContain(
      'GRANT USAGE ON FOREIGN SERVER data_foundry_public_usage_probe_server TO PUBLIC;',
    );
    expect(run).toContain('public_foreign_usage_is_attested');
    expect(run).toContain("pg_catalog.has_foreign_data_wrapper_privilege('df_migration'");
    expect(run).toContain("pg_catalog.has_server_privilege('df_migration'");
    expect(run).toContain("pg_catalog.has_foreign_data_wrapper_privilege('df_edge'");
    expect(run).toContain("pg_catalog.has_server_privilege('df_edge'");
    expect(run).toContain('$data_foundry_public_server_cleanup$');
    expect(run).toContain('$data_foundry_public_fdw_cleanup$');
    expect(run).toContain('CREATE DATABASE data_foundry_cross_database_connect_probe;');
    expect(run).toContain(
      'GRANT CREATE ON DATABASE data_foundry_cross_database_connect_probe TO PUBLIC;',
    );
    expect(run).toContain('cross_database_create_is_attested');
    expect(run).toContain(
      "pg_catalog.has_database_privilege('df_edge', database.oid, 'CREATE')",
    );
    expect(run).toContain(
      "pg_catalog.has_database_privilege('df_migration', database.oid, 'CREATE')",
    );
    expect(run).toContain(
      "AND NOT pg_catalog.has_database_privilege('df_edge', database.oid, 'CONNECT')",
    );
    expect(run).toContain(
      "AND NOT pg_catalog.has_database_privilege('df_migration', database.oid, 'CONNECT')",
    );
    expect(run).toContain(
      'REVOKE CREATE ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;',
    );
    expect(run).toContain(
      'GRANT CONNECT ON DATABASE data_foundry_cross_database_connect_probe TO PUBLIC;',
    );
    expect(run).toContain('cross_database_connect_is_attested');
    expect(run).toContain(
      "pg_catalog.has_database_privilege('df_edge', database.oid, 'CONNECT')",
    );
    expect(run).toContain(
      "pg_catalog.has_database_privilege('df_migration', database.oid, 'CONNECT')",
    );
    expect(run).toContain("database.datname = 'data_foundry_cross_database_connect_probe'");
    expect(run).toContain(
      'REVOKE CONNECT ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;',
    );
    expect(run).toContain('DROP DATABASE data_foundry_cross_database_connect_probe;');
    expect(run).not.toMatch(/(?:DROP|REVOKE|GRANT)\s+(?:DATABASE|CONNECT ON DATABASE)\s+"?\$[A-Za-z_]/);
    expect(run).toContain('ALTER ROLE df_migration INHERIT;');
    expect(run).toContain('ALTER ROLE df_migration NOINHERIT;');
    expect(run).toContain("'SET session_replication_role TO replica;'");
    expect(run).toContain('capture_migration_ledger_digest');
    expect(run).toContain(
      'ALTER ROLE df_migration IN DATABASE data_foundry SET lo_compat_privileges TO on;',
    );
    expect(run).toContain(
      'ALTER ROLE df_migration IN DATABASE data_foundry RESET ALL;',
    );
    expect(run).toContain("setting.setconfig = ARRAY['lo_compat_privileges=on']::text[]");
    expect(run).toContain(
      "setting.setconfig = ARRAY['search_path=data_foundry, pg_catalog, extensions']::text[]",
    );
    expect(run).toContain(
      "migration_durable_setting_rejection_signature='ERROR:  Runtime grant verification failed: migration-role durable settings are unsafe.'",
    );
    expect(run).toContain(
      `migration_search_path_rejection_signature='${MIGRATION_SEARCH_PATH_REJECTION}'`,
    );
    expect(run).toContain('docker exec data-foundry-postgres-tls psql -U df_migration -d data_foundry');
    expect(run).toContain(
      "expect_runtime_role_rejection 'a noncanonical migration-role current-database setting'",
    );
    expect(run).toContain(
      "expect_post_credential_rejection 'a noncanonical migration-role current-database setting'",
    );
    expect(run).toContain(
      "expect_migration_rejection 'a migration-role current-database lo_compat_privileges override' \"$migration_search_path_rejection_signature\"",
    );
    expect(run).toContain('if [[ "$ledger_digest_after_rejection" != "$ledger_digest_before_rejection" ]]');
    expect(run).toContain('if [[ "$ledger_digest_after_clean_migrate" != "$ledger_digest_before_rejection" ]]');
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT SELECT ON TABLES TO PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry GRANT USAGE ON SEQUENCES TO PUBLIC;',
    );
    expect(run).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;',
    );
    expectOrderedAfter(
      'GRANT SET ON PARAMETER session_replication_role TO PUBLIC;',
      "expect_runtime_role_rejection 'a PUBLIC parameter SET privilege'",
      'REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC;',
      'pnpm runtime-roles:postgres:check',
    );
    expectOrderedAfter(
      'GRANT SELECT, UPDATE ON LARGE OBJECT :large_object_oid TO PUBLIC;',
      "expect_runtime_role_rejection 'PUBLIC large-object SELECT and UPDATE privileges'",
      'REVOKE SELECT, UPDATE ON LARGE OBJECT :large_object_oid FROM PUBLIC;',
      'pnpm runtime-roles:postgres:check',
    );
    expectOrderedAfter(
      'ALTER DATABASE data_foundry SET lo_compat_privileges TO on;',
      "expect_runtime_role_rejection 'lo_compat_privileges enabled for new connections'",
      'ALTER DATABASE data_foundry RESET lo_compat_privileges;',
      'pnpm runtime-roles:postgres:check',
    );
    expectOrderedAfter(
      'ALTER ROLE df_edge IN DATABASE data_foundry SET session_replication_role TO replica;',
      "expect_runtime_role_rejection 'a role-specific current-database session_replication_role override'",
      "expect_post_credential_rejection 'a role-specific current-database session_replication_role override'",
      'ALTER ROLE df_edge IN DATABASE data_foundry RESET session_replication_role;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ALTER ROLE ALL SET lo_compat_privileges TO on;',
      "expect_runtime_role_rejection 'an ALTER ROLE ALL lo_compat_privileges override'",
      "expect_post_credential_rejection 'an ALTER ROLE ALL lo_compat_privileges override' \"$migration_durable_setting_rejection_signature\"",
      'ALTER ROLE ALL RESET lo_compat_privileges;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'CREATE TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe',
      'ALTER EXTENSION plpgsql ADD TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe OWNER TO df_edge;',
      "expect_runtime_role_rejection 'runtime ownership of a catalog-attested extension member'",
      "expect_post_credential_rejection 'runtime ownership of a catalog-attested extension member'",
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe OWNER TO postgres;',
      'ALTER EXTENSION plpgsql DROP TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
      'DROP TEXT SEARCH DICTIONARY extensions.data_foundry_runtime_owner_probe;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'CREATE TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe',
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe OWNER TO df_edge;',
      'unmanaged_dictionary_is_attested="$(',
      "ownership.deptype = 'o'",
      'AND NOT EXISTS (',
      "dependency.deptype = 'e'",
      'if [[ "$unmanaged_dictionary_is_attested" != \'t\' ]]',
      "expect_runtime_role_rejection 'runtime ownership of an unmanaged catalog object'",
      "expect_post_credential_rejection 'runtime ownership of an unmanaged catalog object'",
      'ALTER TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe OWNER TO postgres;',
      'DROP TEXT SEARCH DICTIONARY extensions.data_foundry_unmanaged_owner_probe;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'CREATE FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw NO HANDLER NO VALIDATOR;',
      'CREATE SERVER data_foundry_public_usage_probe_server FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw;',
      'GRANT USAGE ON FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw TO PUBLIC;',
      'GRANT USAGE ON FOREIGN SERVER data_foundry_public_usage_probe_server TO PUBLIC;',
      'public_foreign_usage_is_attested="$(',
      'if [[ "$public_foreign_usage_is_attested" != \'t\' ]]',
      "expect_runtime_role_rejection 'PUBLIC foreign-data wrapper and server USAGE'",
      "expect_post_credential_rejection 'PUBLIC foreign-data wrapper and server USAGE'",
      'REVOKE USAGE ON FOREIGN SERVER data_foundry_public_usage_probe_server FROM PUBLIC;',
      'REVOKE USAGE ON FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw FROM PUBLIC;',
      'DROP SERVER data_foundry_public_usage_probe_server;',
      'DROP FOREIGN DATA WRAPPER data_foundry_public_usage_probe_fdw;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'CREATE DATABASE data_foundry_cross_database_connect_probe;',
      'REVOKE CONNECT ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;',
      'GRANT CREATE ON DATABASE data_foundry_cross_database_connect_probe TO PUBLIC;',
      'cross_database_create_is_attested="$(',
      'if [[ "$cross_database_create_is_attested" != \'t\' ]]',
      "expect_runtime_role_rejection 'PUBLIC CREATE on a non-target database'",
      "expect_post_credential_rejection 'PUBLIC CREATE on a non-target database'",
      'REVOKE CREATE ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'CREATE DATABASE data_foundry_cross_database_connect_probe;',
      'GRANT CONNECT ON DATABASE data_foundry_cross_database_connect_probe TO PUBLIC;',
      'cross_database_connect_is_attested="$(',
      "AND pg_catalog.has_database_privilege('df_edge', database.oid, 'CONNECT')",
      "AND pg_catalog.has_database_privilege('df_migration', database.oid, 'CONNECT')",
      "AND NOT pg_catalog.has_database_privilege('df_edge', database.oid, 'CREATE')",
      "AND NOT pg_catalog.has_database_privilege('df_migration', database.oid, 'CREATE')",
      'if [[ "$cross_database_connect_is_attested" != \'t\' ]]',
      "expect_runtime_role_rejection 'PUBLIC CONNECT on a non-target database'",
      "expect_post_credential_rejection 'PUBLIC CONNECT on a non-target database'",
      'REVOKE CONNECT ON DATABASE data_foundry_cross_database_connect_probe FROM PUBLIC;',
      'DROP DATABASE data_foundry_cross_database_connect_probe;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ALTER ROLE df_migration INHERIT;',
      "expect_runtime_role_rejection 'an inheriting migration role'",
      "expect_post_credential_rejection 'an inheriting migration role'",
      'ALTER ROLE df_migration NOINHERIT;',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      "expect_post_credential_rejection 'a replica-mode migration verifier session'",
      "'SET session_replication_role TO replica;'",
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ledger_digest_before_rejection="$(capture_migration_ledger_digest)"',
      'ALTER ROLE df_migration IN DATABASE data_foundry RESET ALL;',
      'ALTER ROLE df_migration IN DATABASE data_foundry SET lo_compat_privileges TO on;',
      "expect_runtime_role_rejection 'a noncanonical migration-role current-database setting'",
      "expect_post_credential_rejection 'a noncanonical migration-role current-database setting'",
      "expect_migration_rejection 'a migration-role current-database lo_compat_privileges override'",
      'ledger_digest_after_rejection="$(capture_migration_ledger_digest)"',
      'if [[ "$ledger_digest_after_rejection" != "$ledger_digest_before_rejection" ]]',
      'ALTER ROLE df_migration IN DATABASE data_foundry RESET ALL;',
      'ALTER ROLE df_migration IN DATABASE data_foundry SET search_path TO data_foundry, pg_catalog, extensions;',
      'migration_role_setting_is_canonical="$(',
      'if [[ "$migration_role_setting_is_canonical" != \'t\' ]]',
      'pnpm runtime-roles:postgres:check',
      'run_admin_sql < "$post_credential_verification_path"',
      'pnpm migrate',
      'ledger_digest_after_clean_migrate="$(capture_migration_ledger_digest)"',
      'if [[ "$ledger_digest_after_clean_migrate" != "$ledger_digest_before_rejection" ]]',
    );
    expectOrderedAfter(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
      "expect_post_credential_rejection 'the implicit global PUBLIC function default'",
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry GRANT EXECUTE ON FUNCTIONS TO PUBLIC;',
      "expect_post_credential_rejection 'a schema-specific PUBLIC function default'",
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration GRANT SELECT ON TABLES TO PUBLIC;',
      "expect_post_credential_rejection 'a global PUBLIC table default'",
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expectOrderedAfter(
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry GRANT USAGE ON SEQUENCES TO PUBLIC;',
      "expect_post_credential_rejection 'a schema-specific PUBLIC sequence default'",
      'ALTER DEFAULT PRIVILEGES FOR ROLE df_migration IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;',
      'run_admin_sql < "$post_credential_verification_path"',
    );
    expect(workflowSource).not.toContain('has_largeobject_privilege');
    expect(steps.indexOf(runtimeRoleConnections as Step)).toBeLessThan(steps.indexOf(negativeControls as Step));
    expect(steps.indexOf(negativeControls as Step)).toBeLessThan(steps.indexOf(reconciliation as Step));
  });

  it('selects real Postgres for every gate input, including nested paths', () => {
    for (const pattern of [
      'db/migrations/**',
      'tooling/scripts/migrate.ts',
      'tooling/scripts/export-supabase-migration-packets.ts',
      'tooling/scripts/check-runtime-role-connections-postgres.ts',
      'packages/private-canary/**',
      'tooling/scripts/check-source-record-reconciliation-postgres.ts',
      'packages/canonical-store/**',
      'services/ingest-worker/**',
      'tooling/scripts/check-credential-provisioning-postgres.ts',
      'tooling/scripts/provision-api-credential.ts',
      'packages/api-keys/**',
      'tooling/scripts/check-scheduled-acquisition-postgres.ts',
      'packages/acquisition/**',
      'apps/acquisition-worker/**',
      'verticals/**',
      'tooling/lib/cli-entry.ts',
      'tests/support/acquisition-rights.ts',
      'packages/canonical-schema/**',
      'packages/normalization/**',
      'packages/source-registry/**',
      'packages/rights-engine/**',
      'package.json',
      'pnpm-lock.yaml',
      '.github/workflows/ci.yml',
    ]) {
      expect(scopeScript, pattern).toContain(pattern);
    }
  });

  it('selects real Postgres for a policy-only private-canary change and treats renames conservatively', () => {
    expect(scopeScript).toContain('git diff --no-renames --name-only');
    expect(selectsRealPostgres('packages/private-canary/src/runtime-role-policy.ts')).toBe(true);
    expect(selectsRealPostgres('docs/owner-actions/cloudflare-deployment.md')).toBe(false);
  });
});
