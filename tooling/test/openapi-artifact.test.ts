import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the OpenAPI artifact gate', () => {
  it('creates a deterministic contract artifact for every bundled edge vertical', async () => {
    const module = await import('../scripts/generate-openapi.js').catch(() => null);
    expect(module, 'the OpenAPI generator must support more than one edge vertical').not.toBeNull();
    if (module === null) return;
    const serialize = (module as Record<string, unknown>)['serializeOpenApiArtifacts'];
    expect(typeof serialize).toBe('function');
    if (typeof serialize !== 'function') return;

    const artifacts = (serialize as (
      bundledVerticals: readonly string[],
      runtimes: Readonly<Record<string, { readonly fields: readonly unknown[] }>>,
    ) => Readonly<Record<string, string>>)(
      ['solar', 'hvac'],
      {
        hvac: { fields: [] },
        solar: { fields: [] },
      },
    );

    expect(Object.keys(artifacts)).toEqual([
      'data-foundry-hvac-v1.openapi.json',
      'data-foundry-solar-v1.openapi.json',
    ]);
    expect(JSON.parse(artifacts['data-foundry-hvac-v1.openapi.json'] ?? '{}')).toMatchObject({
      'x-data-foundry-vertical': 'hvac',
    });
    expect(JSON.parse(artifacts['data-foundry-solar-v1.openapi.json'] ?? '{}')).toMatchObject({
      'x-data-foundry-vertical': 'solar',
    });
  });

  it('keeps the legacy artifact pinned to HVAC even when an earlier vertical is bundled', async () => {
    const module = await import('../scripts/generate-openapi.js').catch(() => null);
    expect(module, 'the generator must select the legacy artifact explicitly').not.toBeNull();
    if (module === null) return;
    const selectLegacy = (module as Record<string, unknown>)['legacyOpenApiSlug'];
    expect(typeof selectLegacy).toBe('function');
    if (typeof selectLegacy !== 'function') return;

    expect((selectLegacy as (slugs: readonly string[]) => string)(['agriculture', 'hvac'])).toBe('hvac');
    expect(() => (selectLegacy as (slugs: readonly string[]) => string)(['agriculture', 'solar'])).toThrow(
      /legacy.*explicit/i,
    );
  });

  it('rejects retired per-vertical artifacts and removes only that owned artifact on generation', async () => {
    const module = await import('../scripts/generate-openapi.js').catch(() => null);
    expect(module, 'the repository needs an OpenAPI artifact-set owner').not.toBeNull();
    if (module === null) return;
    const run = (module as Record<string, unknown>)['run'];
    expect(typeof run).toBe('function');
    if (typeof run !== 'function') return;

    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-openapi-retired-'));
    temporaryDirectories.push(directory);
    const invoke = run as (
      check: boolean,
      options: { readonly outputDirectory: string },
    ) => Promise<number>;
    expect(await invoke(false, { outputDirectory: directory })).toBe(0);
    const retired = join(directory, 'data-foundry-retired-v1.openapi.json');
    const unrelated = join(directory, 'data-foundry-retired-v1.openapi.json.backup');
    await writeFile(retired, '{}\n', 'utf8');
    await writeFile(unrelated, 'keep\n', 'utf8');

    expect(await invoke(true, { outputDirectory: directory })).toBe(1);
    expect(await invoke(false, { outputDirectory: directory })).toBe(0);
    await expect(readFile(retired, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('keep\n');
  });

  it('fails when absent or stale and passes only after generation', async () => {
    const module = await import('../scripts/generate-openapi.js').catch(() => null);
    expect(module, 'the repository needs an executable OpenAPI generator').not.toBeNull();
    if (module === null) return;
    const run = (module as Record<string, unknown>)['run'];
    expect(typeof run).toBe('function');
    if (typeof run !== 'function') return;

    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-openapi-'));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, 'data-foundry-v1.openapi.json');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const invoke = run as (check: boolean, options: { readonly outputPath: string }) => Promise<number>;

    expect(await invoke(true, { outputPath })).toBe(1);
    expect(await invoke(false, { outputPath })).toBe(0);
    expect(await invoke(true, { outputPath })).toBe(0);
    const generated = await readFile(outputPath, 'utf8');
    expect(JSON.parse(generated)).toMatchObject({ openapi: '3.1.0' });

    await writeFile(outputPath, `${generated} `, 'utf8');
    expect(await invoke(true, { outputPath })).toBe(1);
    expect(stderr).toHaveBeenCalled();
    expect(stdout).toHaveBeenCalled();
  });
});
