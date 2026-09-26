/**
 * Reconstruct the ignored ordinary production Wrangler manifests from
 * environment variables, for the manual `deploy-production` GitHub workflow.
 *
 * The tracked templates stay the source of every capability (queues, Crons,
 * R2, vars). This only adds the deployment facts the repository must never
 * carry: `account_id`, routes, the role-specific Hyperdrive ids and the
 * endpoint/billing variables. Secrets are never rendered: Stripe and RapidAPI
 * values are Worker secrets set once with `wrangler secret put`, and the
 * account id comes from the `CLOUDFLARE_ACCOUNT_ID` repository secret.
 *
 * It fails closed on any missing required variable, refuses to overwrite an
 * existing manifest, and never prints a value: only variable names and
 * repository-relative paths appear in its output. The rendered manifests are
 * then validated by `pnpm cloudflare:deployment:check` before any deploy.
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';
import { isMain } from '../lib/cli-entry.js';
import { EDGE_VERTICAL_TEMPLATES } from './check-cloudflare-topology.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type TomlObject = Record<string, unknown>;
type Environment = Readonly<Record<string, string | undefined>>;

export interface RenderedManifest {
  /** Repository-relative path of the ignored manifest. */
  readonly path: string;
  readonly content: string;
}

export class DeploymentRenderError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Deployment manifests were not rendered:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
    this.name = 'DeploymentRenderError';
  }
}

interface WorkerSpec {
  readonly app: string;
  readonly template: string;
  readonly output: string;
  readonly hyperdriveVar: string;
  readonly routesVar?: string;
  /** Deployment variable -> environment variable. */
  readonly requiredVars?: Readonly<Record<string, string>>;
  readonly optionalVars?: Readonly<Record<string, string>>;
  /** Optional billing trio, rendered all-or-nothing by the topology check. */
  readonly billingPrefix?: string;
}

/** The environment-variable stem for a per-vertical edge, e.g. `vehicles` -> `EDGE_VEHICLES`. */
export function verticalEdgeStem(slug: string): string {
  return `EDGE_${slug.toUpperCase().replaceAll('-', '_')}`;
}

function verticalSlugOf(templatePath: string): string {
  return basename(templatePath).replace(/^wrangler\./, '').replace(/\.toml$/, '');
}

const ORDINARY_WORKERS: readonly WorkerSpec[] = [
  { app: 'usage-consumer', template: 'wrangler.toml', output: 'wrangler.production.toml', hyperdriveVar: 'DF_HYPERDRIVE_ID_USAGE_CONSUMER' },
  { app: 'ingestion-worker', template: 'wrangler.toml', output: 'wrangler.production.toml', hyperdriveVar: 'DF_HYPERDRIVE_ID_INGESTION' },
  { app: 'acquisition-worker', template: 'wrangler.toml', output: 'wrangler.production.toml', hyperdriveVar: 'DF_HYPERDRIVE_ID_ACQUISITION' },
  {
    app: 'edge',
    template: 'wrangler.toml',
    output: 'wrangler.production.toml',
    hyperdriveVar: 'DF_HYPERDRIVE_ID_EDGE',
    routesVar: 'DF_EDGE_ROUTES',
    optionalVars: { API_PATH_PREFIX: 'DF_EDGE_API_PATH_PREFIX', RAPIDAPI_HOSTNAME: 'DF_EDGE_RAPIDAPI_HOSTNAME' },
    billingPrefix: 'DF_EDGE',
  },
  {
    app: 'mcp-worker',
    template: 'wrangler.toml',
    output: 'wrangler.production.toml',
    hyperdriveVar: 'DF_HYPERDRIVE_ID_MCP',
    routesVar: 'DF_MCP_ROUTES',
    requiredVars: {
      MCP_HOSTNAME: 'DF_MCP_HOSTNAME',
      MCP_ALLOWED_ORIGINS: 'DF_MCP_ALLOWED_ORIGINS',
      PUBLIC_ORIGIN: 'DF_WEB_PUBLIC_ORIGIN',
    },
  },
  {
    app: 'web',
    template: 'wrangler.toml',
    output: 'wrangler.production.toml',
    hyperdriveVar: 'DF_HYPERDRIVE_ID_WEB',
    routesVar: 'DF_WEB_ROUTES',
    requiredVars: { PUBLIC_ORIGIN: 'DF_WEB_PUBLIC_ORIGIN' },
  },
];

/** Per-vertical edges are rendered only when their routes variable is set. */
function verticalEdgeWorkers(environment: Environment): readonly WorkerSpec[] {
  return EDGE_VERTICAL_TEMPLATES.flatMap(({ configPath, deploymentConfigPath }) => {
    const stem = verticalEdgeStem(verticalSlugOf(configPath));
    if ((environment[`DF_${stem}_ROUTES`] ?? '').trim() === '') return [];
    return [{
      app: 'edge',
      template: basename(configPath),
      output: basename(deploymentConfigPath),
      hyperdriveVar: `DF_HYPERDRIVE_ID_${stem}`,
      routesVar: `DF_${stem}_ROUTES`,
      optionalVars: { RAPIDAPI_HOSTNAME: `DF_${stem}_RAPIDAPI_HOSTNAME` },
      billingPrefix: `DF_${stem}`,
    }];
  });
}

function value(environment: Environment, name: string): string | undefined {
  const raw = environment[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Render every manifest, or throw a `DeploymentRenderError` naming only the
 * missing variables. Pure: reads the tracked templates and the given
 * environment, writes nothing.
 */
export async function renderDeploymentManifests(
  environment: Environment,
  repoRoot: string = REPO_ROOT,
): Promise<readonly RenderedManifest[]> {
  const problems: string[] = [];
  const need = (name: string): string => {
    const found = value(environment, name);
    if (found === undefined) problems.push(`${name} is required and is not set.`);
    return found ?? '';
  };

  const accountId = need('CLOUDFLARE_ACCOUNT_ID');
  const zoneName = need('DF_ZONE_NAME');
  const workers = [...ORDINARY_WORKERS, ...verticalEdgeWorkers(environment)];
  const rendered: RenderedManifest[] = [];

  for (const worker of workers) {
    const config = parse(await readFile(join(repoRoot, 'apps', worker.app, worker.template), 'utf8')) as TomlObject;
    const vars = { ...((config['vars'] as TomlObject | undefined) ?? {}) };
    const deployment: TomlObject = { account_id: accountId };
    if (worker.routesVar !== undefined) {
      const routes = need(worker.routesVar)
        .split(',')
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern !== '');
      deployment['routes'] = routes.map((pattern) => ({ pattern, zone_name: zoneName }));
    }
    for (const [name, source] of Object.entries(worker.requiredVars ?? {})) vars[name] = need(source);
    for (const [name, source] of Object.entries(worker.optionalVars ?? {})) {
      const found = value(environment, source);
      if (found !== undefined) vars[name] = found;
    }
    if (worker.billingPrefix !== undefined) {
      // Rendered verbatim; the topology check enforces all-or-nothing.
      for (const name of ['STRIPE_PRICE_IDS', 'BILLING_PUBLIC_ORIGIN', 'BILLING_RETURN_URL']) {
        const found = value(environment, `${worker.billingPrefix}_${name}`);
        if (found !== undefined) vars[name] = found;
      }
    }
    if (worker.app === 'acquisition-worker' && value(environment, 'DF_ACQUISITION_BROWSER_RUN') === 'true') {
      // A non-secret provider identity, required by Browser Run; equal to account_id.
      vars['CLOUDFLARE_ACCOUNT_ID'] = accountId;
    }
    const hyperdriveId = need(worker.hyperdriveVar);
    const { name, ...rest } = config;
    const manifest: TomlObject = {
      name,
      ...deployment,
      ...rest,
      vars,
      hyperdrive: [{ binding: 'HYPERDRIVE', id: hyperdriveId }],
    };
    rendered.push({ path: join('apps', worker.app, worker.output), content: stringify(manifest) });
  }

  if (problems.length > 0) throw new DeploymentRenderError([...new Set(problems)]);
  return rendered;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function run(environment: Environment = process.env, repoRoot: string = REPO_ROOT): Promise<number> {
  let manifests: readonly RenderedManifest[];
  try {
    manifests = await renderDeploymentManifests(environment, repoRoot);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Deployment manifests were not rendered.'}\n`);
    return 1;
  }
  const clobbered: string[] = [];
  for (const manifest of manifests) {
    if (await exists(join(repoRoot, manifest.path))) clobbered.push(manifest.path);
  }
  if (clobbered.length > 0) {
    process.stderr.write(
      `Refusing to overwrite existing ignored manifests: ${clobbered.join(', ')}. Remove them deliberately first.\n`,
    );
    return 1;
  }
  for (const manifest of manifests) {
    await writeFile(join(repoRoot, manifest.path), manifest.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  process.stdout.write(
    `Rendered ${manifests.length} ignored deployment manifest(s): ${manifests
      .map((manifest) => relative(repoRoot, join(repoRoot, manifest.path)))
      .join(', ')}.\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    () => {
      process.stderr.write('Deployment manifests were not rendered.\n');
      process.exitCode = 1;
    },
  );
}
