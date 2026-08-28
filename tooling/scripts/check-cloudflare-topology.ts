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

const USAGE_QUEUE = 'data-foundry-usage-events';
const USAGE_DLQ = 'data-foundry-usage-events-dlq';

type TomlObject = Record<string, unknown>;

export interface CloudflareTopologyOptions {
  readonly edgeConfigPath?: string;
  readonly consumerConfigPath?: string;
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
  for (const name of ['POSTGRES_URL', 'RAPIDAPI_PROXY_SECRET', 'RAPIDAPI_API_KEY']) {
    const configuredAsPlainVar = valuesAtKey(config, 'vars').some(
      (vars) => collectKeyPaths(object(vars), new Set([name])).length > 0,
    );
    if (configuredAsPlainVar) {
      errors.push(`${label} commits ${name} in vars; configure it as a secret outside the repository.`);
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
  checkWorkerBase('edge', edge, errors);
  checkWorkerBase('usage-consumer', consumer, errors);
  checkRepositoryPolicy('edge', edge, errors);
  checkRepositoryPolicy('usage-consumer', consumer, errors);

  const edgeVars = object(edge['vars']);
  if (edgeVars['VERTICAL_SLUG'] !== 'hvac') {
    errors.push('edge must select the bundled hvac vertical in the canonical manifest.');
  }
  if (edgeVars['API_KEY_ENVIRONMENT'] !== 'live') {
    errors.push('edge production manifest must accept only live API keys.');
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

  return errors;
}

export async function run(options: CloudflareTopologyOptions = {}): Promise<number> {
  const errors = await validateCloudflareTopology(options);
  if (errors.length > 0) {
    process.stderr.write(`Cloudflare topology validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write('OK: Cloudflare edge/queue/consumer topology is internally consistent.\n');
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
