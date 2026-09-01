import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_VERIFY = "needs.scope.outputs.run_verify == 'true'";
const NON_DRAFT_EVENT = "(github.event_name != 'pull_request' || github.event.pull_request.draft == false)";
const SCOPE_FAILURE_GUARD = "always() && needs.scope.result != 'success'";

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type Workflow = {
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

  it('boots a disposable certificate-verified Postgres service and a narrow migration identity', () => {
    const steps = workflow.jobs['migrations-postgres'].steps;
    const start = steps.find((step) => step.name === 'Start disposable TLS PostgreSQL');
    const bootstrap = steps.find((step) => step.name === 'Bootstrap narrow private migration role');
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
      'tls-key-permissions',
      'credential-generation',
      'docker-start',
      'readiness',
      'environment-export',
    ]) {
      expect(start?.run).toContain(category);
    }
    expect(start?.run).toContain('docker logs "$container_name" 2>&1 | grep -Eqi');
    expect(bootstrap?.run).toContain('CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres');
    expect(bootstrap?.run).toContain('CREATE ROLE df_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    expect(bootstrap?.run).toContain('CREATE SCHEMA IF NOT EXISTS data_foundry AUTHORIZATION df_migration');
    expect(bootstrap?.run).toContain('GRANT USAGE ON SCHEMA extensions TO df_migration');
    expect(apply?.run).toBe('pnpm migrate');
    expect(steps.indexOf(start as Step)).toBeLessThan(steps.indexOf(bootstrap as Step));
    expect(steps.indexOf(bootstrap as Step)).toBeLessThan(steps.indexOf(apply as Step));
  });

  it('selects real Postgres for every gate input, including nested paths', () => {
    for (const pattern of [
      'db/migrations/**',
      'tooling/scripts/migrate.ts',
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
