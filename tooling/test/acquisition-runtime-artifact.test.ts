import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('the acquisition runtime compiler', () => {
  it('bundles only the four declared synthetic HVAC targets and detects drift', async () => {
    const module = await import('../scripts/compile-acquisition-runtime.js');
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-acquisition-runtime-'));
    temporaryDirectories.push(directory);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(await module.run(['hvac'], true, { outputDir: directory })).toBe(1);
    expect(await module.run(['hvac'], false, { outputDir: directory })).toBe(0);
    expect(await module.run(['hvac'], true, { outputDir: directory })).toBe(0);

    const runtime = JSON.parse(
      await readFile(join(directory, 'hvac.acquisition-runtime.json'), 'utf8'),
    ) as {
      vertical_slug: string;
      vertical_name: string;
      vertical_schema_version: string;
      vertical_status: string;
      targets: readonly {
        target_id: string;
        max_direct_http_response_bytes?: number;
        source: { key: string };
        target_url: string;
        result_url_policy: { allowedOrigins: readonly string[]; allowedPathPrefixes: readonly string[] };
      }[];
    };
    expect(runtime.vertical_slug).toBe('hvac');
    expect(runtime).toMatchObject({
      vertical_name: 'HVAC Equipment',
      vertical_schema_version: '0.1.0',
      vertical_status: 'DRAFT',
    });
    expect(runtime.targets.map((target) => target.source.key)).toEqual([
      'acme-hvac-catalog',
      'acme-spec-sheets',
      'ahri-directory-export',
      'coolsupply-distributor',
    ]);
    expect(new Set(runtime.targets.map((target) => target.target_id)).size).toBe(4);
    expect(runtime.targets.map((target) => target.max_direct_http_response_bytes)).toEqual([
      1_048_576,
      8_388_608,
      16_777_216,
      undefined,
    ]);
    expect(JSON.stringify(runtime).toLowerCase()).not.toContain('energy-star');
    expect(JSON.stringify(runtime).toLowerCase()).not.toContain('energystar');
    expect(runtime.targets.every((target) => target.target_url.startsWith('https://'))).toBe(true);
    expect(runtime.targets.every((target) => {
      const url = new URL(target.target_url);
      return target.result_url_policy.allowedOrigins.includes(url.origin) &&
        target.result_url_policy.allowedPathPrefixes.some((prefix) =>
          url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
        );
    })).toBe(true);

    const registryPath = join(directory, 'runtime-registry.ts');
    const registry = await readFile(registryPath, 'utf8');
    expect(registry).toContain("import hvacRuntime from './hvac.acquisition-runtime.json'");
    expect(registry).toContain('export const BUNDLED_ACQUISITION_VERTICALS = ["hvac"] as const;');

    await writeFile(registryPath, `${registry} `, 'utf8');
    expect(await module.run(['hvac'], true, { outputDir: directory })).toBe(1);
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 16_777_217, Number.POSITIVE_INFINITY])(
    'refuses an unsafe max_direct_http_response_bytes value (%s)',
    async (maxResponseBytes) => {
      const module = await import('../scripts/compile-acquisition-runtime.js');
      const parseConfig = Reflect.get(module, 'parseAcquisitionConfig');
      expect(parseConfig).toBeTypeOf('function');
      if (typeof parseConfig !== 'function') return;
      expect(() => parseConfig({
        version: 2,
        targets: [{
          target_id: 'example',
          source_key: 'example-source',
          target_url: 'https://example.com/data.json',
          max_direct_http_response_bytes: maxResponseBytes,
          result_url_policy: {
            allowedOrigins: ['https://example.com'],
            allowedPathPrefixes: ['/data.json'],
          },
          asset_class: 'DATA',
          output_class: 'RAW_RECORD',
        }],
      })).toThrow(/max_direct_http_response_bytes/i);
    },
  );
});
