import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('cross-platform CLI entry detection', () => {
  it('compares canonical file URLs instead of concatenating file:// with a Windows path', async () => {
    const module = await import('../lib/cli-entry.js').catch(() => null);
    expect(module, 'tooling needs one shared cross-platform isMain helper').not.toBeNull();
    if (module === null) return;
    const isMain = (module as Record<string, unknown>)['isMain'];
    expect(typeof isMain).toBe('function');
    if (typeof isMain !== 'function') return;

    const entryPath = resolve('tooling', 'scripts', 'probe with spaces.ts');
    const entryUrl = pathToFileURL(entryPath).href;
    expect((isMain as (url: string, entry: string) => boolean)(entryUrl, entryPath)).toBe(true);
    expect((isMain as (url: string, entry: string) => boolean)(entryUrl, resolve('other.ts'))).toBe(false);
  });
});
