import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
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

const USAGE_QUEUE = 'data-foundry-usage-events';
const USAGE_DLQ = 'data-foundry-usage-events-dlq';

type TomlObject = Record<string, unknown>;

export interface CloudflareTopologyOptions {
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

function checkRepositoryPolicy(label: string, config: TomlObject, errors: string[]): void {
  for (const path of collectKeyPaths(config, new Set(['account_id']))) {
    errors.push(`${label} commits an account-specific ${path}; supply account_id outside the repository.`);
  }
  const hyperdrive = valuesAtKey(config, 'hyperdrive').flatMap(objects);
  if (hyperdrive.some((binding) => typeof binding['id'] === 'string')) {
    errors.push(`${label} commits a Hyperdrive id; inject the HYPERDRIVE binding during deployment.`);
  }
  for (const name of [
    'POSTGRES_URL',
    'RAPIDAPI_PROXY_SECRET',
    'RAPIDAPI_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CRAWL4AI_API_TOKEN',
  ]) {
    const configuredAsPlainVar = valuesAtKey(config, 'vars').some(
      (vars) => collectKeyPaths(object(vars), new Set([name])).length > 0,
    );
    if (configuredAsPlainVar) {
      errors.push(
        `${label} commits ${name} in vars; configure provider identity and credentials outside the repository.`,
      );
    }
  }
}

export async function validateCloudflareTopology(
  options: CloudflareTopologyOptions = {},
): Promise<readonly string[]> {
  const errors: string[] = [];
  const edge = await parseConfig(options.edgeConfigPath ?? EDGE_CONFIG_PATH, 'edge', errors);
  const consumer = await parseConfig(
    options.consumerConfigPath ?? CONSUMER_CONFIG_PATH,
    'usage-consumer',
    errors,
  );
  const web = await parseConfig(options.webConfigPath ?? WEB_CONFIG_PATH, 'web', errors);
  const acquisition = await parseConfig(
    options.acquisitionConfigPath ?? ACQUISITION_CONFIG_PATH,
    'acquisition-worker',
    errors,
  );
  const mcp = await parseConfig(options.mcpConfigPath ?? MCP_CONFIG_PATH, 'mcp-worker', errors);
  checkWorkerBase('edge', edge, errors);
  checkWorkerBase('usage-consumer', consumer, errors);
  checkWorkerBase('web', web, errors);
  checkWorkerBase('acquisition-worker', acquisition, errors);
  checkWorkerBase('mcp-worker', mcp, errors);
  checkRepositoryPolicy('edge', edge, errors);
  checkRepositoryPolicy('usage-consumer', consumer, errors);
  checkRepositoryPolicy('web', web, errors);
  checkRepositoryPolicy('acquisition-worker', acquisition, errors);
  checkRepositoryPolicy('mcp-worker', mcp, errors);

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
    'OK: Cloudflare REST, MCP, usage consumer, acquisition Cron, and public web topology is internally consistent.\n',
  );
  return 0;
}

if (isMain(import.meta.url)) {
  run().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
