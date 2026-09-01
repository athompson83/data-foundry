import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_VERIFY = "needs.scope.outputs.run_verify == 'true'";
const NON_DRAFT_EVENT = "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)";
const SCOPE_FAILURE_GUARD = "always() && needs.scope.result != 'success'";
const CANDIDATE_SHA_EXPRESSION = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
const CANDIDATE_SHA_REFERENCE = '${{ env.DATA_FOUNDRY_CANDIDATE_SHA }}';

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
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

const workflow = parseYaml(
  readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
) as Workflow;
const scopeScript = workflow.jobs.scope.steps.find((step) => step.id === 'changes')?.run ?? '';

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

  it('labels the artifact gate as the six route-less private-canary artifacts', () => {
    const artifactGate = workflow.jobs.verify.steps.find((step) => step.run === 'pnpm cloudflare:artifacts:check');
    expect(artifactGate?.name).toBe(
      'Cloudflare six route-less private-canary artifacts build and are PGlite-free',
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

  it('selects real Postgres for every gate input, including nested paths', () => {
    for (const pattern of [
      'db/migrations/**',
      'tooling/scripts/migrate.ts',
      'tooling/scripts/export-supabase-migration-packets.ts',
      'tooling/scripts/check-runtime-role-connections-postgres.ts',
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
});
