import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse, stringify } from 'smol-toml';
import { isMain } from '../lib/cli-entry.js';
import {
  type CloudflareTopologyOptions,
  validateCloudflareTopology,
} from './check-cloudflare-topology.js';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
const WRANGLER_CLI = createRequire(import.meta.url).resolve('wrangler');
const WRANGLER_EMPTY_ENV_FILE = join(REPO_ROOT, 'tooling', 'wrangler-empty.env');
const DRY_RUN_HYPERDRIVE_ID = '00000000000000000000000000000000';
const WRANGLER_OS_ENVIRONMENT_KEYS = [
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
] as const;

export const CLOUDFLARE_ARTIFACT_SERVICES = [
  {
    name: 'edge',
    configPath: join(REPO_ROOT, 'apps', 'edge', 'wrangler.private-canary.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'edge', 'src', 'index.ts'),
    needsHyperdrive: true,
  },
  {
    name: 'usage-consumer',
    configPath: join(REPO_ROOT, 'apps', 'usage-consumer', 'wrangler.private-canary.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'usage-consumer', 'src', 'index.ts'),
    needsHyperdrive: true,
  },
  {
    name: 'web',
    configPath: join(REPO_ROOT, 'apps', 'web', 'wrangler.private-canary.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'web', 'src', 'index.ts'),
    needsHyperdrive: true,
  },
  {
    name: 'acquisition-worker',
    configPath: join(REPO_ROOT, 'apps', 'acquisition-worker', 'wrangler.private-canary.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'acquisition-worker', 'src', 'index.ts'),
    needsHyperdrive: true,
  },
  {
    name: 'mcp-worker',
    configPath: join(REPO_ROOT, 'apps', 'mcp-worker', 'wrangler.private-canary.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'mcp-worker', 'src', 'index.ts'),
    needsHyperdrive: true,
  },
  {
    name: 'private-canary',
    configPath: join(REPO_ROOT, 'apps', 'private-canary', 'wrangler.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'private-canary', 'src', 'index.ts'),
    needsHyperdrive: false,
  },
] as const;

type TomlObject = Record<string, unknown>;

export interface CloudflareArtifactOptions {
  readonly outputRoot?: string;
}

export type CloudflareArtifactTopologyOptions = Omit<CloudflareTopologyOptions, 'mode'>;

export interface CloudflareArtifactResult {
  readonly services: readonly string[];
  readonly artifacts: readonly CloudflareArtifactServiceResult[];
  readonly files: number;
  readonly bytes: number;
}

export interface CloudflareArtifactServiceResult {
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
}

export function formatCloudflareArtifactSuccessMessage(result: CloudflareArtifactResult): string {
  return (
    'OK: Wrangler dry-run built six route-less private-canary Worker artifacts ' +
    '(five reduced target Workers plus the private-canary harness; ' +
    `${result.files} files, ${result.bytes} bytes) with no PGlite runtime.\n`
  );
}

export function renderDryRunConfig(source: string, mainPath: string, needsHyperdrive: boolean): string {
  const config = parse(source) as TomlObject;
  config['main'] = mainPath.replaceAll('\\', '/');
  if (needsHyperdrive) {
    config['hyperdrive'] = [{ binding: 'HYPERDRIVE', id: DRY_RUN_HYPERDRIVE_ID }];
  }
  return stringify(config);
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await walk(directory);
  return files.sort();
}

export async function scanCloudflareArtifacts(outputRoot: string): Promise<{
  readonly files: number;
  readonly bytes: number;
}> {
  const files = await filesUnder(outputRoot);
  if (files.length === 0) throw new Error('Wrangler dry-run produced no artifact files.');
  let bytes = 0;
  for (const path of files) {
    bytes += (await stat(path)).size;
    if (path.toLowerCase().endsWith('.wasm')) {
      throw new Error('Cloudflare artifact includes a WebAssembly file; PGlite must not ship.');
    }
    if (!/\.(?:c|m)?js$/i.test(path)) continue;
    // Scan the bytes Wrangler would deploy. Regex-removing comments is unsafe:
    // `//` inside a URL string can erase executable code later on that line.
    const code = await readFile(path, 'utf8');
    const prohibited = [
      /electric-sql/i,
      /createPgliteDriver/,
      /createDriverFromEnv/,
      /WebAssembly\.(?:instantiate|compile)/,
      /\.wasm\b/i,
    ];
    const leak = prohibited.find((pattern) => pattern.test(code));
    if (leak !== undefined) {
      throw new Error(`Cloudflare artifact contains prohibited PGlite/WebAssembly runtime code (${leak}).`);
    }
  }
  return { files: files.length, bytes };
}

export function buildWranglerArtifactEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    WRANGLER_SEND_METRICS: 'false',
    CI: 'true',
  };
  for (const name of WRANGLER_OS_ENVIRONMENT_KEYS) {
    const value = parent[name];
    if (value !== undefined && value !== '') environment[name] = value;
  }
  return environment;
}

export async function validateCloudflareArtifactTopology(
  options: CloudflareArtifactTopologyOptions = {},
): Promise<readonly string[]> {
  const [repositoryErrors, targetErrors] = await Promise.all([
    validateCloudflareTopology(options),
    validateCloudflareTopology({ ...options, mode: 'private-canary-target' }),
  ]);
  return [...repositoryErrors, ...targetErrors];
}

export async function buildCloudflareArtifacts(
  options: CloudflareArtifactOptions = {},
): Promise<CloudflareArtifactResult> {
  const topologyErrors = await validateCloudflareArtifactTopology();
  if (topologyErrors.length > 0) {
    throw new Error(`Cloudflare topology must pass before bundling:\n${topologyErrors.join('\n')}`);
  }

  const ownsOutput = options.outputRoot === undefined;
  const outputRoot = options.outputRoot ?? await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-output-'));
  const configRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-config-'));
  try {
    await mkdir(outputRoot, { recursive: true });
    for (const service of CLOUDFLARE_ARTIFACT_SERVICES) {
      const configPath = join(configRoot, `${service.name}.toml`);
      const outdir = join(outputRoot, service.name);
      await mkdir(outdir, { recursive: true });
      await writeFile(
        configPath,
        renderDryRunConfig(
          await readFile(service.configPath, 'utf8'),
          service.mainPath,
          service.needsHyperdrive,
        ),
        'utf8',
      );
      await execFileAsync(
        process.execPath,
        [
          WRANGLER_CLI,
          'deploy',
          '--dry-run',
          '--outdir',
          outdir,
          '--config',
          configPath,
          '--env-file',
          WRANGLER_EMPTY_ENV_FILE,
          '--experimental-provision=false',
        ],
        {
          // The generated config directory contains no project .env/.dev.vars
          // files. The explicit empty env file also disables Wrangler's
          // default .env/.env.local search.
          cwd: configRoot,
          env: buildWranglerArtifactEnvironment(process.env),
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    }
    const artifacts: CloudflareArtifactServiceResult[] = [];
    for (const service of CLOUDFLARE_ARTIFACT_SERVICES) {
      const scanned = await scanCloudflareArtifacts(join(outputRoot, service.name));
      if (scanned.files === 0) {
        throw new Error(`Wrangler dry-run produced no artifact files for ${service.name}.`);
      }
      artifacts.push({
        name: service.name,
        ...scanned,
      });
    }
    return {
      services: CLOUDFLARE_ARTIFACT_SERVICES.map(({ name }) => name),
      artifacts,
      files: artifacts.reduce((total, artifact) => total + artifact.files, 0),
      bytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
    };
  } finally {
    await rm(configRoot, { recursive: true, force: true });
    if (ownsOutput) await rm(outputRoot, { recursive: true, force: true });
  }
}

export async function run(): Promise<number> {
  const result = await buildCloudflareArtifacts();
  process.stdout.write(formatCloudflareArtifactSuccessMessage(result));
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
