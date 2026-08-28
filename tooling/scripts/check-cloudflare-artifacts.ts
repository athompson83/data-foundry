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
import { validateCloudflareTopology } from './check-cloudflare-topology.js';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
const WRANGLER_CLI = createRequire(import.meta.url).resolve('wrangler');
const DRY_RUN_HYPERDRIVE_ID = '00000000000000000000000000000000';

const SERVICES = [
  {
    name: 'edge',
    configPath: join(REPO_ROOT, 'apps', 'edge', 'wrangler.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'edge', 'src', 'index.ts'),
  },
  {
    name: 'usage-consumer',
    configPath: join(REPO_ROOT, 'apps', 'usage-consumer', 'wrangler.toml'),
    mainPath: join(REPO_ROOT, 'apps', 'usage-consumer', 'src', 'index.ts'),
  },
] as const;

type TomlObject = Record<string, unknown>;

export interface CloudflareArtifactOptions {
  readonly outputRoot?: string;
}

export interface CloudflareArtifactResult {
  readonly services: readonly string[];
  readonly files: number;
  readonly bytes: number;
}

function renderDryRunConfig(source: string, mainPath: string): string {
  const config = parse(source) as TomlObject;
  config['main'] = mainPath.replaceAll('\\', '/');
  config['hyperdrive'] = [{ binding: 'HYPERDRIVE', id: DRY_RUN_HYPERDRIVE_ID }];
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

function credentialFreeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
    CI: 'true',
  };
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'CF_ACCOUNT_ID',
    'WRANGLER_API_TOKEN',
  ]) {
    delete environment[name];
  }
  return environment;
}

export async function buildCloudflareArtifacts(
  options: CloudflareArtifactOptions = {},
): Promise<CloudflareArtifactResult> {
  const topologyErrors = await validateCloudflareTopology();
  if (topologyErrors.length > 0) {
    throw new Error(`Cloudflare topology must pass before bundling:\n${topologyErrors.join('\n')}`);
  }

  const ownsOutput = options.outputRoot === undefined;
  const outputRoot = options.outputRoot ?? await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-output-'));
  const configRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-config-'));
  try {
    await mkdir(outputRoot, { recursive: true });
    for (const service of SERVICES) {
      const configPath = join(configRoot, `${service.name}.toml`);
      const outdir = join(outputRoot, service.name);
      await mkdir(outdir, { recursive: true });
      await writeFile(
        configPath,
        renderDryRunConfig(await readFile(service.configPath, 'utf8'), service.mainPath),
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
          '--experimental-provision=false',
        ],
        {
          cwd: REPO_ROOT,
          env: credentialFreeEnvironment(),
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    }
    const scanned = await scanCloudflareArtifacts(outputRoot);
    return { services: SERVICES.map(({ name }) => name), ...scanned };
  } finally {
    await rm(configRoot, { recursive: true, force: true });
    if (ownsOutput) await rm(outputRoot, { recursive: true, force: true });
  }
}

export async function run(): Promise<number> {
  const result = await buildCloudflareArtifacts();
  process.stdout.write(
    `OK: Wrangler dry-run built ${result.services.length} production Worker artifacts ` +
      `(${result.files} files, ${result.bytes} bytes) with no PGlite runtime.\n`,
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
