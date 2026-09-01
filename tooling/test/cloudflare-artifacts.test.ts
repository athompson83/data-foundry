import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function loadArtifactModule(): Promise<Record<string, unknown>> {
  const module = await import('../scripts/check-cloudflare-artifacts.js').catch(() => null);
  expect(module, 'the repository needs a credential-free Wrangler production artifact gate').not.toBeNull();
  return module as Record<string, unknown>;
}

describe('Cloudflare route-less private-canary artifacts', () => {
  it('builds Wrangler dry-run children from an explicit non-credential environment', async () => {
    const module = await loadArtifactModule();
    const buildEnvironment = module['buildWranglerArtifactEnvironment'];
    expect(typeof buildEnvironment).toBe('function');
    if (typeof buildEnvironment !== 'function') return;

    expect((buildEnvironment as (parent: Record<string, string>) => Record<string, string>)({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      CLOUDFLARE_API_TOKEN: 'must-not-cross',
      CLOUDFLARE_API_BASE_URL: 'https://credential-capture.invalid',
      POSTGRES_URL: 'postgres://must-not-cross',
      NODE_OPTIONS: '--require=untrusted-hook.cjs',
      NODE_PATH: 'untrusted-module-path',
    })).toEqual({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      WRANGLER_SEND_METRICS: 'false',
      CI: 'true',
    });
  });

  it('uses the five ordinary manifests plus five private-canary targets with synthetic Hyperdrive and keeps the harness unbound', async () => {
    const module = await loadArtifactModule();
    const render = module['renderDryRunConfig'];
    const repoRoot = module['REPO_ROOT'];
    const services = module['CLOUDFLARE_ARTIFACT_SERVICES'];
    expect(typeof render).toBe('function');
    expect(typeof repoRoot).toBe('string');
    expect(Array.isArray(services)).toBe(true);
    if (typeof render !== 'function' || typeof repoRoot !== 'string' || !Array.isArray(services)) return;

    const renderDryRunConfig = render as (source: string, mainPath: string, needsHyperdrive: boolean) => string;
    const expectedOrdinaryTargets = ['edge', 'usage-consumer', 'web', 'acquisition-worker', 'mcp-worker'];
    const expectedOrdinaryArtifactNames = expectedOrdinaryTargets.map((name) => `ordinary-${name}`);
    const expectedCanaryArtifactNames = expectedOrdinaryTargets.map((name) => `private-canary-${name}`);

    expect(services.map((service) => service.name)).toEqual([
      ...expectedOrdinaryArtifactNames,
      ...expectedCanaryArtifactNames,
      'private-canary',
    ]);
    for (const [index, targetName] of expectedOrdinaryTargets.entries()) {
      const ordinary = services[index];
      const target = services[index + expectedOrdinaryTargets.length];
      expect(ordinary.configPath).toBe(join(repoRoot, 'apps', targetName, 'wrangler.toml'));
      expect(target.configPath).toBe(join(repoRoot, 'apps', targetName, 'wrangler.private-canary.toml'));
      expect(ordinary.needsHyperdrive).toBe(true);
      expect(target.needsHyperdrive).toBe(true);
    }

    for (const service of services) {
      const source = await readFile(service.configPath, 'utf8');
      const rendered = renderDryRunConfig(source, service.mainPath, service.needsHyperdrive);
      if (service.name === 'private-canary') {
        expect(service.configPath).toBe(join(repoRoot, 'apps', 'private-canary', 'wrangler.toml'));
        expect(service.needsHyperdrive).toBe(false);
        expect(rendered).not.toContain('hyperdrive');
      } else {
        expect(service.needsHyperdrive).toBe(true);
        expect(rendered).toContain('binding = "HYPERDRIVE"');
      }
    }
  });

  it('requires the reduced target topology before artifact bundling', async () => {
    const module = await loadArtifactModule();
    const validateTopology = module['validateCloudflareArtifactTopology'];
    expect(typeof validateTopology).toBe('function');
    if (typeof validateTopology !== 'function') return;

    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-artifact-topology-collision-'));
    temporaryDirectories.push(directory);
    const acquisitionConfigPath = join(directory, 'acquisition.toml');
    await writeFile(
      acquisitionConfigPath,
      (await readFile(join(REPO_ROOT, 'apps', 'acquisition-worker', 'wrangler.toml'), 'utf8')).replace(
        'name = "data-foundry-acquisition-worker"',
        'name = "data-foundry-private-canary-acquisition-worker"',
      ),
      'utf8',
    );

    const errors = await (
      validateTopology as (options: { readonly acquisitionConfigPath: string }) => Promise<readonly string[]>
    )({ acquisitionConfigPath });

    expect(errors.join('\n')).toMatch(
      /acquisition-worker private-canary target must not reuse an ordinary Worker name/i,
    );
  });

  it('reports ordinary and six route-less private-canary artifacts separately', async () => {
    const module = await loadArtifactModule();
    const formatSuccessMessage = module['formatCloudflareArtifactSuccessMessage'];
    expect(typeof formatSuccessMessage).toBe('function');
    if (typeof formatSuccessMessage !== 'function') return;

    expect(
      (formatSuccessMessage as (result: {
        readonly services: readonly string[];
        readonly artifacts: readonly { readonly name: string; readonly files: number; readonly bytes: number }[];
        readonly files: number;
        readonly bytes: number;
      }) => string)({
        services: [
          'ordinary-edge',
          'ordinary-usage-consumer',
          'ordinary-web',
          'ordinary-acquisition-worker',
          'ordinary-mcp-worker',
          'private-canary-edge',
          'private-canary-usage-consumer',
          'private-canary-web',
          'private-canary-acquisition-worker',
          'private-canary-mcp-worker',
          'private-canary',
        ],
        artifacts: [],
        files: 18,
        bytes: 123_456,
      }),
    ).toBe(
      'OK: Wrangler dry-run built eleven Worker artifacts (five ordinary production Workers plus six route-less ' +
        'private-canary artifacts: five reduced target Workers plus the private-canary harness; 18 files, 123456 bytes) ' +
        'with no PGlite runtime.\n',
    );
  });

  it('builds every ordinary and route-less private-canary artifact with pinned Wrangler dry-run and finds no local PGlite runtime', async () => {
    const module = await loadArtifactModule();
    const build = module['buildCloudflareArtifacts'];
    expect(typeof build).toBe('function');
    if (typeof build !== 'function') return;

    const outputRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-artifacts-'));
    temporaryDirectories.push(outputRoot);
    const result = await (
      build as (options: { readonly outputRoot: string }) => Promise<{
        readonly services: readonly string[];
        readonly files: number;
        readonly bytes: number;
        readonly artifacts: readonly {
          readonly name: string;
          readonly files: number;
          readonly bytes: number;
        }[];
      }>
    )({ outputRoot });

    expect(result.services).toEqual([
      'ordinary-edge',
      'ordinary-usage-consumer',
      'ordinary-web',
      'ordinary-acquisition-worker',
      'ordinary-mcp-worker',
      'private-canary-edge',
      'private-canary-usage-consumer',
      'private-canary-web',
      'private-canary-acquisition-worker',
      'private-canary-mcp-worker',
      'private-canary',
    ]);
    expect(result.artifacts.map(({ name }) => name)).toEqual(result.services);
    for (const artifact of result.artifacts) {
      expect(artifact.files).toBeGreaterThan(0);
      expect(artifact.bytes).toBeGreaterThan(0);
      expect((await readdir(join(outputRoot, artifact.name))).length).toBeGreaterThan(0);
    }
    expect(result.files).toBeGreaterThanOrEqual(11);
    expect(result.bytes).toBeGreaterThan(100_000);
  }, 240_000);

  it('fails closed when a generated JavaScript artifact can reach PGlite', async () => {
    const module = await loadArtifactModule();
    const scan = module['scanCloudflareArtifacts'];
    expect(typeof scan).toBe('function');
    if (typeof scan !== 'function') return;

    const outputRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-leak-'));
    temporaryDirectories.push(outputRoot);
    const service = join(outputRoot, 'edge');
    await mkdir(service, { recursive: true });
    await writeFile(
      join(service, 'index.js'),
      'const createPgliteDriver = () => WebAssembly.instantiate(new Uint8Array());\n',
      'utf8',
    );

    await expect((scan as (root: string) => Promise<unknown>)(outputRoot)).rejects.toThrow(
      /PGlite|WebAssembly/,
    );
  });

  it('does not mistake a URL string for a line comment before a prohibited signature', async () => {
    const module = await loadArtifactModule();
    const scan = module['scanCloudflareArtifacts'];
    expect(typeof scan).toBe('function');
    if (typeof scan !== 'function') return;

    const outputRoot = await mkdtemp(join(tmpdir(), 'data-foundry-wrangler-url-leak-'));
    temporaryDirectories.push(outputRoot);
    const service = join(outputRoot, 'edge');
    await mkdir(service, { recursive: true });
    await writeFile(
      join(service, 'index.js'),
      'const docs = "https://example.test/runtime"; const createPgliteDriver = () => docs;\n',
      'utf8',
    );

    await expect((scan as (root: string) => Promise<unknown>)(outputRoot)).rejects.toThrow(
      /PGlite|createPgliteDriver/,
    );
  });
});
