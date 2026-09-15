/**
 * Build the real public Worker entry point and prove the production graph does
 * not retain the local-only PGlite driver. This mirrors the edge and usage
 * consumer controls: source scans cannot prove what a bundler tree-shakes.
 */
import { describe, expect, it } from 'vitest';
import { build, type Metafile } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

function bytesFrom(metafile: Metafile, matches: (path: string) => boolean): number {
  const outputs = Object.values(metafile.outputs);
  if (outputs.length === 0) throw new Error('metafile has no outputs — the build did not run');
  return outputs.reduce((sum, output) => {
    const inputs = Object.entries(output.inputs).filter(([path]) => matches(path));
    return sum + inputs.reduce((subtotal, [, info]) => subtotal + info.bytesInOutput, 0);
  }, 0);
}

describe('the built apps/web Worker never bundles PGlite', () => {
  it(
    'contributes zero bytes from @electric-sql/pglite to the output',
    async () => {
      const result = await build({
        entryPoints: [SRC_ENTRY],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'es2022',
        // Cloudflare resolves its runtime builtin when the Worker deploys;
        // this Node-shaped artifact check must leave that specifier external.
        external: ['cloudflare:*'],
        metafile: true,
        logLevel: 'silent',
      });
      const file = result.outputFiles[0];
      if (file === undefined) throw new Error('esbuild produced no output file');

      const pgBytes = bytesFrom(
        result.metafile,
        (path) => path.includes('node_modules') && /[\\/]pg[\\/]|[\\/]pg-\w+[\\/]/.test(path),
      );
      expect(
        pgBytes,
        'the build must reach pg, or a zero-byte PGlite result proves nothing',
      ).toBeGreaterThan(0);

      const pgliteBytes = bytesFrom(result.metafile, (path) =>
        path.toLowerCase().includes('pglite'),
      );
      expect(pgliteBytes, 'PGlite must contribute zero bytes to the public Worker').toBe(0);
      expect(file.text).not.toContain('@electric-sql/pglite');
    },
    30_000,
  );
});
