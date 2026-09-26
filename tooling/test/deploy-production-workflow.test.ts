/**
 * The production deployment workflow is manual-only, `main`-only, confirmed,
 * environment-protected, fail-closed on missing credentials, pinned by SHA,
 * and deploys only after the full check set. Its manifest renderer rebuilds
 * the ignored deployment manifests from environment variables without ever
 * printing a value, and its output passes the deployment topology check.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  BUNDLED_RUNTIME_VERTICALS,
  validateCloudflareTopology,
} from '../scripts/check-cloudflare-topology.js';
import {
  DeploymentRenderError,
  renderDeploymentManifests,
  run as runRenderer,
} from '../scripts/render-deployment-manifests.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = await readFile(join(ROOT, '.github', 'workflows', 'deploy-production.yml'), 'utf8');

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; environment?: unknown; steps: Step[]; permissions?: unknown };
const workflow = parseYaml(SOURCE) as {
  on: Record<string, { inputs?: Record<string, { required?: boolean; type?: string }> }>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};

const temporaryDirectories: string[] = [];
afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the deploy-production workflow trigger', () => {
  it('runs only on a manual workflow_dispatch with a required confirm input', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(SOURCE).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch|release):/m);
    const inputs = workflow.on['workflow_dispatch']?.inputs ?? {};
    expect(Object.keys(inputs)).toEqual(['confirm']);
    expect(inputs['confirm']).toMatchObject({ required: true, type: 'string' });
  });

  it('fails the guard job unless it is a dispatch on refs/heads/main confirmed with deploy-production', () => {
    const guard = workflow.jobs['guard'];
    const script = guard?.steps.map((step) => step.run ?? '').join('\n') ?? '';
    expect(script).toContain('set -euo pipefail');
    expect(script).toMatch(/"\$GITHUB_EVENT_NAME" != "workflow_dispatch"[\s\S]*?exit 1/);
    expect(script).toMatch(/"\$GITHUB_REF" != "refs\/heads\/main"[\s\S]*?exit 1/);
    expect(script).toMatch(/"\$CONFIRM" != "deploy-production"[\s\S]*?exit 1/);
    // The input reaches the shell only through env, never by interpolation.
    expect(script).not.toContain('${{');
    expect(guard?.environment).toBeUndefined();
  });

  it('holds credentials only in a main-only deploy job behind the production environment', () => {
    const deploy = workflow.jobs['deploy'];
    expect(deploy?.needs).toBe('guard');
    expect(deploy?.environment).toBe('production');
    expect(deploy?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(deploy?.if).toContain("github.ref == 'refs/heads/main'");
    expect(deploy?.if).toContain("needs.guard.result == 'success'");
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({ group: 'deploy-production', 'cancel-in-progress': false });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === 'deploy') continue;
      expect(JSON.stringify(job)).not.toContain('secrets.');
    }
  });
});

describe('the deploy-production workflow steps', () => {
  const steps = workflow.jobs['deploy']?.steps ?? [];
  const indexOf = (predicate: (step: Step) => boolean): number => steps.findIndex(predicate);

  it('pins every action by full commit SHA and never persists checkout credentials', () => {
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.map((step) => step.uses)).filter(Boolean);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('fails closed before install when CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is missing', () => {
    const gate = indexOf((step) => (step.name ?? '').startsWith('Fail closed'));
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(indexOf((step) => step.run === 'pnpm install --frozen-lockfile'));
    const step = steps[gate]!;
    expect(step.env?.['CLOUDFLARE_API_TOKEN']).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(step.env?.['CLOUDFLARE_ACCOUNT_ID']).toBe('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
    expect(step.run).toContain('set -euo pipefail');
    expect(step.run).toMatch(/for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID/);
    expect(step.run).toContain('if [[ -z "${!name:-}" ]]');
    expect(step.run).toContain('exit "$missing"');
  });

  it('never interpolates or echoes a secret in a script', () => {
    for (const step of Object.values(workflow.jobs).flatMap((job) => job.steps)) {
      const script = step.run ?? '';
      expect(script).not.toContain('${{');
      expect(script).not.toMatch(/set -x|echo[^\n]*\$\{?(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)|printenv|^\s*env\s*$/m);
      for (const value of Object.values(step.env ?? {})) {
        if (String(value).includes('secrets.')) {
          expect(String(value)).toMatch(/^\$\{\{ secrets\.(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID) \}\}$/);
        }
      }
    }
  });

  it('runs the full check set, renders and checks manifests, then deploys the ordinary Workers', () => {
    const checks = [
      'pnpm typecheck',
      'pnpm test',
      'pnpm migrate:check',
      'pnpm schemas:check',
      'pnpm openapi:check',
      'pnpm cloudflare:topology:check',
      'pnpm verticals:validate',
      'pnpm verticals:compile:check',
      'pnpm acquisition:check',
      'pnpm ingestion:check',
      'pnpm mcp:compile:check',
      'pnpm web:compile:check',
      'pnpm cloudflare:artifacts:check',
      'pnpm cloudflare:synthetic-ingestion:artifacts:check',
    ];
    const deploy = indexOf((step) => (step.run ?? '').includes('wrangler deploy'));
    expect(deploy).toBeGreaterThan(-1);
    for (const check of checks) {
      const index = indexOf((step) => step.run === check);
      expect(index, check).toBeGreaterThan(-1);
      expect(index, check).toBeLessThan(deploy);
    }
    const render = indexOf((step) => step.run === 'pnpm cloudflare:deployment:render');
    const deploymentCheck = indexOf((step) => step.run === 'pnpm cloudflare:deployment:check');
    expect(render).toBeGreaterThan(indexOf((step) => step.run === 'pnpm cloudflare:artifacts:check'));
    expect(deploymentCheck).toBeGreaterThan(render);
    expect(deploy).toBeGreaterThan(deploymentCheck);
    const script = steps[deploy]!.run ?? '';
    expect(script).not.toContain('--dry-run');
    expect(script).toContain('--env-file tooling/wrangler-empty.env');
    for (const app of ['usage-consumer', 'ingestion-worker', 'acquisition-worker', 'edge', 'mcp-worker', 'web']) {
      expect(script).toContain(`apps/${app}/wrangler.production.toml`);
    }
    expect(script).toContain('apps/edge/wrangler.vehicles.production.toml');
    expect(script).not.toMatch(/private-canary|synthetic-ingestion/);
    expect(steps.at(-1)?.if).toBe('always()');
    expect(steps.at(-1)?.run).toContain('rm -f');
  });
});

const ENVIRONMENT: Record<string, string> = {
  CLOUDFLARE_ACCOUNT_ID: '1234567890abcdef1234567890abcdef',
  DF_ZONE_NAME: 'datafoundry.io',
  DF_HYPERDRIVE_ID_EDGE: 'abcdef1234567890abcdef1234567890',
  DF_HYPERDRIVE_ID_USAGE_CONSUMER: 'bcdef1234567890abcdef1234567890a',
  DF_HYPERDRIVE_ID_WEB: 'cdef1234567890abcdef1234567890ab',
  DF_HYPERDRIVE_ID_ACQUISITION: 'def1234567890abcdef1234567890abc',
  DF_HYPERDRIVE_ID_INGESTION: 'f1234567890abcdef1234567890abcde',
  DF_HYPERDRIVE_ID_MCP: 'ef1234567890abcdef1234567890abcd',
  DF_EDGE_ROUTES: 'api.datafoundry.io/v1/hvac/*, api.datafoundry.io/v1/hvac',
  DF_EDGE_API_PATH_PREFIX: '/v1/hvac',
  DF_EDGE_STRIPE_PRICE_IDS: '{"developer":"price_Dev0001"}',
  DF_EDGE_BILLING_PUBLIC_ORIGIN: 'https://api.datafoundry.io',
  DF_EDGE_BILLING_RETURN_URL: 'https://www.datafoundry.io/hvac/pricing',
  DF_EDGE_VEHICLES_ROUTES: 'api.datafoundry.io/v1/vehicles/*,api.datafoundry.io/v1/vehicles',
  DF_HYPERDRIVE_ID_EDGE_VEHICLES: 'abcdef1234567890abcdef1234567890',
  DF_WEB_ROUTES: 'www.datafoundry.io/*',
  DF_WEB_PUBLIC_ORIGIN: 'https://www.datafoundry.io',
  DF_MCP_ROUTES: 'mcp.datafoundry.io/*',
  DF_MCP_HOSTNAME: 'mcp.datafoundry.io',
  DF_MCP_ALLOWED_ORIGINS: 'https://app.datafoundry.io',
};

describe('the deployment manifest renderer', () => {
  it('renders manifests that pass the deployment topology check, including the vehicles edge', async () => {
    const manifests = await renderDeploymentManifests(ENVIRONMENT);
    expect(manifests.map(({ path }) => path).sort()).toEqual([
      join('apps', 'acquisition-worker', 'wrangler.production.toml'),
      join('apps', 'edge', 'wrangler.production.toml'),
      join('apps', 'edge', 'wrangler.vehicles.production.toml'),
      join('apps', 'ingestion-worker', 'wrangler.production.toml'),
      join('apps', 'mcp-worker', 'wrangler.production.toml'),
      join('apps', 'usage-consumer', 'wrangler.production.toml'),
      join('apps', 'web', 'wrangler.production.toml'),
    ].sort());
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-render-'));
    temporaryDirectories.push(directory);
    const at = (path: string): string => join(directory, path.replaceAll('/', '_').replaceAll('\\', '_'));
    for (const manifest of manifests) await writeFile(at(manifest.path), manifest.content, 'utf8');
    const path = (app: string, file = 'wrangler.production.toml'): string => at(join('apps', app, file));
    const errors = await validateCloudflareTopology({
      mode: 'deployment',
      edgeConfigPath: path('edge'),
      consumerConfigPath: path('usage-consumer'),
      webConfigPath: path('web'),
      acquisitionConfigPath: path('acquisition-worker'),
      ingestionConfigPath: path('ingestion-worker'),
      mcpConfigPath: path('mcp-worker'),
      edgeVerticalDeploymentConfigPaths: [path('edge', 'wrangler.vehicles.production.toml')],
      bundledVerticals: { edge: [...BUNDLED_RUNTIME_VERTICALS.edge, 'vehicles'] },
    });
    expect(errors).toEqual([]);
    // No Stripe or RapidAPI secret is ever rendered.
    for (const { content } of manifests) expect(content).not.toMatch(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RAPIDAPI_PROXY_SECRET|RAPIDAPI_API_KEY|CLOUDFLARE_API_TOKEN/);
  });

  it('omits the vehicles edge unless its routes are configured', async () => {
    const { DF_EDGE_VEHICLES_ROUTES: _routes, DF_HYPERDRIVE_ID_EDGE_VEHICLES: _id, ...hvacOnly } = ENVIRONMENT;
    const manifests = await renderDeploymentManifests(hvacOnly);
    expect(manifests.map(({ path }) => path)).not.toContain(join('apps', 'edge', 'wrangler.vehicles.production.toml'));
    expect(manifests).toHaveLength(6);
  });

  it('fails closed naming only missing variables, never values', async () => {
    const { CLOUDFLARE_ACCOUNT_ID: _account, DF_HYPERDRIVE_ID_WEB: _web, ...partial } = ENVIRONMENT;
    const error = await renderDeploymentManifests({ ...partial, DF_MCP_HOSTNAME: '  ' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeploymentRenderError);
    const message = (error as Error).message;
    expect(message).toContain('CLOUDFLARE_ACCOUNT_ID is required');
    expect(message).toContain('DF_HYPERDRIVE_ID_WEB is required');
    expect(message).toContain('DF_MCP_HOSTNAME is required');
    for (const value of Object.values(ENVIRONMENT)) expect(message).not.toContain(value);

    const vehiclesWithoutHyperdrive = await renderDeploymentManifests({
      ...ENVIRONMENT,
      DF_HYPERDRIVE_ID_EDGE_VEHICLES: '',
    }).catch((caught: unknown) => caught);
    expect((vehiclesWithoutHyperdrive as Error).message).toContain('DF_HYPERDRIVE_ID_EDGE_VEHICLES is required');
  });

  it('refuses to overwrite an existing ignored manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'data-foundry-render-root-'));
    temporaryDirectories.push(root);
    for (const app of ['edge', 'usage-consumer', 'web', 'acquisition-worker', 'ingestion-worker', 'mcp-worker']) {
      await mkdir(join(root, 'apps', app), { recursive: true });
      await writeFile(join(root, 'apps', app, 'wrangler.toml'), await readFile(join(ROOT, 'apps', app, 'wrangler.toml'), 'utf8'));
    }
    await writeFile(join(root, 'apps', 'edge', 'wrangler.vehicles.toml'), await readFile(join(ROOT, 'apps', 'edge', 'wrangler.vehicles.toml'), 'utf8'));
    await writeFile(join(root, 'apps', 'web', 'wrangler.production.toml'), 'operator = "copy"\n');
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(await runRenderer(ENVIRONMENT, root)).toBe(1);
    } finally {
      process.stderr.write = originalWrite;
    }
    expect(await readFile(join(root, 'apps', 'web', 'wrangler.production.toml'), 'utf8')).toBe('operator = "copy"\n');
  });
});

describe('the runbook paid API production section', () => {
  it('documents copy-pasteable edge manifests that pass the deployment check once placeholders are filled', async () => {
    const runbook = await readFile(join(ROOT, 'docs', 'owner-actions', 'cloudflare-deployment.md'), 'utf8');
    const section = runbook.split('## 10. Paid API production deployment')[1] ?? '';
    expect(section).toContain('.github/workflows/deploy-production.yml');
    expect(section).toContain('gh workflow run deploy-production.yml --ref main -f confirm=deploy-production');
    for (const secret of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RAPIDAPI_PROXY_SECRET', 'RAPIDAPI_API_KEY']) {
      expect(section).toContain(secret);
    }
    const blocks = [...section.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
    expect(blocks).toHaveLength(2);
    const fill = (block: string): string =>
      block
        .replaceAll('<32-hex-cloudflare-account-id>', ENVIRONMENT['CLOUDFLARE_ACCOUNT_ID']!)
        .replaceAll('<32-hex-edge-role-hyperdrive-id>', ENVIRONMENT['DF_HYPERDRIVE_ID_EDGE']!)
        .replace(/price_<[^>]+>/g, 'price_Live0001');
    for (const block of blocks) expect(fill(block)).not.toMatch(/<[^>]+>/);

    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-runbook-'));
    temporaryDirectories.push(directory);
    const rendered = await renderDeploymentManifests(ENVIRONMENT);
    const paths: Record<string, string> = {};
    for (const manifest of rendered) {
      const target = join(directory, manifest.path.replaceAll('/', '_').replaceAll('\\', '_'));
      await writeFile(target, manifest.content, 'utf8');
      paths[manifest.path.replaceAll('\\', '/')] = target;
    }
    await writeFile(paths['apps/edge/wrangler.production.toml']!, fill(blocks[0]!), 'utf8');
    await writeFile(paths['apps/edge/wrangler.vehicles.production.toml']!, fill(blocks[1]!), 'utf8');
    const errors = await validateCloudflareTopology({
      mode: 'deployment',
      edgeConfigPath: paths['apps/edge/wrangler.production.toml']!,
      consumerConfigPath: paths['apps/usage-consumer/wrangler.production.toml']!,
      webConfigPath: paths['apps/web/wrangler.production.toml']!,
      acquisitionConfigPath: paths['apps/acquisition-worker/wrangler.production.toml']!,
      ingestionConfigPath: paths['apps/ingestion-worker/wrangler.production.toml']!,
      mcpConfigPath: paths['apps/mcp-worker/wrangler.production.toml']!,
      edgeVerticalDeploymentConfigPaths: [paths['apps/edge/wrangler.vehicles.production.toml']!],
      bundledVerticals: { edge: [...BUNDLED_RUNTIME_VERTICALS.edge, 'vehicles'] },
    });
    expect(errors).toEqual([]);
  });
});
