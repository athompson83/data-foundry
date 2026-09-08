/** Separate, fixed-fixture ingestion profile. It is never part of the receipt canary. */
import { createHash } from 'node:crypto';
import { artifactContentKey } from '../../packages/acquisition/src/storage/keys.js';
import { SYNTHETIC_INGESTION_BUCKET, SYNTHETIC_INGESTION_FIXTURES } from '../../apps/ingestion-worker/src/synthetic-ingestion.js';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { REPO_ROOT, validateCloudflareTopology, type CloudflareTopologyOptions } from './check-cloudflare-topology.js';
import { isMain } from '../lib/cli-entry.js';

type Config = Record<string, unknown>;
export const SYNTHETIC_CONFIG_PATH = join(REPO_ROOT, 'apps/ingestion-worker/wrangler.synthetic-ingestion.toml');
const expected: Config = {
  name: 'data-foundry-private-canary-ingestion-worker', main: 'src/synthetic-ingestion.ts',
  compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat'], workers_dev: false, preview_urls: false,
  limits: { cpu_ms: 30000 }, observability: { enabled: true, logs: { invocation_logs: false } },
  vars: { DEPLOYMENT_ENVIRONMENT: 'production', SYNTHETIC_INGESTION_MODE: 'fixed-fixtures-v1' },
  r2_buckets: [{ binding: 'SYNTHETIC_ARTIFACTS', bucket_name: 'data-foundry-private-ingestion-artifacts' }],
  queues: { consumers: [{ queue: 'data-foundry-private-ingestion', max_batch_size: 1, max_batch_timeout: 5,
    max_retries: 5, max_concurrency: 1, dead_letter_queue: 'data-foundry-private-ingestion-dlq' }] },
};
function resources(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(resources);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) =>
    ['queue', 'dead_letter_queue', 'bucket_name'].includes(key) && typeof item === 'string' ? [item] : resources(item));
}
export function checkSyntheticIngestionConfig(config: Config, otherProfiles: readonly Config[], deployment = false): string[] {
  const errors: string[] = [];
  const reduced = { ...config };
  if (deployment) {
    const id = /^[a-f0-9]{32}$/;
    const account = config['account_id'];
    const hyperdrive = config['hyperdrive'];
    if (typeof account !== 'string' || !id.test(account) || /^0+$/.test(account) ||
        !Array.isArray(hyperdrive) || hyperdrive.length !== 1 ||
        !isDeepStrictEqual(Object.keys(hyperdrive[0] ?? {}).sort(), ['binding', 'id']) ||
        hyperdrive[0]?.binding !== 'HYPERDRIVE' || typeof hyperdrive[0]?.id !== 'string' ||
        !id.test(hyperdrive[0].id) || /^0+$/.test(hyperdrive[0].id)) errors.push('Synthetic deployment requires an exact non-placeholder account and HYPERDRIVE binding.');
    const controls = otherProfiles.filter(profile => profile['name'] === config['name']);
    const controlDrive = controls[0]?.['hyperdrive'];
    if (otherProfiles.length !== 13 || new Set(otherProfiles.map(profile => profile['name'])).size !== 13 || controls.length !== 1 ||
        otherProfiles.some(profile => profile['account_id'] !== account) || !Array.isArray(controlDrive) || controlDrive.length !== 1 ||
        !Array.isArray(hyperdrive) || hyperdrive[0]?.id !== controlDrive[0]?.id || controlDrive[0]?.binding !== 'HYPERDRIVE') {
      errors.push('Synthetic deployment must match all thirteen reviewed deployment controls, their canonical account and the reduced ingestion Hyperdrive exactly.');
    }
    delete reduced['account_id']; delete reduced['hyperdrive'];
  }
  if (!isDeepStrictEqual(reduced, expected)) errors.push('Synthetic ingestion profile must match the closed queue-only fixed-fixture capability contract.');
  const privateResources = new Set(resources(config));
  if (otherProfiles.flatMap(resources).some(resource => privateResources.has(resource))) {
    errors.push('Synthetic ingestion Queue, DLQ and artifact bucket must be distinct from ordinary and receipt-phase resources.');
  }
  return errors;
}
const workers = [
  ['edge', 'edge'], ['usage-consumer', 'consumer'], ['web', 'web'],
  ['acquisition-worker', 'acquisition'], ['ingestion-worker', 'ingestion'], ['mcp-worker', 'mcp'],
] as const;
export async function validateSyntheticIngestion(options: {
  readonly configPath?: string; readonly deployment?: boolean;
  /** Local fixture seam. The CLI always resolves the actual ignored repository controls. */
  readonly controlRoot?: string;
} = {}): Promise<string[]> {
  try {
    const root = options.controlRoot ?? REPO_ROOT;
    const synthetic = parse(await readFile(options.configPath ?? SYNTHETIC_CONFIG_PATH, 'utf8')) as Config;
    if (options.deployment) {
      const ordinaryPaths = workers.map(([worker]) => join(root, 'apps', worker, 'wrangler.production.toml'));
      const reducedPaths = workers.map(([worker]) => join(root, 'apps', worker, 'wrangler.private-canary.production.toml'));
      const harnessPath = join(root, 'apps/private-canary/wrangler.production.toml');
      const profiles = await Promise.all([...ordinaryPaths, ...reducedPaths, harnessPath].map(async path => parse(await readFile(path, 'utf8')) as Config));
      const topology = Object.fromEntries(workers.flatMap(([, key], index) => [
        [`${key}ConfigPath`, ordinaryPaths[index]], [`${key}DeploymentConfigPath`, ordinaryPaths[index]],
        [`${key}PrivateCanaryConfigPath`, reducedPaths[index]],
      ])) as CloudflareTopologyOptions;
      const checks = await Promise.all([
        validateCloudflareTopology({ ...topology, mode: 'deployment' }),
        validateCloudflareTopology({ ...topology, privateCanaryConfigPath: harnessPath, mode: 'private-canary-full-deployment' }),
      ]);
      return [...checks.flat(), ...checkSyntheticIngestionConfig(synthetic, profiles, true)];
    }
    const profiles = await Promise.all([
      join(REPO_ROOT, 'apps/ingestion-worker/wrangler.toml'),
      join(REPO_ROOT, 'apps/private-canary/wrangler.toml'),
      join(REPO_ROOT, 'apps/usage-consumer/wrangler.private-canary.toml'),
    ].map(async path => parse(await readFile(path, 'utf8')) as Config));
    return checkSyntheticIngestionConfig(synthetic, profiles);
  } catch { return ['Synthetic ingestion validation requires every exact deployment control manifest; missing or unreadable controls cannot be bypassed.']; }
}
export async function syntheticArtifactManifest(): Promise<unknown> {
  const artifacts = await Promise.all(Object.entries(SYNTHETIC_INGESTION_FIXTURES).map(async ([sourceKey, fixture]) => {
    const path = `verticals/hvac/fixtures/${fixture.file}`;
    const bytes = await readFile(join(REPO_ROOT, path));
    if (bytes.byteLength !== fixture.bytes || createHash('sha256').update(bytes).digest('hex') !== fixture.hash) throw new Error('Synthetic fixture hash drift.');
    return { sourceKey, path, bytes: fixture.bytes, sha256: fixture.hash,
      objectKey: artifactContentKey({ vertical: 'hvac', source: sourceKey, contentHash: fixture.hash }) };
  }));
  return { kind: 'data-foundry.synthetic-ingestion-artifacts.v1', bucket: SYNTHETIC_INGESTION_BUCKET, artifacts };
}
if (isMain(import.meta.url)) {
  const deployment = process.argv.includes('--deployment');
  const configPath = deployment ? join(REPO_ROOT, 'apps/ingestion-worker/wrangler.synthetic-ingestion.production.toml') : SYNTHETIC_CONFIG_PATH;
  validateSyntheticIngestion({ configPath, deployment }).then(async errors => {
    if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
    else if (process.argv.includes('--manifest')) process.stdout.write(`${JSON.stringify(await syntheticArtifactManifest(), null, 2)}\n`);
    else process.stdout.write('OK: separate synthetic ingestion profile is queue-only and isolated.\n');
  }).catch(() => { process.stderr.write('Synthetic ingestion profile validation failed.\n'); process.exitCode = 1; });
}
