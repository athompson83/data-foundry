import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import {
  canonicalizeEndpointHostname,
  isUnsafeCanonicalProductionHostname,
  parseCanonicalProductionWorkerRoute,
} from '@data-foundry/canonical-schema';
import { isMain } from '../lib/cli-entry.js';
import { EDGE_VERTICAL_TEMPLATES } from '../lib/edge-vertical-templates.js';
import { RUNTIMES as EDGE_RUNTIMES } from '../../apps/edge/generated/runtime-registry.js';
import { MCP_RUNTIMES } from '../../apps/mcp-worker/generated/runtime-registry.js';
import { ACQUISITION_RUNTIMES } from '../../apps/acquisition-worker/generated/runtime-registry.js';
import { INGESTION_RUNTIMES } from '../../apps/ingestion-worker/generated/runtime-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const EDGE_CONFIG_PATH = join(REPO_ROOT, 'apps', 'edge', 'wrangler.toml');
export const CONSUMER_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'usage-consumer',
  'wrangler.toml',
);
export const WEB_CONFIG_PATH = join(REPO_ROOT, 'apps', 'web', 'wrangler.toml');
export const ACQUISITION_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'acquisition-worker',
  'wrangler.toml',
);
export const INGESTION_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'ingestion-worker',
  'wrangler.toml',
);
export const MCP_CONFIG_PATH = join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.toml');
export const PRIVATE_CANARY_CONFIG_PATH = join(REPO_ROOT, 'apps', 'private-canary', 'wrangler.toml');
export const PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'private-canary',
  'wrangler.production.toml',
);
export const EDGE_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'edge',
  'wrangler.private-canary.toml',
);
export const CONSUMER_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'usage-consumer',
  'wrangler.private-canary.toml',
);
export const WEB_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'web',
  'wrangler.private-canary.toml',
);
export const ACQUISITION_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'acquisition-worker',
  'wrangler.private-canary.toml',
);
export const INGESTION_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'ingestion-worker',
  'wrangler.private-canary.toml',
);
export const MCP_PRIVATE_CANARY_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'mcp-worker',
  'wrangler.private-canary.toml',
);
export const EDGE_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'edge',
  'wrangler.private-canary.production.toml',
);
export const CONSUMER_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'usage-consumer',
  'wrangler.private-canary.production.toml',
);
export const WEB_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'web',
  'wrangler.private-canary.production.toml',
);
export const ACQUISITION_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'acquisition-worker',
  'wrangler.private-canary.production.toml',
);
export const INGESTION_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'ingestion-worker',
  'wrangler.private-canary.production.toml',
);
export const MCP_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'mcp-worker',
  'wrangler.private-canary.production.toml',
);
export const EDGE_DEPLOYMENT_CONFIG_PATH = join(REPO_ROOT, 'apps', 'edge', 'wrangler.production.toml');
export const CONSUMER_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'usage-consumer',
  'wrangler.production.toml',
);
export const WEB_DEPLOYMENT_CONFIG_PATH = join(REPO_ROOT, 'apps', 'web', 'wrangler.production.toml');
export const ACQUISITION_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'acquisition-worker',
  'wrangler.production.toml',
);
export const INGESTION_DEPLOYMENT_CONFIG_PATH = join(
  REPO_ROOT,
  'apps',
  'ingestion-worker',
  'wrangler.production.toml',
);
export const MCP_DEPLOYMENT_CONFIG_PATH = join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.production.toml');

/** Re-exported from the dependency-free registry shared with operator tools. */
export { EDGE_VERTICAL_TEMPLATES } from '../lib/edge-vertical-templates.js';

/** The slugs each Worker bundle actually carries, read from its compiled registry. */
export interface BundledVerticals {
  readonly edge: readonly string[];
  readonly mcp: readonly string[];
  readonly acquisition: readonly string[];
  readonly ingestion: readonly string[];
}

export const BUNDLED_RUNTIME_VERTICALS: BundledVerticals = {
  edge: Object.keys(EDGE_RUNTIMES).sort(),
  mcp: Object.keys(MCP_RUNTIMES).sort(),
  acquisition: Object.keys(ACQUISITION_RUNTIMES).sort(),
  ingestion: Object.keys(INGESTION_RUNTIMES).sort(),
};

const VERTICAL_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const API_PATH_PREFIX_PATTERN = /^\/v1\/[a-z][a-z0-9-]{0,62}$/;

const USAGE_QUEUE = 'data-foundry-usage-events';
const USAGE_DLQ = 'data-foundry-usage-events-dlq';
const INGESTION_QUEUE = 'data-foundry-ingestion';
const INGESTION_DLQ = 'data-foundry-ingestion-dlq';
const PRIVATE_CANARY_USAGE_QUEUE = 'data-foundry-private-canary-usage-events';
const PRIVATE_CANARY_USAGE_DLQ = 'data-foundry-private-canary-usage-events-dlq';
const PRIVATE_CANARY_QUEUE = 'data-foundry-private-canary-events';
const PRIVATE_CANARY_DLQ = 'data-foundry-private-canary-dlq';
const PRIVATE_CANARY_QUARANTINE = 'data-foundry-private-canary-quarantine';
const PRIVATE_CANARY_RECEIPTS_BUCKET = 'data-foundry-private-canary-receipts';
const PRIVATE_CANARY_ENTRYPOINT = 'PrivateCanaryEntrypoint';
const PRIVATE_CANARY_TARGET_NAMES = {
  edge: 'data-foundry-private-canary-edge',
  web: 'data-foundry-private-canary-web',
  'usage-consumer': 'data-foundry-private-canary-usage-consumer',
  'acquisition-worker': 'data-foundry-private-canary-acquisition-worker',
  'ingestion-worker': 'data-foundry-private-canary-ingestion-worker',
  'mcp-worker': 'data-foundry-private-canary-mcp-hvac',
} as const;
const PRIVATE_CANARY_SERVICES = [
  ['EDGE_CANARY', PRIVATE_CANARY_TARGET_NAMES.edge],
  ['WEB_CANARY', PRIVATE_CANARY_TARGET_NAMES.web],
  ['USAGE_CONSUMER_CANARY', PRIVATE_CANARY_TARGET_NAMES['usage-consumer']],
  ['ACQUISITION_CANARY', PRIVATE_CANARY_TARGET_NAMES['acquisition-worker']],
  ['INGESTION_CANARY', PRIVATE_CANARY_TARGET_NAMES['ingestion-worker']],
  ['MCP_CANARY', PRIVATE_CANARY_TARGET_NAMES['mcp-worker']],
] as const;
const PRIVATE_CANARY_ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'observability',
  'vars',
  'queues',
  'r2_buckets',
  'services',
  // The tracked template intentionally omits this deployment fact. The
  // ignored production manifest must provide it and is checked separately.
  'account_id',
]);
const PRIVATE_CANARY_TARGET_ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'name',
  'account_id',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'observability',
  'vars',
  'hyperdrive',
  'queues',
]);
const PRIVATE_CANARY_TARGET_VARS = new Set([
  'DEPLOYMENT_ENVIRONMENT',
  'PRIVATE_CANARY_MODE',
]);
const PRIVATE_CANARY_SERVICE_BINDING_MODE = 'service-binding';

type TomlObject = Record<string, unknown>;

export interface CloudflareTopologyOptions {
  readonly mode?:
    | 'repository'
    | 'deployment'
    | 'private-canary'
    | 'private-canary-deployment'
    | 'private-canary-target'
    | 'private-canary-target-deployment'
    | 'private-canary-full-deployment';
  readonly edgeConfigPath?: string;
  readonly consumerConfigPath?: string;
  readonly webConfigPath?: string;
  readonly acquisitionConfigPath?: string;
  readonly ingestionConfigPath?: string;
  readonly mcpConfigPath?: string;
  /** Test seam for the ignored ordinary deployment manifests used by full canary validation. */
  readonly edgeDeploymentConfigPath?: string;
  readonly consumerDeploymentConfigPath?: string;
  readonly webDeploymentConfigPath?: string;
  readonly acquisitionDeploymentConfigPath?: string;
  readonly ingestionDeploymentConfigPath?: string;
  readonly mcpDeploymentConfigPath?: string;
  readonly privateCanaryConfigPath?: string;
  readonly edgePrivateCanaryConfigPath?: string;
  readonly consumerPrivateCanaryConfigPath?: string;
  readonly webPrivateCanaryConfigPath?: string;
  readonly acquisitionPrivateCanaryConfigPath?: string;
  readonly ingestionPrivateCanaryConfigPath?: string;
  readonly mcpPrivateCanaryConfigPath?: string;
  /** Test seam: tracked per-vertical edge templates (default: `EDGE_VERTICAL_TEMPLATES`). */
  readonly edgeVerticalConfigPaths?: readonly string[];
  /**
   * Test seam: ignored per-vertical edge deployment manifests. When supplied,
   * each must exist; by default a template's ignored manifest is validated
   * only when present.
   */
  readonly edgeVerticalDeploymentConfigPaths?: readonly string[];
  /** Test seam: the compiled runtime registries (default: the bundled ones). */
  readonly bundledVerticals?: Partial<BundledVerticals>;
}

export interface CloudflareTopologyReport {
  readonly errors: readonly string[];
  /** Non-failing, value-free operator notices (for example a deferred gate). */
  readonly notices: readonly string[];
}

function object(value: unknown): TomlObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as TomlObject)
    : {};
}

function objects(value: unknown): readonly TomlObject[] {
  return Array.isArray(value) ? value.map(object) : [];
}

async function parseConfig(path: string, label: string, errors: string[]): Promise<TomlObject> {
  try {
    return object(parse(await readFile(path, 'utf8')));
  } catch {
    errors.push(`${label} manifest could not be read and parsed as TOML.`);
    return {};
  }
}

function checkWorkerBase(label: string, config: TomlObject, errors: string[]): void {
  if (typeof config['name'] !== 'string' || config['name'].trim() === '') {
    errors.push(`${label} must declare a non-empty Worker name.`);
  }
  if (typeof config['main'] !== 'string' || config['main'].trim() === '') {
    errors.push(`${label} must declare a TypeScript entry point.`);
  }
  if (typeof config['compatibility_date'] !== 'string') {
    errors.push(`${label} must pin a compatibility_date.`);
  }
  const flags = config['compatibility_flags'];
  if (!Array.isArray(flags) || !flags.includes('nodejs_compat')) {
    errors.push(`${label} must enable nodejs_compat for pg over Hyperdrive.`);
  }
  if (object(config['observability'])['enabled'] !== true) {
    errors.push(`${label} must enable Cloudflare observability.`);
  }
  if (config['workers_dev'] !== false) {
    errors.push(`${label} must set workers_dev = false.`);
  }
  if (config['preview_urls'] !== false) {
    errors.push(`${label} must set preview_urls = false.`);
  }
  if (object(object(config['observability'])['logs'])['invocation_logs'] !== false) {
    errors.push(`${label} must set observability.logs.invocation_logs = false.`);
  }
  if (object(config['vars'])['DEPLOYMENT_ENVIRONMENT'] !== 'production') {
    errors.push(`${label} must set DEPLOYMENT_ENVIRONMENT="production".`);
  }
}

function collectKeyPaths(value: unknown, wanted: ReadonlySet<string>, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectKeyPaths(entry, wanted, `${prefix}[${index}]`));
  }
  if (value === null || typeof value !== 'object') return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as TomlObject)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (wanted.has(key)) paths.push(path);
    paths.push(...collectKeyPaths(child, wanted, path));
  }
  return paths;
}

function valuesAtKey(value: unknown, wanted: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((entry) => valuesAtKey(entry, wanted));
  if (value === null || typeof value !== 'object') return [];
  const found: unknown[] = [];
  for (const [key, child] of Object.entries(value as TomlObject)) {
    if (key === wanted) found.push(child);
    found.push(...valuesAtKey(child, wanted));
  }
  return found;
}

function keyNames(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(keyNames);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as TomlObject).flatMap(([key, child]) => [key, ...keyNames(child)]);
}

function checkRepositoryPolicy(label: string, config: TomlObject, errors: string[]): void {
  for (const path of collectKeyPaths(config, new Set(['account_id', 'route', 'routes']))) {
    errors.push(`${label} commits deployment-specific ${path}; supply it outside the repository.`);
  }
  const hyperdrive = valuesAtKey(config, 'hyperdrive').flatMap(objects);
  if (hyperdrive.some((binding) => typeof binding['id'] === 'string')) {
    errors.push(`${label} commits a Hyperdrive id; inject the HYPERDRIVE binding during deployment.`);
  }
  const forbiddenDeploymentVariables = new Set([
    'POSTGRES_URL',
    'RAPIDAPI_PROXY_SECRET',
    'RAPIDAPI_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CRAWL4AI_API_TOKEN',
    'PUBLIC_ORIGIN',
    'MCP_HOSTNAME',
    'MCP_ALLOWED_ORIGINS',
    'RAPIDAPI_HOSTNAME',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_IDS',
    'BILLING_PUBLIC_ORIGIN',
    'BILLING_RETURN_URL',
  ]);
  for (const vars of valuesAtKey(config, 'vars')) {
    for (const key of keyNames(object(vars))) {
      if (forbiddenDeploymentVariables.has(key.toUpperCase()) || isPlaintextProtectedKey(key)) {
        errors.push(
          `${label} commits ${key} in vars; configure provider identity and credentials outside the repository.`,
        );
      }
    }
  }
}

/**
 * The private canary is intentionally outside the six database-backed
 * runtime roles. It proves their service-bound capabilities after the usage
 * consumer has placed a fixed synthetic envelope on a dedicated canary DLQ;
 * it must therefore never acquire an HTTP route, Hyperdrive, or usage-DLQ
 * capability.
 */
function checkPrivateCanaryTopology(config: TomlObject, errors: string[]): void {
  for (const field of Object.keys(config)) {
    if (!PRIVATE_CANARY_ALLOWED_TOP_LEVEL_FIELDS.has(field)) {
      errors.push(`private-canary must not declare the ${field} top-level capability.`);
    }
  }
  if (config['name'] !== 'data-foundry-private-canary') {
    errors.push('private-canary must use the data-foundry-private-canary Worker name.');
  }
  if (config['main'] !== 'src/index.ts') {
    errors.push('private-canary must use src/index.ts as its queue-only entry point.');
  }
  if (collectKeyPaths(config, new Set(['route', 'routes'])).length !== 0) {
    errors.push('private-canary must remain route-less; service bindings and Queues are its only invocation paths.');
  }
  if (valuesAtKey(config, 'hyperdrive').length !== 0) {
    errors.push('private-canary must not bind Hyperdrive; only the six runtime Workers have role-specific database identities.');
  }
  if (config['triggers'] !== undefined) {
    errors.push('private-canary must not declare Cron or other scheduled triggers.');
  }

  const vars = object(config['vars']);
  if (
    Object.keys(vars).length !== 1 ||
    vars['DEPLOYMENT_ENVIRONMENT'] !== 'production'
  ) {
    errors.push('private-canary vars must contain only DEPLOYMENT_ENVIRONMENT="production".');
  }

  const queues = object(config['queues']);
  const producers = objects(queues['producers']);
  if (producers.length !== 0) {
    errors.push('private-canary must not declare Queue producers or a third canary queue.');
  }
  const consumers = objects(queues['consumers']);
  if (consumers.length !== 1) {
    errors.push('private-canary must declare exactly one dedicated canary DLQ consumer.');
  }
  const consumer = consumers[0] ?? {};
  if (consumer['queue'] !== PRIVATE_CANARY_DLQ) {
    errors.push(`private-canary must consume only ${PRIVATE_CANARY_DLQ}, never ${USAGE_DLQ}.`);
  }
  if (consumer['max_batch_size'] !== 1 || consumer['max_batch_timeout'] !== 1) {
    errors.push('private-canary dedicated DLQ consumer must process one message with a one-second batch timeout.');
  }
  if (
    consumer['max_retries'] !== 3 ||
    consumer['dead_letter_queue'] !== PRIVATE_CANARY_QUARANTINE
  ) {
    errors.push(
      `private-canary dedicated DLQ consumer must retry three times to ${PRIVATE_CANARY_QUARANTINE}.`,
    );
  }
  if (Object.keys(queues).some((key) => key !== 'consumers')) {
    errors.push('private-canary must declare only its one DLQ consumer under queues.');
  }

  const buckets = objects(config['r2_buckets']);
  if (
    buckets.length !== 1 ||
    buckets[0]?.['binding'] !== 'CANARY_RECEIPTS' ||
    buckets[0]?.['bucket_name'] !== PRIVATE_CANARY_RECEIPTS_BUCKET
  ) {
    errors.push(
      `private-canary must bind CANARY_RECEIPTS only to ${PRIVATE_CANARY_RECEIPTS_BUCKET}.`,
    );
  }

  const services = objects(config['services']);
  if (services.length !== PRIVATE_CANARY_SERVICES.length) {
    errors.push('private-canary must declare exactly six named RPC service bindings.');
  }
  for (const [bindingName, serviceName] of PRIVATE_CANARY_SERVICES) {
    const binding = services.find((candidate) => candidate['binding'] === bindingName);
    if (binding === undefined || binding['service'] !== serviceName) {
      errors.push(`private-canary ${bindingName} must bind exactly to ${serviceName}.`);
      continue;
    }
    if (Object.keys(binding).some((key) => key !== 'binding' && key !== 'service' && key !== 'entrypoint')) {
      errors.push('private-canary service bindings must not select an unreviewed Worker environment or capability.');
    }
    if (binding['entrypoint'] !== PRIVATE_CANARY_ENTRYPOINT) {
      errors.push(
        `private-canary ${bindingName} must target ${PRIVATE_CANARY_ENTRYPOINT}, not an HTTP service fetch handler.`,
      );
    }
  }
}

interface PrivateCanaryTarget {
  readonly label: string;
  readonly expectedName: string;
  readonly config: TomlObject;
  readonly queueTopology: 'producer' | 'consumer' | 'none';
}

interface OrdinaryWorker {
  readonly label: string;
  readonly config: TomlObject;
}

async function loadPrivateCanaryTargets(
  options: CloudflareTopologyOptions,
  deployment: boolean,
  errors: string[],
): Promise<readonly PrivateCanaryTarget[]> {
  return [
    {
      label: 'edge',
      expectedName: PRIVATE_CANARY_TARGET_NAMES.edge,
      config: await parseConfig(
        options.edgePrivateCanaryConfigPath ?? (
          deployment ? EDGE_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : EDGE_PRIVATE_CANARY_CONFIG_PATH
        ),
        'edge',
        errors,
      ),
      queueTopology: 'producer',
    },
    {
      label: 'usage-consumer',
      expectedName: PRIVATE_CANARY_TARGET_NAMES['usage-consumer'],
      config: await parseConfig(
        options.consumerPrivateCanaryConfigPath ?? (
          deployment ? CONSUMER_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : CONSUMER_PRIVATE_CANARY_CONFIG_PATH
        ),
        'usage-consumer',
        errors,
      ),
      queueTopology: 'consumer',
    },
    {
      label: 'web',
      expectedName: PRIVATE_CANARY_TARGET_NAMES.web,
      config: await parseConfig(
        options.webPrivateCanaryConfigPath ?? (
          deployment ? WEB_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : WEB_PRIVATE_CANARY_CONFIG_PATH
        ),
        'web',
        errors,
      ),
      queueTopology: 'none',
    },
    {
      label: 'acquisition-worker',
      expectedName: PRIVATE_CANARY_TARGET_NAMES['acquisition-worker'],
      config: await parseConfig(
        options.acquisitionPrivateCanaryConfigPath ?? (
          deployment ? ACQUISITION_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : ACQUISITION_PRIVATE_CANARY_CONFIG_PATH
        ),
        'acquisition-worker',
        errors,
      ),
      queueTopology: 'none',
    },
    {
      label: 'ingestion-worker',
      expectedName: PRIVATE_CANARY_TARGET_NAMES['ingestion-worker'],
      config: await parseConfig(
        options.ingestionPrivateCanaryConfigPath ?? (
          deployment ? INGESTION_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : INGESTION_PRIVATE_CANARY_CONFIG_PATH
        ),
        'ingestion-worker',
        errors,
      ),
      queueTopology: 'none',
    },
    {
      label: 'mcp-worker',
      expectedName: PRIVATE_CANARY_TARGET_NAMES['mcp-worker'],
      config: await parseConfig(
        options.mcpPrivateCanaryConfigPath ?? (
          deployment ? MCP_PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH : MCP_PRIVATE_CANARY_CONFIG_PATH
        ),
        'mcp-worker',
        errors,
      ),
      queueTopology: 'producer',
    },
  ];
}

async function loadOrdinaryWorkers(
  options: CloudflareTopologyOptions,
  errors: string[],
  deployment = false,
): Promise<readonly OrdinaryWorker[]> {
  return [
    {
      label: 'edge',
      config: await parseConfig(
        deployment
          ? options.edgeDeploymentConfigPath ?? EDGE_DEPLOYMENT_CONFIG_PATH
          : options.edgeConfigPath ?? EDGE_CONFIG_PATH,
        'edge',
        errors,
      ),
    },
    {
      label: 'usage-consumer',
      config: await parseConfig(
        deployment
          ? options.consumerDeploymentConfigPath ?? CONSUMER_DEPLOYMENT_CONFIG_PATH
          : options.consumerConfigPath ?? CONSUMER_CONFIG_PATH,
        'usage-consumer',
        errors,
      ),
    },
    {
      label: 'web',
      config: await parseConfig(
        deployment
          ? options.webDeploymentConfigPath ?? WEB_DEPLOYMENT_CONFIG_PATH
          : options.webConfigPath ?? WEB_CONFIG_PATH,
        'web',
        errors,
      ),
    },
    {
      label: 'acquisition-worker',
      config: await parseConfig(
        deployment
          ? options.acquisitionDeploymentConfigPath ?? ACQUISITION_DEPLOYMENT_CONFIG_PATH
          : options.acquisitionConfigPath ?? ACQUISITION_CONFIG_PATH,
        'acquisition-worker',
        errors,
      ),
    },
    {
      label: 'ingestion-worker',
      config: await parseConfig(
        deployment
          ? options.ingestionDeploymentConfigPath ?? INGESTION_DEPLOYMENT_CONFIG_PATH
          : options.ingestionConfigPath ?? INGESTION_CONFIG_PATH,
        'ingestion-worker',
        errors,
      ),
    },
    {
      label: 'mcp-worker',
      config: await parseConfig(
        deployment
          ? options.mcpDeploymentConfigPath ?? MCP_DEPLOYMENT_CONFIG_PATH
          : options.mcpConfigPath ?? MCP_CONFIG_PATH,
        'mcp-worker',
        errors,
      ),
    },
  ];
}

function collectOrdinaryWorkerNames(
  ordinaryWorkers: readonly OrdinaryWorker[],
  errors: string[],
): ReadonlySet<string> {
  const ordinaryNames = new Set<string>();
  for (const ordinaryWorker of ordinaryWorkers) {
    const name = ordinaryWorker.config['name'];
    if (typeof name !== 'string' || name.length === 0) {
      errors.push(
        `${ordinaryWorker.label} ordinary Worker manifest must declare a non-empty Worker name before private-canary identity isolation can be checked.`,
      );
      continue;
    }
    ordinaryNames.add(name);
  }
  return ordinaryNames;
}

function checkPrivateCanaryHarnessIdentityIsolation(
  privateCanary: TomlObject,
  ordinaryWorkerNames: ReadonlySet<string>,
  errors: string[],
): void {
  if (
    typeof privateCanary['name'] === 'string' &&
    ordinaryWorkerNames.has(privateCanary['name'])
  ) {
    errors.push('private-canary harness must not reuse an ordinary Worker name.');
  }
}

function checkPrivateCanaryTargetIdentityIsolation(
  targets: readonly PrivateCanaryTarget[],
  ordinaryWorkerNames: ReadonlySet<string>,
  errors: string[],
): void {
  for (const target of targets) {
    if (
      typeof target.config['name'] === 'string' &&
      ordinaryWorkerNames.has(target.config['name'])
    ) {
      errors.push(`${target.label} private-canary target must not reuse an ordinary Worker name.`);
    }
  }
}

/**
 * The six database-role Workers use a deliberately different manifest while
 * the synthetic canary is running. The template must have no public transport
 * capability; only the harness's named RPC binding may call its entrypoint.
 */
function checkPrivateCanaryTargetTopology(
  target: PrivateCanaryTarget,
  errors: string[],
): void {
  const { label, expectedName, config } = target;
  for (const field of Object.keys(config)) {
    if (!PRIVATE_CANARY_TARGET_ALLOWED_TOP_LEVEL_FIELDS.has(field)) {
      errors.push(`${label} private-canary target must not declare the ${field} top-level capability.`);
    }
  }
  if (config['name'] !== expectedName) {
    errors.push(`${label} private-canary target must use the ${expectedName} Worker name.`);
  }
  if (config['main'] !== 'src/index.ts') {
    errors.push(`${label} private-canary target must use src/index.ts as its entry point.`);
  }
  if (collectKeyPaths(config, new Set(['route', 'routes'])).length !== 0) {
    errors.push(`${label} private-canary target must remain route-less.`);
  }
  if (config['triggers'] !== undefined) {
    errors.push(`${label} private-canary target must not declare a Cron or other trigger.`);
  }
  if (valuesAtKey(config, 'r2_buckets').length !== 0) {
    errors.push(`${label} private-canary target must not bind R2.`);
  }
  if (valuesAtKey(config, 'services').length !== 0) {
    errors.push(`${label} private-canary target must not declare outbound service bindings.`);
  }

  const vars = object(config['vars']);
  const variableNames = Object.keys(vars);
  if (
    variableNames.length !== PRIVATE_CANARY_TARGET_VARS.size ||
    variableNames.some((key) => !PRIVATE_CANARY_TARGET_VARS.has(key))
  ) {
    errors.push(
      `${label} private-canary target vars must contain only DEPLOYMENT_ENVIRONMENT and PRIVATE_CANARY_MODE.`,
    );
  }
  if (vars['DEPLOYMENT_ENVIRONMENT'] !== 'production') {
    errors.push(`${label} private-canary target must set DEPLOYMENT_ENVIRONMENT="production".`);
  }
  if (vars['PRIVATE_CANARY_MODE'] !== PRIVATE_CANARY_SERVICE_BINDING_MODE) {
    errors.push(
      `${label} private-canary target must set PRIVATE_CANARY_MODE="${PRIVATE_CANARY_SERVICE_BINDING_MODE}".`,
    );
  }

  const forbiddenEndpointVariables = new Set([
    'POSTGRES_URL',
    'PUBLIC_ORIGIN',
    'PUBLIC_CACHE_MODE',
    'MCP_HOSTNAME',
    'MCP_ALLOWED_ORIGINS',
    'RAPIDAPI_HOSTNAME',
    'RAPIDAPI_PROXY_SECRET',
    'RAPIDAPI_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_IDS',
    'BILLING_PUBLIC_ORIGIN',
    'BILLING_RETURN_URL',
  ]);
  for (const path of collectKeyPaths(config, forbiddenEndpointVariables)) {
    errors.push(`${label} private-canary target must not configure ${path}.`);
  }
  for (const varsValue of valuesAtKey(config, 'vars')) {
    for (const key of keyNames(object(varsValue))) {
      if (isPlaintextProtectedKey(key)) {
        errors.push(`${label} private-canary target must not configure protected variable ${key}.`);
      }
    }
  }
}

function checkPrivateCanaryTargetQueueTopology(
  target: PrivateCanaryTarget,
  errors: string[],
): void {
  const queues = object(target.config['queues']);
  if (target.queueTopology === 'none') {
    if (Object.keys(queues).length !== 0) {
      errors.push(`${target.label} private-canary target must not declare Queue bindings.`);
    }
    return;
  }

  if (target.queueTopology === 'producer') {
    if (Object.keys(queues).some((key) => key !== 'producers')) {
      errors.push(`${target.label} private-canary target must declare only its dedicated canary metering Queue producer.`);
    }
    const producers = objects(queues['producers']);
    if (producers.length !== 1) {
      errors.push(`${target.label} private-canary target must declare exactly one dedicated canary metering Queue producer.`);
      return;
    }
    const producer = producers[0] ?? {};
    if (producer['binding'] !== 'USAGE_EVENTS_QUEUE' || producer['queue'] !== PRIVATE_CANARY_USAGE_QUEUE) {
      errors.push(`${target.label} private-canary target must produce only to ${PRIVATE_CANARY_USAGE_QUEUE} as USAGE_EVENTS_QUEUE.`);
    }
    return;
  }

  if (Object.keys(queues).some((key) => key !== 'consumers')) {
    errors.push('usage-consumer private-canary target must declare only its dedicated canary Queue consumers.');
  }
  const consumers = objects(queues['consumers']);
  if (consumers.length !== 2) {
    errors.push('usage-consumer private-canary target must declare exactly one canary metering and one canary ingress Queue consumer.');
    return;
  }
  const consumer = consumers.find((candidate) => candidate['queue'] === PRIVATE_CANARY_USAGE_QUEUE) ?? {};
  if (
    consumer['queue'] !== PRIVATE_CANARY_USAGE_QUEUE ||
    consumer['max_batch_size'] !== 100 ||
    consumer['max_batch_timeout'] !== 5 ||
    consumer['max_retries'] !== 3 ||
    consumer['dead_letter_queue'] !== PRIVATE_CANARY_USAGE_DLQ
  ) {
    errors.push(
      `usage-consumer private-canary target must route ${PRIVATE_CANARY_USAGE_QUEUE} retries to ${PRIVATE_CANARY_USAGE_DLQ}.`,
    );
  }
  const canaryConsumer = consumers.find((candidate) => candidate['queue'] === PRIVATE_CANARY_QUEUE) ?? {};
  if (
    canaryConsumer['queue'] !== PRIVATE_CANARY_QUEUE ||
    canaryConsumer['max_batch_size'] !== 1 ||
    canaryConsumer['max_batch_timeout'] !== 1 ||
    canaryConsumer['max_retries'] !== 3 ||
    canaryConsumer['dead_letter_queue'] !== PRIVATE_CANARY_DLQ
  ) {
    errors.push(
      `usage-consumer private-canary target must route ${PRIVATE_CANARY_QUEUE} retries to ${PRIVATE_CANARY_DLQ}.`,
    );
  }
}

interface ExactProductionOrigin {
  readonly hostname: string;
  readonly origin: string;
}

function parseExactProductionOrigin(value: unknown): ExactProductionOrigin | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.origin !== value ||
      parsed.hostname !== canonicalizeEndpointHostname(parsed.hostname) ||
      isUnsafeCanonicalProductionHostname(parsed.hostname)
    ) {
      return null;
    }
    return { hostname: parsed.hostname, origin: parsed.origin };
  } catch {
    return null;
  }
}

function isExactProductionOrigin(value: unknown): boolean {
  return parseExactProductionOrigin(value) !== null;
}

function parseExactProductionHostname(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const hostname = value.trim();
  if (
    hostname !== value ||
    hostname !== canonicalizeEndpointHostname(hostname) ||
    isUnsafeCanonicalProductionHostname(hostname)
  ) {
    return null;
  }
  try {
    const parsed = new URL(`https://${hostname}`);
    return parsed.hostname === hostname &&
      parsed.port === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
      ? hostname
      : null;
  } catch {
    return null;
  }
}

function routeValues(config: TomlObject): readonly string[] {
  const visit = (value: unknown): string[] => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(visit);
    const candidate = object(value);
    return [candidate['pattern'], candidate['route']].flatMap(visit);
  };
  return [config['route'], config['routes']].flatMap(visit);
}

function isExactCloudflareId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) && !/^0{32}$/.test(value);
}

function isPlaintextProtectedKey(key: string): boolean {
  const normalized = key.toUpperCase();
  if (normalized === 'API_KEY_ENVIRONMENT') return false;
  return normalized === 'POSTGRES_URL' ||
    normalized === 'RAPIDAPI_PROXY_SECRET' ||
    normalized === 'RAPIDAPI_API_KEY' ||
    normalized === 'CLOUDFLARE_API_TOKEN' ||
    normalized === 'CRAWL4AI_API_TOKEN' ||
    normalized === 'STRIPE_SECRET_KEY' ||
    /(?:PASSWORD|PASSWD|TOKEN|SECRET|SECRET_?KEY)$/.test(normalized) ||
    /(?:API_?KEY|API_?SECRET|PRIVATE_?KEY)$/.test(normalized);
}

function checkPlaintextProtectedVars(label: string, config: TomlObject, errors: string[]): void {
  for (const key of keyNames(object(config['vars']))) {
    if (isPlaintextProtectedKey(key)) {
      errors.push(`${label} commits plaintext protected variable ${key}; use provider secrets or bindings.`);
    }
  }
}

const DEPLOYMENT_TOP_LEVEL_FIELDS = new Set([
  'account_id',
  'route',
  'routes',
  'vars',
  'hyperdrive',
]);

function checkDeploymentFieldLocations(label: string, config: TomlObject, errors: string[]): void {
  for (const path of collectKeyPaths(config, DEPLOYMENT_TOP_LEVEL_FIELDS)) {
    if (!DEPLOYMENT_TOP_LEVEL_FIELDS.has(path)) {
      errors.push(
        `${label} deployment manifest places ${path} below the top level; deployment-only fields must be top-level.`,
      );
    }
  }
}

function checkDeploymentWorker(label: string, config: TomlObject, errors: string[]): void {
  checkDeploymentFieldLocations(label, config, errors);
  const bindings = objects(config['hyperdrive']);
  if (
    bindings.length !== 1 ||
    bindings.some((binding) =>
      Object.keys(binding).length !== 2 ||
      binding['binding'] !== 'HYPERDRIVE' ||
      !isExactCloudflareId(binding['id']),
    )
  ) {
    errors.push(
      `${label} deployment manifest must bind exactly one HYPERDRIVE binding with a non-zero lowercase 32-hex id.`,
    );
  }
  checkPlaintextProtectedVars(label, config, errors);
}

function deploymentAccountId(label: string, config: TomlObject, errors: string[]): string | null {
  const value = config['account_id'];
  if (!isExactCloudflareId(value)) {
    errors.push(
      `${label} deployment manifest must declare a non-zero lowercase 32-hex account_id.`,
    );
    return null;
  }
  return value;
}

function checkDeploymentAccountIds(
  manifests: readonly (readonly [label: string, config: TomlObject])[],
  errors: string[],
): string | null {
  const accountIds = manifests
    .map(([label, config]) => deploymentAccountId(label, config, errors))
    .filter((value): value is string => value !== null);
  if (new Set(accountIds).size > 1) {
    errors.push('Cloudflare deployment manifests must target one canonical account_id.');
  }
  return accountIds.length === manifests.length && new Set(accountIds).size === 1
    ? accountIds[0] ?? null
    : null;
}

function checkDistinctDeploymentHyperdriveIds(
  manifests: readonly (readonly [label: string, config: TomlObject])[],
  errors: string[],
): void {
  const hyperdriveIds = manifests.map(([, config]) => {
    const bindings = objects(config['hyperdrive'])
      .filter((binding) => binding['binding'] === 'HYPERDRIVE')
      .map((binding) => binding['id'])
      .filter(isExactCloudflareId);
    return bindings.length === 1 ? bindings[0] ?? null : null;
  });
  if (
    hyperdriveIds.every((id): id is string => id !== null) &&
    new Set(hyperdriveIds).size !== manifests.length
  ) {
    errors.push('Deployment manifests must bind six distinct Hyperdrive configuration ids, one per Worker role.');
  }
}

function checkAcquisitionProviderAccountId(
  acquisition: TomlObject,
  canonicalAccountId: string | null,
  errors: string[],
): void {
  const providerAccountId = object(acquisition['vars'])['CLOUDFLARE_ACCOUNT_ID'];
  if (providerAccountId === undefined) return;
  if (!isExactCloudflareId(providerAccountId) || providerAccountId !== canonicalAccountId) {
    errors.push(
      'acquisition-worker CLOUDFLARE_ACCOUNT_ID must exactly match the canonical account_id as a non-zero lowercase 32-hex value.',
    );
  }
}

interface EdgeRoute {
  readonly hostname: string;
  readonly pattern: string;
  readonly wildcard: boolean;
}

/**
 * An edge route for this deployment's path shape. An un-prefixed edge keeps
 * the historical `<public-host>/*`. A prefixed edge may claim only its own
 * `<public-host>/v1/<slug>/*` (and optionally the exact `<public-host>/v1/<slug>`
 * contract document): a looser `/v1/<slug>*` would also capture another
 * vertical such as `/v1/<slug>-archive/`.
 */
function parseEdgeRoute(value: string, prefix: string | null): EdgeRoute | null {
  if (prefix === null) {
    const route = parseCanonicalProductionWorkerRoute(value);
    return route === null ? null : { hostname: route.hostname, pattern: route.pattern, wildcard: true };
  }
  for (const [suffix, wildcard] of [[`${prefix}/*`, true], [prefix, false]] as const) {
    if (!value.endsWith(suffix)) continue;
    const route = parseCanonicalProductionWorkerRoute(`${value.slice(0, -suffix.length)}/*`);
    if (route !== null) return { hostname: route.hostname, pattern: value, wildcard };
  }
  return null;
}

/** The deployment's validated `API_PATH_PREFIX`, `null` when absent, or `undefined` when invalid. */
function edgeApiPathPrefix(config: TomlObject): string | null | undefined {
  const vars = object(config['vars']);
  const value = vars['API_PATH_PREFIX'];
  if (value === undefined) return null;
  const slug = vars['VERTICAL_SLUG'];
  return typeof value === 'string' &&
    API_PATH_PREFIX_PATTERN.test(value) &&
    typeof slug === 'string' &&
    value === `/v1/${slug}`
    ? value
    : undefined;
}

function checkApiPathPrefix(label: string, config: TomlObject, required: boolean, errors: string[]): void {
  const vars = object(config['vars']);
  if (vars['API_PATH_PREFIX'] === undefined) {
    if (required) {
      errors.push(`${label} must set API_PATH_PREFIX to exactly /v1/<VERTICAL_SLUG>.`);
    }
    return;
  }
  if (edgeApiPathPrefix(config) === undefined) {
    errors.push(
      `${label} API_PATH_PREFIX must match ^/v1/[a-z][a-z0-9-]{0,62}$ and equal /v1/<VERTICAL_SLUG> exactly.`,
    );
  }
}

function isHttpsProductionUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname === canonicalizeEndpointHostname(parsed.hostname) &&
      !isUnsafeCanonicalProductionHostname(parsed.hostname);
  } catch {
    return false;
  }
}

const EDGE_BILLING_VARS = ['STRIPE_PRICE_IDS', 'BILLING_PUBLIC_ORIGIN', 'BILLING_RETURN_URL'] as const;

/**
 * Self-service billing is all-or-nothing in the runtime (ADR-0014); the
 * deployment check refuses a manifest that would boot into that refusal, and
 * binds the Checkout return origin to a DIRECT route this Worker serves. The
 * two Stripe secrets are Worker secrets and are refused in vars elsewhere.
 */
function checkEdgeBilling(
  label: string,
  vars: TomlObject,
  directHosts: ReadonlySet<string>,
  errors: string[],
): void {
  const present = EDGE_BILLING_VARS.filter((key) => vars[key] !== undefined);
  if (present.length === 0) return;
  if (present.length !== EDGE_BILLING_VARS.length) {
    errors.push(
      `${label} billing vars STRIPE_PRICE_IDS, BILLING_PUBLIC_ORIGIN and BILLING_RETURN_URL must be configured together.`,
    );
    return;
  }
  const origin = parseExactProductionOrigin(vars['BILLING_PUBLIC_ORIGIN']);
  if (origin === null) {
    errors.push(`${label} BILLING_PUBLIC_ORIGIN must be a non-loopback exact HTTPS origin.`);
  } else if (!directHosts.has(origin.hostname)) {
    errors.push(
      `${label} BILLING_PUBLIC_ORIGIN hostname must match a DIRECT (non-RapidAPI) route of the same edge deployment.`,
    );
  }
  if (!isHttpsProductionUrl(vars['BILLING_RETURN_URL'])) {
    errors.push(`${label} BILLING_RETURN_URL must be a non-loopback absolute HTTPS URL.`);
  }
  let priceIds: unknown = null;
  try {
    priceIds = typeof vars['STRIPE_PRICE_IDS'] === 'string' ? JSON.parse(vars['STRIPE_PRICE_IDS']) : null;
  } catch {
    priceIds = null;
  }
  const entries = priceIds !== null && typeof priceIds === 'object' && !Array.isArray(priceIds)
    ? Object.entries(priceIds as Record<string, unknown>)
    : [];
  if (
    entries.length === 0 ||
    entries.some(
      ([code, id]) =>
        !/^[a-z][a-z0-9-]{0,63}$/.test(code) || typeof id !== 'string' || !/^price_[A-Za-z0-9]{1,255}$/.test(id),
    )
  ) {
    errors.push(`${label} STRIPE_PRICE_IDS must be a non-empty JSON object mapping plan codes to Stripe price ids.`);
  }
}

/**
 * Every edge deployment (the primary `apps/edge` Worker plus any per-vertical
 * edge) may share one public host such as `api.data.aroqon.com`, but no two may
 * claim the same route pattern, and a prefixed Worker may claim only its own
 * `/v1/<slug>` routes.
 */
function checkEdgeDeploymentEndpoints(edges: readonly OrdinaryWorker[], errors: string[]): void {
  const claimed = new Map<string, string>();
  for (const { label, config } of edges) {
    const prefix = edgeApiPathPrefix(config);
    if (prefix === undefined) continue; // Reported by checkApiPathPrefix.
    const routes = routeValues(config);
    const parsed = routes.map((route) => parseEdgeRoute(route, prefix));
    if (prefix === null) {
      if (routes.length === 0 || parsed.some((route) => route === null)) {
        errors.push(`${label} deployment manifest must declare canonical production route(s) as lowercase public-host/* patterns.`);
      }
    } else if (
      routes.length === 0 ||
      parsed.some((route) => route === null) ||
      !parsed.some((route) => route?.wildcard === true)
    ) {
      errors.push(
        `${label} deployment manifest routes must be exactly <public-host>${prefix}/* (optionally also <public-host>${prefix}) for its API_PATH_PREFIX.`,
      );
    }
    for (const route of parsed) {
      if (route === null) continue;
      const owner = claimed.get(route.pattern);
      if (owner !== undefined && owner !== label) {
        errors.push(
          `${label} and ${owner} deployment manifests claim the same edge route pattern; each vertical edge Worker needs its own /v1/<slug> routes.`,
        );
      }
      claimed.set(route.pattern, label);
    }

    const routeHosts = new Set(
      parsed.filter((route): route is EdgeRoute => route !== null).map((route) => route.hostname),
    );
    const vars = object(config['vars']);
    const rapidApiHostname = parseExactProductionHostname(vars['RAPIDAPI_HOSTNAME']);
    if (vars['RAPIDAPI_HOSTNAME'] !== undefined && rapidApiHostname === null) {
      errors.push(`${label} RAPIDAPI_HOSTNAME must be a non-loopback exact production hostname when configured.`);
    } else if (rapidApiHostname !== null && !routeHosts.has(rapidApiHostname)) {
      errors.push(`${label} RAPIDAPI_HOSTNAME must match an edge canonical production route hostname.`);
    } else if (rapidApiHostname !== null && [...routeHosts].every((hostname) => hostname === rapidApiHostname)) {
      errors.push(`${label} RAPIDAPI_HOSTNAME requires a distinct DIRECT API canonical edge route hostname.`);
    }
    const directHosts = new Set([...routeHosts].filter((hostname) => hostname !== rapidApiHostname));
    checkEdgeBilling(label, vars, directHosts, errors);
  }
}

function checkDeploymentEndpoints(
  edges: readonly OrdinaryWorker[],
  web: TomlObject,
  mcp: TomlObject,
  errors: string[],
): void {
  const routeHosts = (config: TomlObject): ReadonlySet<string> =>
    new Set(
      routeValues(config)
        .map((route) => parseCanonicalProductionWorkerRoute(route))
        .filter((route) => route !== null)
        .map((route) => route.hostname),
    );
  const webRouteHosts = routeHosts(web);
  const mcpRouteHosts = routeHosts(mcp);
  checkEdgeDeploymentEndpoints(edges, errors);
  for (const [label, config] of [['web', web], ['mcp-worker', mcp]] as const) {
    const routes = routeValues(config);
    if (
      routes.length === 0 ||
      routes.some((route) => parseCanonicalProductionWorkerRoute(route) === null)
    ) {
      errors.push(`${label} deployment manifest must declare canonical production route(s) as lowercase public-host/* patterns.`);
    }
  }

  const webVars = object(web['vars']);
  const webPublicOrigin = parseExactProductionOrigin(webVars['PUBLIC_ORIGIN']);
  if (webPublicOrigin === null) {
    errors.push('web deployment manifest must provide a non-loopback exact HTTPS PUBLIC_ORIGIN.');
  } else if (!webRouteHosts.has(webPublicOrigin.hostname)) {
    errors.push('web PUBLIC_ORIGIN hostname must match a web canonical production route hostname.');
  }
  if (webVars['PUBLIC_CACHE_MODE'] !== 'no-store') {
    errors.push('web deployment manifest must provide PUBLIC_CACHE_MODE as exactly no-store.');
  }

  const mcpVars = object(mcp['vars']);
  const mcpHostname = parseExactProductionHostname(mcpVars['MCP_HOSTNAME']);
  if (mcpHostname === null) {
    errors.push('mcp-worker deployment manifest must provide a non-loopback exact MCP_HOSTNAME.');
  } else if (!mcpRouteHosts.has(mcpHostname)) {
    errors.push('MCP_HOSTNAME must match an mcp-worker canonical production route hostname.');
  }
  const mcpPublicOrigin = parseExactProductionOrigin(mcpVars['PUBLIC_ORIGIN']);
  if (mcpPublicOrigin === null) {
    errors.push('mcp-worker deployment manifest must provide a non-loopback exact HTTPS PUBLIC_ORIGIN.');
  } else if (webPublicOrigin !== null && mcpPublicOrigin.origin !== webPublicOrigin.origin) {
    errors.push('mcp-worker PUBLIC_ORIGIN must equal the web PUBLIC_ORIGIN exactly.');
  }
  const allowed = mcpVars['MCP_ALLOWED_ORIGINS'];
  if (typeof allowed !== 'string' || allowed.split(',').map((entry) => entry.trim()).some((entry) => !isExactProductionOrigin(entry))) {
    errors.push('mcp-worker deployment manifest must provide non-loopback exact HTTPS MCP_ALLOWED_ORIGINS.');
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadVerticalEdges(
  options: CloudflareTopologyOptions,
  deployment: boolean,
  errors: string[],
  notices: string[],
): Promise<readonly OrdinaryWorker[]> {
  const load = async (path: string): Promise<OrdinaryWorker> => {
    const label = `edge:${basename(path)}`;
    return { label, config: await parseConfig(path, label, errors) };
  };
  if (!deployment) {
    const paths = options.edgeVerticalConfigPaths ?? EDGE_VERTICAL_TEMPLATES.map(({ configPath }) => configPath);
    return Promise.all(paths.map(load));
  }
  if (options.edgeVerticalDeploymentConfigPaths !== undefined) {
    return Promise.all(options.edgeVerticalDeploymentConfigPaths.map(load));
  }
  const edges: OrdinaryWorker[] = [];
  for (const { deploymentConfigPath } of EDGE_VERTICAL_TEMPLATES) {
    if (await fileExists(deploymentConfigPath)) {
      edges.push(await load(deploymentConfigPath));
    } else {
      notices.push(
        `edge:${basename(deploymentConfigPath)} is absent; that per-vertical edge Worker is not validated here and must not be deployed.`,
      );
    }
  }
  return edges;
}

const VERTICAL_EDGE_TOP_LEVEL_FIELDS = new Set([
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'observability',
  'vars',
  'queues',
]);
const VERTICAL_EDGE_DEPLOYMENT_FIELDS = new Set(['account_id', 'route', 'routes', 'hyperdrive']);

/**
 * One additional per-vertical edge Worker: the same `apps/edge` code and
 * compatibility settings as the primary edge, its own Worker identity, one
 * vertical, and the canonical `/v1/<slug>` path prefix. The runtime-registry
 * gate is deferred (a notice, not an error) for a tracked template whose
 * vertical is not compiled into this bundle yet, and enforced for any
 * deployment manifest: an unbundled vertical would boot into a 503.
 */
function checkVerticalEdge(
  edge: OrdinaryWorker,
  primary: TomlObject,
  deployment: boolean,
  bundledEdge: readonly string[],
  errors: string[],
  notices: string[],
): string | null {
  const { label, config } = edge;
  checkWorkerBase(label, config, errors);
  if (deployment) {
    checkDeploymentWorker(label, config, errors);
  } else {
    checkRepositoryPolicy(label, config, errors);
  }
  for (const field of Object.keys(config)) {
    if (!VERTICAL_EDGE_TOP_LEVEL_FIELDS.has(field) && !(deployment && VERTICAL_EDGE_DEPLOYMENT_FIELDS.has(field))) {
      errors.push(`${label} must not declare the ${field} top-level capability; it is a read API Worker only.`);
    }
  }
  if (
    config['main'] !== primary['main'] ||
    config['compatibility_date'] !== primary['compatibility_date'] ||
    JSON.stringify(config['compatibility_flags']) !== JSON.stringify(primary['compatibility_flags'])
  ) {
    errors.push(`${label} must run the same edge entry point and compatibility settings as apps/edge/wrangler.toml.`);
  }

  const vars = object(config['vars']);
  const slug = vars['VERTICAL_SLUG'];
  if (typeof slug !== 'string' || !VERTICAL_SLUG_PATTERN.test(slug)) {
    errors.push(`${label} must set VERTICAL_SLUG to a lowercase vertical slug.`);
    return null;
  }
  if (config['name'] !== `data-foundry-edge-${slug}`) {
    errors.push(`${label} must use the data-foundry-edge-<VERTICAL_SLUG> Worker name.`);
  }
  checkApiPathPrefix(label, config, true, errors);
  if (vars['API_KEY_ENVIRONMENT'] !== 'live') {
    errors.push(`${label} production manifest must accept only live API keys.`);
  }
  if (vars['PRIVATE_CANARY_MODE'] !== undefined) {
    errors.push(`${label} must not configure PRIVATE_CANARY_MODE; canary targets are separate reduced Workers.`);
  }
  if (slug === object(primary['vars'])['VERTICAL_SLUG']) {
    errors.push(`${label} must serve a different vertical from the primary edge Worker.`);
  }
  if (!bundledEdge.includes(slug)) {
    if (deployment) {
      errors.push(
        `${label} selects a vertical that is not compiled into the edge runtime registry (apps/edge/generated); it would refuse every request.`,
      );
    } else {
      notices.push(
        `${label}: the "${slug}" edge runtime is not compiled into apps/edge/generated yet; its runtime-registry gate is deferred, and deployment mode refuses it until it is bundled.`,
      );
    }
  }

  const queues = object(config['queues']);
  const producers = objects(queues['producers']);
  if (
    Object.keys(queues).some((key) => key !== 'producers') ||
    producers.length !== 1 ||
    producers[0]?.['binding'] !== 'USAGE_EVENTS_QUEUE' ||
    producers[0]?.['queue'] !== USAGE_QUEUE ||
    Object.keys(producers[0] ?? {}).some((key) => key !== 'binding' && key !== 'queue')
  ) {
    errors.push(`${label} must declare exactly one USAGE_EVENTS_QUEUE producer to ${USAGE_QUEUE} and no consumer.`);
  }
  return slug;
}

function hyperdriveId(config: TomlObject): string | null {
  const ids = objects(config['hyperdrive'])
    .filter((binding) => binding['binding'] === 'HYPERDRIVE')
    .map((binding) => binding['id'])
    .filter(isExactCloudflareId);
  return ids.length === 1 ? ids[0] ?? null : null;
}

export async function validateCloudflareTopology(
  options: CloudflareTopologyOptions = {},
): Promise<readonly string[]> {
  return (await validateCloudflareTopologyReport(options)).errors;
}

/** The same validation, plus value-free notices such as a deferred runtime-registry gate. */
export async function validateCloudflareTopologyReport(
  options: CloudflareTopologyOptions = {},
): Promise<CloudflareTopologyReport> {
  const notices: string[] = [];
  const errors = await validateTopology(options, notices);
  return { errors, notices };
}

async function validateTopology(
  options: CloudflareTopologyOptions,
  notices: string[],
): Promise<readonly string[]> {
  const errors: string[] = [];
  const mode = options.mode ?? 'repository';
  const bundled: BundledVerticals = { ...BUNDLED_RUNTIME_VERTICALS, ...options.bundledVerticals };
  if (mode === 'private-canary-target' || mode === 'private-canary-target-deployment') {
    const deployment = mode === 'private-canary-target-deployment';
    const targets = await loadPrivateCanaryTargets(options, deployment, errors);
    const ordinaryWorkers = await loadOrdinaryWorkers(options, errors, deployment);
    // A missing ignored production manifest is an owner-action boundary, not
    // an empty deployment. Report only the named missing files rather than a
    // cascade of topology failures derived from parsed `{}` values.
    if (errors.length > 0) return errors;
    const ordinaryWorkerNames = collectOrdinaryWorkerNames(ordinaryWorkers, errors);

    for (const target of targets) {
      checkWorkerBase(target.label, target.config, errors);
      if (deployment) {
        checkDeploymentFieldLocations(target.label, target.config, errors);
        checkDeploymentWorker(target.label, target.config, errors);
      } else {
        checkRepositoryPolicy(target.label, target.config, errors);
      }
      checkPrivateCanaryTargetTopology(target, errors);
      checkPrivateCanaryTargetQueueTopology(target, errors);
    }
    checkPrivateCanaryTargetIdentityIsolation(targets, ordinaryWorkerNames, errors);
    if (deployment) {
      const manifests = targets.map(({ label, config }) => [label, config] as const);
      checkDeploymentAccountIds(manifests, errors);
      checkDistinctDeploymentHyperdriveIds(manifests, errors);
    }
    return errors;
  }
  if (mode === 'private-canary-full-deployment') {
    const privateCanary = await parseConfig(
      options.privateCanaryConfigPath ?? PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH,
      'private-canary',
      errors,
    );
    const targets = await loadPrivateCanaryTargets(options, true, errors);
    const ordinaryWorkers = await loadOrdinaryWorkers(options, errors, true);
    if (errors.length > 0) return errors;
    const ordinaryWorkerNames = collectOrdinaryWorkerNames(ordinaryWorkers, errors);

    checkWorkerBase('private-canary', privateCanary, errors);
    checkDeploymentFieldLocations('private-canary', privateCanary, errors);
    const privateCanaryAccountId = deploymentAccountId('private-canary', privateCanary, errors);
    checkPlaintextProtectedVars('private-canary', privateCanary, errors);
    checkPrivateCanaryTopology(privateCanary, errors);
    checkPrivateCanaryHarnessIdentityIsolation(privateCanary, ordinaryWorkerNames, errors);

    for (const target of targets) {
      checkWorkerBase(target.label, target.config, errors);
      checkDeploymentWorker(target.label, target.config, errors);
      checkPrivateCanaryTargetTopology(target, errors);
      checkPrivateCanaryTargetQueueTopology(target, errors);
    }
    checkPrivateCanaryTargetIdentityIsolation(targets, ordinaryWorkerNames, errors);
    const targetManifests = targets.map(({ label, config }) => [label, config] as const);
    const targetAccountId = checkDeploymentAccountIds(targetManifests, errors);
    checkDistinctDeploymentHyperdriveIds(targetManifests, errors);
    if (
      privateCanaryAccountId !== null &&
      targetAccountId !== null &&
      privateCanaryAccountId !== targetAccountId
    ) {
      errors.push('private-canary deployment account_id must match the six target manifests.');
    }
    return errors;
  }
  if (mode === 'private-canary-deployment') {
    const privateCanary = await parseConfig(
      options.privateCanaryConfigPath ?? PRIVATE_CANARY_DEPLOYMENT_CONFIG_PATH,
      'private-canary',
      errors,
    );
    const ordinaryWorkers = await loadOrdinaryWorkers(options, errors, true);
    if (errors.length > 0) return errors;
    const ordinaryWorkerNames = collectOrdinaryWorkerNames(ordinaryWorkers, errors);
    checkWorkerBase('private-canary', privateCanary, errors);
    checkDeploymentFieldLocations('private-canary', privateCanary, errors);
    deploymentAccountId('private-canary', privateCanary, errors);
    checkPlaintextProtectedVars('private-canary', privateCanary, errors);
    checkPrivateCanaryTopology(privateCanary, errors);
    checkPrivateCanaryHarnessIdentityIsolation(privateCanary, ordinaryWorkerNames, errors);
    return errors;
  }
  if (mode === 'private-canary') {
    const privateCanary = await parseConfig(
      options.privateCanaryConfigPath ?? PRIVATE_CANARY_CONFIG_PATH,
      'private-canary',
      errors,
    );
    const ordinaryWorkers = await loadOrdinaryWorkers(options, errors);
    if (errors.length > 0) return errors;
    const ordinaryWorkerNames = collectOrdinaryWorkerNames(ordinaryWorkers, errors);
    checkWorkerBase('private-canary', privateCanary, errors);
    checkRepositoryPolicy('private-canary', privateCanary, errors);
    checkPrivateCanaryTopology(privateCanary, errors);
    checkPrivateCanaryHarnessIdentityIsolation(privateCanary, ordinaryWorkerNames, errors);
    return errors;
  }
  const edge = await parseConfig(
    options.edgeConfigPath ?? (mode === 'deployment' ? EDGE_DEPLOYMENT_CONFIG_PATH : EDGE_CONFIG_PATH),
    'edge',
    errors,
  );
  const consumer = await parseConfig(
    options.consumerConfigPath ??
      (mode === 'deployment' ? CONSUMER_DEPLOYMENT_CONFIG_PATH : CONSUMER_CONFIG_PATH),
    'usage-consumer',
    errors,
  );
  const web = await parseConfig(
    options.webConfigPath ?? (mode === 'deployment' ? WEB_DEPLOYMENT_CONFIG_PATH : WEB_CONFIG_PATH),
    'web',
    errors,
  );
  const acquisition = await parseConfig(
    options.acquisitionConfigPath ??
      (mode === 'deployment' ? ACQUISITION_DEPLOYMENT_CONFIG_PATH : ACQUISITION_CONFIG_PATH),
    'acquisition-worker',
    errors,
  );
  const ingestion = await parseConfig(
    options.ingestionConfigPath ??
      (mode === 'deployment' ? INGESTION_DEPLOYMENT_CONFIG_PATH : INGESTION_CONFIG_PATH),
    'ingestion-worker',
    errors,
  );
  const mcp = await parseConfig(
    options.mcpConfigPath ?? (mode === 'deployment' ? MCP_DEPLOYMENT_CONFIG_PATH : MCP_CONFIG_PATH),
    'mcp-worker',
    errors,
  );
  const privateCanary = mode === 'repository'
    ? await parseConfig(
      options.privateCanaryConfigPath ?? PRIVATE_CANARY_CONFIG_PATH,
      'private-canary',
      errors,
    )
    : null;
  const privateCanaryTargets = mode === 'repository'
    ? await loadPrivateCanaryTargets(options, false, errors)
    : [];
  const verticalEdges = await loadVerticalEdges(options, mode === 'deployment', errors, notices);
  // A missing ignored deployment manifest is an owner-action boundary, not a
  // malformed empty Worker. Return only the actionable file errors rather than
  // a cascade of consequences from parsing `{}`.
  if (errors.length > 0) return errors;
  checkWorkerBase('edge', edge, errors);
  checkWorkerBase('usage-consumer', consumer, errors);
  checkWorkerBase('web', web, errors);
  checkWorkerBase('acquisition-worker', acquisition, errors);
  checkWorkerBase('ingestion-worker', ingestion, errors);
  checkWorkerBase('mcp-worker', mcp, errors);
  if (mode === 'repository') {
    checkRepositoryPolicy('edge', edge, errors);
    checkRepositoryPolicy('usage-consumer', consumer, errors);
    checkRepositoryPolicy('web', web, errors);
    checkRepositoryPolicy('acquisition-worker', acquisition, errors);
    checkRepositoryPolicy('ingestion-worker', ingestion, errors);
    checkRepositoryPolicy('mcp-worker', mcp, errors);
    // This seventh Worker is intentionally not included in deployment mode's
    // six-Hyperdrive assertion: it holds no database identity at all.
    if (privateCanary !== null) {
      checkWorkerBase('private-canary', privateCanary, errors);
      checkRepositoryPolicy('private-canary', privateCanary, errors);
      checkPrivateCanaryTopology(privateCanary, errors);
    }
    const ordinaryWorkers: readonly OrdinaryWorker[] = [
      { label: 'edge', config: edge },
      { label: 'usage-consumer', config: consumer },
      { label: 'web', config: web },
      { label: 'acquisition-worker', config: acquisition },
      { label: 'ingestion-worker', config: ingestion },
      { label: 'mcp-worker', config: mcp },
      ...verticalEdges,
    ];
    const ordinaryWorkerNames = collectOrdinaryWorkerNames(ordinaryWorkers, errors);
    if (ordinaryWorkerNames.size !== ordinaryWorkers.length) {
      errors.push('Ordinary Worker manifests, including every per-vertical edge, must use distinct Worker names.');
    }
    if (privateCanary !== null) {
      checkPrivateCanaryHarnessIdentityIsolation(privateCanary, ordinaryWorkerNames, errors);
    }
    for (const target of privateCanaryTargets) {
      checkWorkerBase(target.label, target.config, errors);
      checkRepositoryPolicy(target.label, target.config, errors);
      checkPrivateCanaryTargetTopology(target, errors);
      checkPrivateCanaryTargetQueueTopology(target, errors);
    }
    checkPrivateCanaryTargetIdentityIsolation(privateCanaryTargets, ordinaryWorkerNames, errors);
  } else {
    checkDeploymentWorker('edge', edge, errors);
    checkDeploymentWorker('usage-consumer', consumer, errors);
    checkDeploymentWorker('web', web, errors);
    checkDeploymentWorker('acquisition-worker', acquisition, errors);
    checkDeploymentWorker('ingestion-worker', ingestion, errors);
    checkDeploymentWorker('mcp-worker', mcp, errors);
    const canonicalAccountId = checkDeploymentAccountIds([
      ['edge', edge],
      ['usage-consumer', consumer],
      ['web', web],
      ['acquisition-worker', acquisition],
      ['ingestion-worker', ingestion],
      ['mcp-worker', mcp],
      ...verticalEdges.map(({ label, config }) => [label, config] as const),
    ], errors);
    checkDistinctDeploymentHyperdriveIds([
      ['edge', edge],
      ['usage-consumer', consumer],
      ['web', web],
      ['acquisition-worker', acquisition],
      ['ingestion-worker', ingestion],
      ['mcp-worker', mcp],
    ], errors);
    // A per-vertical edge is the same edge database role: it may share the
    // edge role's Hyperdrive configuration or use its own, but never another
    // role's credential path.
    const otherRoleHyperdriveIds = new Set(
      [consumer, web, acquisition, ingestion, mcp].map(hyperdriveId).filter((id) => id !== null),
    );
    for (const { label, config } of verticalEdges) {
      const id = hyperdriveId(config);
      if (id !== null && otherRoleHyperdriveIds.has(id)) {
        errors.push(`${label} must bind the edge role's Hyperdrive configuration, never another Worker role's.`);
      }
    }
    checkAcquisitionProviderAccountId(acquisition, canonicalAccountId, errors);
    checkDeploymentEndpoints([{ label: 'edge', config: edge }, ...verticalEdges], web, mcp, errors);
  }

  const verticalEdgeSlugs = new Set<string>();
  for (const verticalEdge of verticalEdges) {
    const slug = checkVerticalEdge(verticalEdge, edge, mode === 'deployment', bundled.edge, errors, notices);
    if (slug === null) continue;
    if (verticalEdgeSlugs.has(slug)) {
      errors.push(`${verticalEdge.label} serves a vertical another per-vertical edge Worker already serves.`);
    }
    verticalEdgeSlugs.add(slug);
  }

  const edgeVars = object(edge['vars']);
  const edgeSlug = edgeVars['VERTICAL_SLUG'];
  if (typeof edgeSlug !== 'string' || !bundled.edge.includes(edgeSlug)) {
    errors.push('edge must select a vertical compiled into the edge runtime registry (apps/edge/generated).');
  }
  checkApiPathPrefix('edge', edge, false, errors);
  if (edgeVars['API_KEY_ENVIRONMENT'] !== 'live') {
    errors.push('edge production manifest must accept only live API keys.');
  }

  const mcpVars = object(mcp['vars']);
  const mcpSlug = mcpVars['VERTICAL_SLUG'];
  if (typeof mcpSlug !== 'string' || !bundled.mcp.includes(mcpSlug)) {
    errors.push('mcp-worker must select a vertical compiled into the MCP runtime registry (apps/mcp-worker/generated).');
  }
  if (mcpVars['API_KEY_ENVIRONMENT'] !== 'live') {
    errors.push('mcp-worker production manifest must accept only live MCP keys.');
  }

  const producers = objects(object(edge['queues'])['producers']);
  if (producers.length !== 1) errors.push('edge must declare exactly one usage queue producer.');
  const producer = producers[0] ?? {};
  if (producer['binding'] !== 'USAGE_EVENTS_QUEUE') {
    errors.push('edge usage queue producer binding must be USAGE_EVENTS_QUEUE.');
  }
  if (producer['queue'] !== USAGE_QUEUE) {
    errors.push(`edge usage queue producer must target ${USAGE_QUEUE}.`);
  }

  const mcpProducers = objects(object(mcp['queues'])['producers']);
  if (mcpProducers.length !== 1) {
    errors.push('mcp-worker must declare exactly one usage queue producer.');
  }
  const mcpProducer = mcpProducers[0] ?? {};
  if (mcpProducer['binding'] !== 'USAGE_EVENTS_QUEUE') {
    errors.push('mcp-worker usage queue producer binding must be USAGE_EVENTS_QUEUE.');
  }
  if (mcpProducer['queue'] !== USAGE_QUEUE) {
    errors.push(`mcp-worker usage queue producer must target ${USAGE_QUEUE}.`);
  }

  const consumers = objects(object(consumer['queues'])['consumers']);
  if (consumers.length !== 1) {
    errors.push('usage-consumer must declare exactly one queue consumer.');
  }
  const queueConsumer = consumers[0] ?? {};
  if (queueConsumer['queue'] !== USAGE_QUEUE) {
    errors.push(`usage-consumer must consume ${USAGE_QUEUE}.`);
  }
  if (producer['queue'] !== queueConsumer['queue']) {
    errors.push('The edge producer and usage-consumer consumer queue names do not match.');
  }
  if (mcpProducer['queue'] !== queueConsumer['queue']) {
    errors.push('The mcp-worker producer and usage-consumer consumer queue names do not match.');
  }
  if (queueConsumer['max_batch_size'] !== 100) {
    errors.push('usage-consumer max_batch_size must remain 100.');
  }
  if (queueConsumer['max_batch_timeout'] !== 5) {
    errors.push('usage-consumer max_batch_timeout must remain 5 seconds.');
  }
  if (queueConsumer['max_retries'] !== 3) {
    errors.push('usage-consumer max_retries must remain 3.');
  }
  if (queueConsumer['dead_letter_queue'] !== USAGE_DLQ) {
    errors.push(`usage-consumer dead-letter queue must be ${USAGE_DLQ}.`);
  }

  const acquisitionVars = object(acquisition['vars']);
  const acquisitionSlug = acquisitionVars['VERTICAL_SLUG'];
  if (typeof acquisitionSlug !== 'string' || !bundled.acquisition.includes(acquisitionSlug)) {
    errors.push(
      'acquisition-worker must select a vertical compiled into the acquisition runtime registry (apps/acquisition-worker/generated).',
    );
  }
  if (acquisitionVars['RAW_ARTIFACTS_BUCKET_NAME'] !== 'data-foundry-raw-artifacts') {
    errors.push('acquisition-worker must name the canonical raw-artifact bucket.');
  }
  const crons = object(acquisition['triggers'])['crons'];
  if (!Array.isArray(crons) || crons.length !== 1 || crons[0] !== '0 * * * *') {
    errors.push('acquisition-worker must declare exactly the hourly `0 * * * *` Cron.');
  }
  const r2Buckets = objects(acquisition['r2_buckets']);
  if (
    r2Buckets.length !== 1 ||
    r2Buckets[0]?.['binding'] !== 'RAW_ARTIFACTS' ||
    r2Buckets[0]?.['bucket_name'] !== 'data-foundry-raw-artifacts'
  ) {
    errors.push('acquisition-worker must bind RAW_ARTIFACTS to data-foundry-raw-artifacts.');
  }
  checkIngestionProducer('acquisition-worker', acquisition, false, errors);
  checkOrdinaryIngestion(ingestion, bundled.ingestion, errors);

  return errors;
}

function checkIngestionProducer(label: string, config: TomlObject, allowConsumer: boolean, errors: string[]): void {
  const queues = object(config['queues']);
  const allowedKeys = allowConsumer ? ['producers', 'consumers'] : ['producers'];
  const producers = objects(queues['producers']);
  if (
    Object.keys(queues).some((key) => !allowedKeys.includes(key)) ||
    producers.length !== 1 ||
    producers[0]?.['binding'] !== 'INGESTION_QUEUE' ||
    producers[0]?.['queue'] !== INGESTION_QUEUE ||
    Object.keys(producers[0] ?? {}).some((key) => !['binding', 'queue'].includes(key))
  ) {
    errors.push(`${label} must declare only its INGESTION_QUEUE producer to ${INGESTION_QUEUE}${allowConsumer ? ' and dedicated consumer' : '; no usage Queue or consumer'}.`);
  }
}

export function checkIngestionAlertBinding(config: TomlObject): string[] {
  const vars = object(config['vars']);
  const email = objects(config['send_email']);
  if (vars['OPS_ALERTS_ENABLED'] === 'false') {
    return email.length === 0 && config['send_email'] === undefined && vars['OPS_ALERT_FROM'] === undefined && vars['OPS_ALERT_TO'] === undefined
      ? [] : ['Disabled ingestion alerts must omit email binding and addresses.'];
  }
  const isAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254
    && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)
    && value.slice(0, value.indexOf('@')).length <= 64 && !value.startsWith('.') && !value.includes('..') && !value.includes('.@')
    && value.slice(value.indexOf('@') + 1).split('.').every(label => label.length <= 63);
  const from = vars['OPS_ALERT_FROM']; const to = vars['OPS_ALERT_TO'];
  const binding = email[0];
  if (vars['OPS_ALERTS_ENABLED'] !== 'true' || !isAddress(from) || !isAddress(to) ||
      email.length !== 1 || !binding || Object.keys(binding).sort().join(',') !== 'allowed_sender_addresses,destination_address,name' ||
      binding['name'] !== 'OPS_EMAIL' || binding['destination_address'] !== to ||
      !Array.isArray(binding['allowed_sender_addresses']) || binding['allowed_sender_addresses'].length !== 1 || binding['allowed_sender_addresses'][0] !== from) {
    return ['Ingestion alerts require an explicit flag and one OPS_EMAIL binding restricted to the exact single sender and verified destination.'];
  }
  return [];
}

function checkOrdinaryIngestion(config: TomlObject, bundledIngestion: readonly string[], errors: string[]): void {
  errors.push(...checkIngestionAlertBinding(config));
  checkIngestionProducer('ingestion-worker', config, true, errors);
  if (collectKeyPaths(config, new Set(['route', 'routes'])).length !== 0) {
    errors.push('ingestion-worker must remain route-less.');
  }
  const vars = object(config['vars']);
  const ingestionSlug = vars['VERTICAL_SLUG'];
  if (typeof ingestionSlug !== 'string' || !bundledIngestion.includes(ingestionSlug)) {
    errors.push(
      'ingestion-worker must select a vertical compiled into the ingestion runtime registry (apps/ingestion-worker/generated).',
    );
  }
  if (vars['RAW_ARTIFACTS_BUCKET_NAME'] !== 'data-foundry-raw-artifacts') {
    errors.push('ingestion-worker must select the canonical raw-artifact bucket.');
  }
  const buckets = objects(config['r2_buckets']);
  if (buckets.length !== 1 || buckets[0]?.['binding'] !== 'RAW_ARTIFACTS' || buckets[0]?.['bucket_name'] !== 'data-foundry-raw-artifacts') {
    errors.push('ingestion-worker must bind RAW_ARTIFACTS to data-foundry-raw-artifacts.');
  }
  const crons = object(config['triggers'])['crons'];
  if (!Array.isArray(crons) || crons.length !== 1 || crons[0] !== '*/5 * * * *') {
    errors.push('ingestion-worker must dispatch durable pending deliveries every five minutes.');
  }
  if (object(config['limits'])['cpu_ms'] !== 30_000) {
    errors.push('ingestion-worker must retain its bounded 30000ms CPU limit.');
  }
  const consumers = objects(object(config['queues'])['consumers']);
  const consumer = consumers[0] ?? {};
  const expected = {
    queue: INGESTION_QUEUE, max_batch_size: 1, max_batch_timeout: 5,
    max_retries: 5, max_concurrency: 1, dead_letter_queue: INGESTION_DLQ,
  };
  if (consumers.length !== 1 || Object.keys(consumer).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => consumer[key] !== value)) {
    errors.push('ingestion-worker must consume only its dedicated ingestion Queue with batch size 1, concurrency 1, five retries and dedicated DLQ.');
  }
}

export async function run(options: CloudflareTopologyOptions = {}): Promise<number> {
  const { errors, notices } = await validateCloudflareTopologyReport(options);
  for (const notice of notices) process.stdout.write(`NOTICE: ${notice}\n`);
  if (errors.length > 0) {
    process.stderr.write(`Cloudflare topology validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write(
    options.mode === 'deployment'
      ? 'OK: Cloudflare deployment manifests are internally consistent.\n'
      : options.mode === 'private-canary'
        ? 'OK: Cloudflare private-canary manifest is route-less and service-bound.\n'
        : options.mode === 'private-canary-deployment'
          ? 'OK: Cloudflare private-canary deployment manifest is route-less and service-bound.\n'
          : options.mode === 'private-canary-target'
            ? 'OK: Cloudflare private-canary target templates are route-less and service-bound.\n'
          : options.mode === 'private-canary-target-deployment'
            ? 'OK: Cloudflare private-canary target deployment manifests are route-less and role-bound.\n'
            : options.mode === 'private-canary-full-deployment'
              ? 'OK: Cloudflare private-canary harness and target manifests are account-bound, route-less, and role-bound.\n'
            : 'OK: Cloudflare repository templates are internally consistent.\n',
  );
  return 0;
}

if (isMain(import.meta.url)) {
  const mode = process.argv[2] === '--mode' ? process.argv[3] : undefined;
  if (
    mode !== undefined &&
    mode !== 'repository' &&
    mode !== 'deployment' &&
    mode !== 'private-canary' &&
    mode !== 'private-canary-deployment' &&
    mode !== 'private-canary-target' &&
    mode !== 'private-canary-target-deployment' &&
    mode !== 'private-canary-full-deployment'
  ) {
    process.stderr.write(
      'Usage: check-cloudflare-topology.ts [--mode repository|deployment|private-canary|private-canary-deployment|private-canary-target|private-canary-target-deployment|private-canary-full-deployment]\n',
    );
    process.exitCode = 1;
  } else {
    run(mode === undefined ? {} : { mode }).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
    );
  }
}
