import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { isUnsafeProductionEndpointHostname } from '@data-foundry/canonical-schema';
import { isMain } from '../lib/cli-entry.js';

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
export const MCP_CONFIG_PATH = join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.toml');
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
export const MCP_DEPLOYMENT_CONFIG_PATH = join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.production.toml');

const USAGE_QUEUE = 'data-foundry-usage-events';
const USAGE_DLQ = 'data-foundry-usage-events-dlq';

type TomlObject = Record<string, unknown>;

export interface CloudflareTopologyOptions {
  readonly mode?: 'repository' | 'deployment';
  readonly edgeConfigPath?: string;
  readonly consumerConfigPath?: string;
  readonly webConfigPath?: string;
  readonly acquisitionConfigPath?: string;
  readonly mcpConfigPath?: string;
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

function isExactProductionOrigin(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.origin === value &&
      !isUnsafeProductionEndpointHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isExactProductionHostname(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const hostname = value.trim().toLowerCase();
  if (isUnsafeProductionEndpointHostname(hostname)) return false;
  try {
    const parsed = new URL(`https://${hostname}`);
    return parsed.hostname.toLowerCase() === hostname &&
      parsed.port === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '';
  } catch {
    return false;
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

function hasDeploymentHyperdrive(config: TomlObject): boolean {
  return objects(config['hyperdrive']).some(
    (binding) => binding['binding'] === 'HYPERDRIVE' &&
      typeof binding['id'] === 'string' && binding['id'].trim() !== '',
  );
}

function isPlaintextProtectedKey(key: string): boolean {
  const normalized = key.toUpperCase();
  if (normalized === 'API_KEY_ENVIRONMENT') return false;
  return normalized === 'POSTGRES_URL' ||
    normalized === 'RAPIDAPI_PROXY_SECRET' ||
    normalized === 'RAPIDAPI_API_KEY' ||
    normalized === 'CLOUDFLARE_API_TOKEN' ||
    normalized === 'CRAWL4AI_API_TOKEN' ||
    /(?:PASSWORD|PASSWD|TOKEN|SECRET)$/.test(normalized) ||
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
  if (!hasDeploymentHyperdrive(config)) {
    errors.push(`${label} deployment manifest must bind HYPERDRIVE with a non-empty id.`);
  }
  checkPlaintextProtectedVars(label, config, errors);
}

function checkDeploymentEndpoints(
  edge: TomlObject,
  web: TomlObject,
  mcp: TomlObject,
  errors: string[],
): void {
  for (const [label, config] of [['edge', edge], ['web', web], ['mcp-worker', mcp]] as const) {
    const routes = routeValues(config);
    if (routes.length === 0 || routes.some((route) => route.trim() === '' || /(?:^|\.)workers\.dev(?:\/|$)/i.test(route))) {
      errors.push(`${label} deployment manifest must declare non-workers.dev route(s).`);
    }
  }

  const edgeVars = object(edge['vars']);
  if (edgeVars['RAPIDAPI_HOSTNAME'] !== undefined && !isExactProductionHostname(edgeVars['RAPIDAPI_HOSTNAME'])) {
    errors.push('edge RAPIDAPI_HOSTNAME must be a non-loopback exact production hostname when configured.');
  }

  const webVars = object(web['vars']);
  if (!isExactProductionOrigin(webVars['PUBLIC_ORIGIN'])) {
    errors.push('web deployment manifest must provide a non-loopback exact HTTPS PUBLIC_ORIGIN.');
  }
  if (webVars['PUBLIC_CACHE_MODE'] !== 'cache' && webVars['PUBLIC_CACHE_MODE'] !== 'no-store') {
    errors.push('web deployment manifest must provide PUBLIC_CACHE_MODE as exactly cache or no-store.');
  }

  const mcpVars = object(mcp['vars']);
  if (!isExactProductionHostname(mcpVars['MCP_HOSTNAME'])) {
    errors.push('mcp-worker deployment manifest must provide a non-loopback exact MCP_HOSTNAME.');
  }
  if (!isExactProductionOrigin(mcpVars['PUBLIC_ORIGIN'])) {
    errors.push('mcp-worker deployment manifest must provide a non-loopback exact HTTPS PUBLIC_ORIGIN.');
  }
  const allowed = mcpVars['MCP_ALLOWED_ORIGINS'];
  if (typeof allowed !== 'string' || allowed.split(',').map((entry) => entry.trim()).some((entry) => !isExactProductionOrigin(entry))) {
    errors.push('mcp-worker deployment manifest must provide non-loopback exact HTTPS MCP_ALLOWED_ORIGINS.');
  }
}

export async function validateCloudflareTopology(
  options: CloudflareTopologyOptions = {},
): Promise<readonly string[]> {
  const errors: string[] = [];
  const mode = options.mode ?? 'repository';
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
  const mcp = await parseConfig(
    options.mcpConfigPath ?? (mode === 'deployment' ? MCP_DEPLOYMENT_CONFIG_PATH : MCP_CONFIG_PATH),
    'mcp-worker',
    errors,
  );
  // A missing ignored deployment manifest is an owner-action boundary, not a
  // malformed empty Worker. Return only the actionable file errors rather than
  // a cascade of consequences from parsing `{}`.
  if (errors.length > 0) return errors;
  checkWorkerBase('edge', edge, errors);
  checkWorkerBase('usage-consumer', consumer, errors);
  checkWorkerBase('web', web, errors);
  checkWorkerBase('acquisition-worker', acquisition, errors);
  checkWorkerBase('mcp-worker', mcp, errors);
  if (mode === 'repository') {
    checkRepositoryPolicy('edge', edge, errors);
    checkRepositoryPolicy('usage-consumer', consumer, errors);
    checkRepositoryPolicy('web', web, errors);
    checkRepositoryPolicy('acquisition-worker', acquisition, errors);
    checkRepositoryPolicy('mcp-worker', mcp, errors);
  } else {
    checkDeploymentWorker('edge', edge, errors);
    checkDeploymentWorker('usage-consumer', consumer, errors);
    checkDeploymentWorker('web', web, errors);
    checkDeploymentWorker('acquisition-worker', acquisition, errors);
    checkDeploymentWorker('mcp-worker', mcp, errors);
    checkDeploymentEndpoints(edge, web, mcp, errors);
  }

  const edgeVars = object(edge['vars']);
  if (edgeVars['VERTICAL_SLUG'] !== 'hvac') {
    errors.push('edge must select the bundled hvac vertical in the canonical manifest.');
  }
  if (edgeVars['API_KEY_ENVIRONMENT'] !== 'live') {
    errors.push('edge production manifest must accept only live API keys.');
  }

  const mcpVars = object(mcp['vars']);
  if (mcpVars['VERTICAL_SLUG'] !== 'hvac') {
    errors.push('mcp-worker must select the bundled hvac vertical in the canonical manifest.');
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
  if (acquisitionVars['VERTICAL_SLUG'] !== 'hvac') {
    errors.push('acquisition-worker must select the bundled hvac acquisition runtime.');
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
  if (valuesAtKey(acquisition, 'queues').length !== 0) {
    errors.push('acquisition-worker must not declare a usage Queue producer or consumer.');
  }

  return errors;
}

export async function run(options: CloudflareTopologyOptions = {}): Promise<number> {
  const errors = await validateCloudflareTopology(options);
  if (errors.length > 0) {
    process.stderr.write(`Cloudflare topology validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write(
    options.mode === 'deployment'
      ? 'OK: Cloudflare deployment manifests are internally consistent.\n'
      : 'OK: Cloudflare repository templates are internally consistent.\n',
  );
  return 0;
}

if (isMain(import.meta.url)) {
  const mode = process.argv[2] === '--mode' ? process.argv[3] : undefined;
  if (mode !== undefined && mode !== 'repository' && mode !== 'deployment') {
    process.stderr.write('Usage: check-cloudflare-topology.ts [--mode repository|deployment]\n');
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
