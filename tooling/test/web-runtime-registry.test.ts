import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import * as compiler from '../scripts/compile-web-runtime.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'data-foundry-web-registry-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('the generated web runtime registry', () => {
  it('makes every bundled vertical a static import in the Worker bundle', async () => {
    const serializeRuntimeRegistry = Reflect.get(compiler, 'serializeRuntimeRegistry');
    expect(
      serializeRuntimeRegistry,
      'the web compiler must generate the registry from its bundled-vertical input',
    ).toBeTypeOf('function');
    if (typeof serializeRuntimeRegistry !== 'function') return;

    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, 'hvac.web-runtime.json'),
      `${JSON.stringify({ vertical_slug: 'hvac' })}\n`,
      'utf8',
    );
    await writeFile(
      join(directory, 'water-heaters.web-runtime.json'),
      `${JSON.stringify({ vertical_slug: 'water-heaters' })}\n`,
      'utf8',
    );
    await writeFile(
      join(directory, 'runtime-registry.ts'),
      String(serializeRuntimeRegistry(['water-heaters', 'hvac'])),
      'utf8',
    );

    const bundled = join(directory, 'runtime-registry.mjs');
    const result = await build({
      entryPoints: [join(directory, 'runtime-registry.ts')],
      outfile: bundled,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
      metafile: true,
    });

    const loaded = (await import(`${pathToFileURL(bundled).href}?test=${Date.now()}`)) as {
      RUNTIMES?: Readonly<Record<string, { readonly vertical_slug?: string }>>;
    };
    expect(Object.keys(loaded.RUNTIMES ?? {})).toEqual(['hvac', 'water-heaters']);
    expect(loaded.RUNTIMES?.['hvac']?.vertical_slug).toBe('hvac');
    expect(loaded.RUNTIMES?.['water-heaters']?.vertical_slug).toBe('water-heaters');

    // The JSON files must be build-graph inputs. A runtime filesystem lookup
    // could expose the same keys under Node while remaining unavailable in a
    // Cloudflare Worker, but it cannot satisfy this bundle assertion.
    const inputs = Object.keys(result.metafile.inputs).map((path) => path.replaceAll('\\', '/'));
    expect(inputs.some((path) => path.endsWith('/hvac.web-runtime.json'))).toBe(true);
    expect(inputs.some((path) => path.endsWith('/water-heaters.web-runtime.json'))).toBe(true);
    expect(
      inputs.filter((path) => !path.endsWith('/runtime-registry.ts')).length,
      'the generated module may bundle only the runtime JSON files it registers',
    ).toBe(2);
  });

  it('makes compile-check fail closed when the registry is stale', async () => {
    const directory = await temporaryDirectory();
    const runtime = await compiler.compileWebRuntime('hvac');
    await writeFile(
      join(directory, 'hvac.web-runtime.json'),
      compiler.serialize(runtime),
      'utf8',
    );
    await writeFile(
      join(directory, 'index.json'),
      `${JSON.stringify({ verticals: ['hvac'] }, null, 2)}\n`,
      'utf8',
    );

    const runIn = compiler.run as (
      slugs: readonly string[],
      check: boolean,
      options?: { readonly outputDir?: string },
    ) => Promise<number>;
    expect(await runIn(['hvac'], true, { outputDir: directory })).toBe(1);

    await writeFile(
      join(directory, 'runtime-registry.ts'),
      compiler.serializeRuntimeRegistry(['hvac']),
      'utf8',
    );
    expect(await runIn(['hvac'], true, { outputDir: directory })).toBe(0);
  });

  it('executes the compiler when tsx invokes it on Windows', async () => {
    const tsxCli = require.resolve('tsx/cli');
    const script = join(compiler.REPO_ROOT, 'tooling', 'scripts', 'compile-web-runtime.ts');
    const result = await execFileAsync(process.execPath, [tsxCli, script], {
      cwd: compiler.REPO_ROOT,
    });

    expect(result.stdout).toContain('runtime registry');
  });

  it('is the exact runtime map exported by the web Worker', async () => {
    const [{ RUNTIMES: generated }, { RUNTIMES: worker }] = await Promise.all([
      import('../../apps/web/generated/runtime-registry.js'),
      import('../../apps/web/src/index.js'),
    ]);

    expect(
      worker,
      'apps/web must consume the generated map instead of reconstructing a hard-coded subset',
    ).toBe(generated);
  });
});
