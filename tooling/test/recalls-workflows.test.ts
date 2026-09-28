/**
 * The recalls deployment and acceptance workflows are manual-only, `main`-only,
 * confirmed, environment-protected and serialized, read credentials only inside
 * the protected job, never print a secret, and pin the deployed commit to the
 * one the operator approved and protected-main CI verified.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; 'working-directory'?: string };
type Job = { needs?: string | string[]; if?: string; environment?: unknown; steps: Step[]; permissions?: Record<string, string> };
type Workflow = {
  on: Record<string, { inputs?: Record<string, { required?: boolean }> }>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
const load = (name: string): { source: string; workflow: Workflow } => {
  const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
  return { source, workflow: parseYaml(source) as Workflow };
};

const deploy = load('deploy-recalls.yml');
const accept = load('recalls-acceptance.yml');
const allRuns = (workflow: Workflow): string => Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.run ?? '')).join('\n');

describe('deploy-recalls workflow', () => {
  it('runs only on a manual dispatch with a confirmation phrase and the approved SHA', () => {
    expect(Object.keys(deploy.workflow.on)).toEqual(['workflow_dispatch']);
    expect(deploy.workflow.on['workflow_dispatch']?.inputs?.['confirm']?.required).toBe(true);
    expect(deploy.workflow.on['workflow_dispatch']?.inputs?.['expected_sha']?.required).toBe(true);
    const guard = deploy.workflow.jobs['guard']?.steps.map((step) => step.run ?? '').join('\n') ?? '';
    expect(guard).toContain('refs/heads/main');
    expect(guard).toContain('deploy-recalls');
    expect(guard).toContain('"$EXPECTED_SHA" != "$GITHUB_SHA"');
    expect(guard).toMatch(/ci\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}&event=push/);
    expect(guard).toContain('"$conclusion" != "success"');
  });

  it('shares the production deployment lock without cancelling an active deploy', () => {
    expect(deploy.workflow.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false });
    expect(load('deploy-production.yml').workflow.concurrency.group).toBe('deploy-production');
  });

  it('reads Cloudflare credentials only in the environment-protected job, after the guard', () => {
    const job = deploy.workflow.jobs['deploy'] as Job;
    expect(job.environment).toBe('production');
    expect(job.needs).toBe('guard');
    expect(JSON.stringify(deploy.workflow.jobs['guard'])).not.toContain('secrets.');
    expect(deploy.workflow.permissions).toEqual({ contents: 'read' });
    expect(deploy.source).not.toMatch(/echo[^\n]*\$\{?CLOUDFLARE_API_TOKEN/);
  });

  it('targets only the recalls Worker on its recorded account, with rollback and verification', () => {
    const runs = allRuns(deploy.workflow);
    expect(runs).toContain('"$CLOUDFLARE_ACCOUNT_ID" != "$RECALLS_ACCOUNT_ID"');
    expect(deploy.source).toContain('RECALLS_ACCOUNT_ID: c2832821a9ab36419cde6ee08112f6d3');
    const deploySteps = (deploy.workflow.jobs['deploy'] as Job).steps.filter((step) => /wrangler deploy (?!--dry-run)/.test(step.run ?? ''));
    expect(deploySteps).toHaveLength(1);
    expect(deploySteps[0]?.['working-directory']).toBe('apps/recalls-worker');
    expect(runs).not.toMatch(/--config|wrangler\.production/);
    expect(runs).toContain('wrangler d1 migrations list data-foundry-recalls --remote');
    expect(runs).toContain('ROLLBACK_VERSION=');
    expect(runs).toContain('workers/tag');
    expect(runs).toContain('pnpm --filter @data-foundry/recalls-worker typecheck');
    // The rollback record precedes the deploy, and verification follows it.
    const names = (deploy.workflow.jobs['deploy'] as Job).steps.map((step) => step.name ?? '');
    expect(names.indexOf('Record the live version as the rollback target')).toBeLessThan(names.indexOf('Deploy'));
    expect(names.indexOf('Deploy')).toBeLessThan(names.indexOf('Verify the new live version is this commit\'s'));
  });

  it('is not triggered by the CI workflow or any push', () => {
    expect(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')).not.toContain('deploy-recalls');
  });
});

describe('recalls-acceptance workflow', () => {
  it('is manual, main-only, confirmed, serialized and environment-protected', () => {
    expect(Object.keys(accept.workflow.on)).toEqual(['workflow_dispatch']);
    const job = accept.workflow.jobs['accept'] as Job;
    expect(job.environment).toBe('production');
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(accept.workflow.concurrency).toEqual({ group: 'recalls-acceptance', 'cancel-in-progress': false });
    const runs = allRuns(accept.workflow);
    expect(runs).toContain('accept-recalls');
    expect(runs).toContain('^cus_acceptance_internal_[0-9]{8}$');
  });

  it('accepts only the deployed commit: an approved SHA on main, checked out and passed to the script', () => {
    expect(accept.workflow.on['workflow_dispatch']?.inputs?.['expected_sha']?.required).toBe(true);
    const runs = allRuns(accept.workflow);
    expect(runs).toContain('git merge-base --is-ancestor "$EXPECTED_SHA" "$GITHUB_SHA"');
    expect(runs).toContain('git checkout --quiet --detach "$EXPECTED_SHA"');
    expect(accept.source).toContain('ACCEPTANCE_EXPECTED_SHA: ${{ inputs.expected_sha }}');
    // The deploy workflow tags each version with the same 12-character prefix the script checks.
    expect(allRuns(deploy.workflow)).toContain('--tag "${GITHUB_SHA:0:12}"');
    expect(readFileSync(join(ROOT, 'apps', 'recalls-worker', 'scripts', 'acceptance.ts'), 'utf8')).toContain('options.expectedSha.slice(0, 12)');
    expect(readFileSync(join(ROOT, 'apps', 'recalls-worker', 'wrangler.toml'), 'utf8')).toMatch(/\[version_metadata\]\nbinding = "CF_VERSION_METADATA"/);
  });

  it('passes the admin token only as an environment variable and never echoes it', () => {
    expect(accept.source).not.toMatch(/echo[^\n]*\$\{?ADMIN_TOKEN/);
    expect(accept.source).not.toMatch(/set -x/);
    expect(accept.source).not.toMatch(/run:[^\n]*secrets\./);
    expect(accept.source).toContain('pnpm exec tsx apps/recalls-worker/scripts/acceptance.ts');
  });
});
