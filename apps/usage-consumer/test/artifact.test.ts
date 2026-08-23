/**
 * The build-level counterpart to `apps/edge/test/artifact.test.ts`, for this
 * consumer's own entry point. Same claim, same method, same reason it is
 * not a source-text scan: `createPgliteDriver`'s dynamic
 * `import('@electric-sql/pglite')` is the shape a bundler is least equipped
 * to prove dead, and this suite reads the proof back out of a real esbuild
 * artifact rather than asserting it by reasoning.
 *
 * Checked once against `wrangler deploy --dry-run` itself during
 * development: 779 KB of output, zero source-map entries mentioning
 * `pglite` — not even the one incidental doc-comment `apps/edge`'s bundle
 * carries, because this consumer's import graph does not reach the file
 * that comment lives in. Not re-run here; see the sibling suite's comment
 * for why `esbuild` and not `wrangler` is what CI actually runs.
 */
import { describe, expect, it } from 'vitest';
import { build, type Metafile } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

async function bundleEntry(entry: string): Promise<{ text: string; metafile: Metafile }> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    metafile: true,
    logLevel: 'silent',
  });
  const file = result.outputFiles[0];
  if (file === undefined) throw new Error('esbuild produced no output file');
  return { text: file.text, metafile: result.metafile };
}

function bytesFrom(metafile: Metafile, matches: (path: string) => boolean): number {
  const outputs = Object.values(metafile.outputs);
  if (outputs.length === 0) throw new Error('metafile has no outputs — the build did not run');
  return outputs.reduce((sum, output) => {
    const inputs = Object.entries(output.inputs).filter(([path]) => matches(path));
    return sum + inputs.reduce((subtotal, [, info]) => subtotal + info.bytesInOutput, 0);
  }, 0);
}

describe('the built apps/usage-consumer Worker never bundles PGlite', () => {
  it(
    'contributes zero bytes from @electric-sql/pglite to the output',
    async () => {
      const { text, metafile } = await bundleEntry(SRC_ENTRY);

      const pgBytes = bytesFrom(
        metafile,
        (path) => path.includes('node_modules') && /[\\/]pg[\\/]|[\\/]pg-\w+[\\/]/.test(path),
      );
      expect(pgBytes, 'the build must actually reach `pg` — createPostgresDriver is on the live path').toBeGreaterThan(0);

      const pgliteBytes = bytesFrom(metafile, (path) => path.toLowerCase().includes('pglite'));
      expect(
        pgliteBytes,
        'PGlite must contribute zero bytes to the artifact this Worker ships',
      ).toBe(0);

      const specifierOccurrences = (text.match(/@electric-sql\/pglite/g) ?? []).length;
      expect(specifierOccurrences, 'the PGlite package specifier should not appear in the built output').toBe(0);
    },
    30_000,
  );
});
