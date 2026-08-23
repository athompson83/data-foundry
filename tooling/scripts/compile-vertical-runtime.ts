/**
 * Compile a vertical's read-side configuration into a bundled JSON artifact.
 *
 * The edge runtime has no filesystem. `loadVerticalConfig` reads YAML off disk,
 * which is right for the ingest worker and impossible in a Worker, so the parts
 * of that configuration a *read* surface needs are compiled here and committed.
 * The deployed Worker imports the artifact; it never parses YAML and never
 * reaches for `services/ingest-worker`, which is the write side.
 *
 * Two things are compiled, and only two:
 *
 *   - `fields`, the filter/facet metadata `QueryModel` needs to know which
 *     vertical-declared fields may be filtered on at all. Without it `/v1/search`
 *     silently accepts no filters, which is worse than refusing them.
 *   - `fact_selection`, the doc-04 policy, minus `at`.
 *
 * `at` is deliberately absent. `buildFactSelectionPolicy` passes it straight
 * through — it is the caller's as-of instant, not a property of the vertical —
 * and baking a build timestamp into a committed artifact would make the output
 * non-deterministic and `--check` unrunnable. The Worker supplies it per
 * request.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFactSelectionPolicy,
  buildFieldMetadata,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import type { IsoDateTime } from '@data-foundry/canonical-schema';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'apps', 'edge', 'generated');

/**
 * A placeholder instant, stripped before the artifact is written.
 *
 * `buildFactSelectionPolicy` requires an `at` to build a policy at all. Passing
 * the wall clock would put the build time in the committed file and make every
 * rebuild a diff.
 */
const SENTINEL_AT = '1970-01-01T00:00:00.000Z' as IsoDateTime;

export interface VerticalRuntime {
  readonly vertical_slug: string;
  readonly fields: readonly unknown[];
  /** The doc-04 policy without `at`; the caller supplies that per request. */
  readonly fact_selection: Readonly<Record<string, unknown>>;
}

export async function compileVerticalRuntime(slug: string): Promise<VerticalRuntime> {
  const config = await loadVerticalConfig(slug, { verticalsDir: join(REPO_ROOT, 'verticals') });
  const policy = buildFactSelectionPolicy(config, { at: SENTINEL_AT });

  const factSelection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(policy)) {
    if (key === 'at') continue;
    factSelection[key] = value;
  }

  return {
    vertical_slug: slug,
    fields: buildFieldMetadata(config),
    fact_selection: factSelection,
  };
}

/** Stable, sorted, newline-terminated — so `--check` compares content, not formatting. */
export function serialize(runtime: VerticalRuntime): string {
  return `${JSON.stringify(runtime, null, 2)}\n`;
}

export function artifactPath(slug: string): string {
  return join(OUTPUT_DIR, `${slug}.runtime.json`);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function run(slugs: readonly string[], check: boolean): Promise<number> {
  const stale: string[] = [];
  for (const slug of slugs) {
    const expected = serialize(await compileVerticalRuntime(slug));
    const path = artifactPath(slug);
    if (check) {
      if ((await readIfPresent(path)) !== expected) stale.push(`${slug}.runtime.json`);
      continue;
    }
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path, expected, 'utf8');
  }

  if (check && stale.length > 0) {
    process.stderr.write(
      `Stale vertical runtime artifact(s): ${stale.join(', ')}.\n` +
        `Run \`pnpm verticals:compile\` and commit the result.\n`,
    );
    return 1;
  }
  process.stdout.write(
    check
      ? `OK: ${slugs.length} vertical runtime artifact(s) are up to date.\n`
      : `Wrote ${slugs.length} vertical runtime artifact(s) to apps/edge/generated.\n`,
  );
  return 0;
}

/** Verticals with a compiled read-side runtime. `_template` is not deployable. */
export const DEPLOYED_VERTICALS: readonly string[] = ['hvac'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  run(DEPLOYED_VERTICALS, check).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
