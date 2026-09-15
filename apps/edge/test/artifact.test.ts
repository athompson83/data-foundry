/**
 * The claim `env.test.ts`'s source-scan cannot make: that PGlite is not just
 * unreached at runtime, but absent from the bytes that actually ship in the
 * built Worker.
 *
 * `sql-driver.ts` reaches PGlite through a *dynamic* `import('@electric-sql/pglite')`
 * inside `createPgliteDriver` — the shape a bundler is least equipped to
 * prove dead, since a dynamic import can in general be reached from
 * anywhere. It turns out esbuild (the bundler `wrangler` itself runs) still
 * eliminates it here: `createPgliteDriver` is never called anywhere
 * `src/index.ts` can reach, has no import-time side effects of its own, and
 * a dynamic import inside code proven dead is dropped along with it. This
 * suite builds the real entry point with the real bundler and reads that
 * proof back out of the artifact — `bytesInOutput`, not a guess about what
 * "should" tree-shake — rather than trusting the reasoning in this comment.
 *
 * Checked once against `wrangler deploy --dry-run` itself, not only esbuild
 * directly, so the specific finding is anchored to the actual deploy
 * pipeline: 963 KB of output, zero source-map entries mentioning `pglite`.
 * Not re-run here — `wrangler` fetches itself over the network on first
 * use, and this suite has no business depending on that. `esbuild` is a
 * committed, pinned devDependency instead, and it is the bundler `wrangler`
 * itself delegates to, not a different tool making a different claim.
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
    // `platform: 'node'` rather than a Workers-specific target: this suite's
    // claim is about which *bytes reach the output*, not about producing a
    // deployable artifact — `nodejs_compat`'s own shims are wrangler's
    // concern, not esbuild's, and do not change what gets tree-shaken here.
    platform: 'node',
    target: 'es2022',
    // This is a Cloudflare runtime builtin, not an npm dependency. Preserve
    // it exactly as Wrangler will resolve it instead of asking Node/esbuild to.
    external: ['cloudflare:*'],
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

describe('the built apps/edge Worker never bundles PGlite', () => {
  it(
    'contributes zero bytes from @electric-sql/pglite to the output',
    async () => {
      const { text, metafile } = await bundleEntry(SRC_ENTRY);

      // The positive control: prove this build actually resolves and bundles
      // dependencies at all, or a "zero bytes" result below would be trivially
      // true for the wrong reason — a broken build that bundled nothing.
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

      // A second, independent signal on the literal shipped text: the
      // package specifier itself should not survive, either as a live
      // import or (still fine, but worth knowing) as a dead one esbuild kept
      // around unminified. `bytesInOutput` above is the guarantee; this is a
      // cheap corroboration that would catch the metafile lying to itself.
      const specifierOccurrences = (text.match(/@electric-sql\/pglite/g) ?? []).length;
      expect(specifierOccurrences, 'the PGlite package specifier should not appear in the built output').toBe(0);
    },
    30_000,
  );
});
