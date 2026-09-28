/**
 * Validate content/articles/*.md and bake the published ones into the recall
 * Worker, which serves data.aroqon.com/articles (docs/articles.md).
 *
 *   pnpm articles:generate   write apps/recalls-worker/generated/articles.ts
 *   pnpm articles:check      fail if that file is stale or any article is invalid
 *
 * The Worker has no filesystem, so the committed module is what is deployed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../lib/cli-entry.js';
import { liveDatasetKeys, loadArticles, serializeArticlesModule } from '../lib/articles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const ARTICLES_DIR = join(REPO_ROOT, 'content', 'articles');
export const CANDIDATES_PATH = join(REPO_ROOT, 'docs', 'sources', 'pipeline', 'candidates.yaml');
export const GENERATED_PATH = join(REPO_ROOT, 'apps', 'recalls-worker', 'generated', 'articles.ts');

/** The module the committed file must equal. Throws when any article is invalid. */
export function expectedArticlesModule(): string {
  return serializeArticlesModule(loadArticles(ARTICLES_DIR, liveDatasetKeys(CANDIDATES_PATH)));
}

export async function run(check: boolean): Promise<number> {
  const expected = expectedArticlesModule();
  if (check) {
    const current = await readFile(GENERATED_PATH, 'utf8').catch(() => null);
    if (current !== expected) {
      process.stderr.write('Stale apps/recalls-worker/generated/articles.ts. Run `pnpm articles:generate` and commit the result.\n');
      return 1;
    }
    process.stdout.write('OK: generated articles module is up to date.\n');
    return 0;
  }
  await writeFile(GENERATED_PATH, expected, 'utf8');
  process.stdout.write('Wrote apps/recalls-worker/generated/articles.ts.\n');
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.includes('--check')).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
