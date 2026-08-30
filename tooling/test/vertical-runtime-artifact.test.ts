import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the edge vertical runtime compiler', () => {
  it('generates the JSON artifacts and typed registry from one bundled-vertical list', async () => {
    const module = await import('../scripts/compile-vertical-runtime.js');
    const bundled = (module as Record<string, unknown>)['BUNDLED_VERTICALS'];
    expect(bundled, 'the compiler must name bundle presence without implying deployment/publication').toEqual([
      'hvac',
    ]);

    const run = (module as Record<string, unknown>)['run'];
    expect(typeof run).toBe('function');
    if (typeof run !== 'function' || !Array.isArray(bundled)) return;

    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-edge-runtime-'));
    temporaryDirectories.push(directory);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const invoke = run as (
      slugs: readonly string[],
      check: boolean,
      options: { readonly outputDir: string },
    ) => Promise<number>;

    expect(await invoke(bundled, true, { outputDir: directory })).toBe(1);
    expect(await invoke(bundled, false, { outputDir: directory })).toBe(0);
    expect(await invoke(bundled, true, { outputDir: directory })).toBe(0);

    const runtime = JSON.parse(await readFile(join(directory, 'hvac.runtime.json'), 'utf8')) as {
      vertical_slug?: string;
    };
    expect(runtime.vertical_slug).toBe('hvac');
    const registryPath = join(directory, 'runtime-registry.ts');
    const registry = await readFile(registryPath, 'utf8');
    expect(registry).toContain("import hvacRuntime from './hvac.runtime.json' with { type: 'json' };");
    expect(registry).toContain('export const BUNDLED_VERTICALS = ["hvac"] as const;');
    expect(registry).toContain('"hvac": hvacRuntime as VerticalRuntime');

    await writeFile(registryPath, `${registry} `, 'utf8');
    expect(await invoke(bundled, true, { outputDir: directory })).toBe(1);
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });
});
