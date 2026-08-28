import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('the OpenAPI artifact gate', () => {
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
