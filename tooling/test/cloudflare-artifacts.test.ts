import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function loadArtifactModule(): Promise<Record<string, unknown>> {
  const module = await import('../scripts/check-cloudflare-artifacts.js').catch(() => null);
  expect(module, 'the repository needs a credential-free Wrangler production artifact gate').not.toBeNull();
  return module as Record<string, unknown>;
}

describe('Cloudflare production artifacts', () => {
  it('builds every deployed Worker with pinned Wrangler dry-run and finds no local PGlite runtime', async () => {
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
      }>
    )({ outputRoot });

    expect(result.services).toEqual([
      'edge',
      'usage-consumer',
      'web',
      'acquisition-worker',
      'mcp-worker',
    ]);
    expect(result.files).toBeGreaterThanOrEqual(5);
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
