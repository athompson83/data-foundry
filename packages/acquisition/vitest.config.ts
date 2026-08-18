import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Package-local runner.
 *
 * The repo-root `vitest.config.ts` builds its project list from
 * `vitest.workspace.ts`; adding `'packages/acquisition'` there is the one-line
 * change that folds this package into the monorepo run. This config exists so
 * the package is runnable on its own in the meantime, and so
 * `pnpm --filter @data-foundry/acquisition test` never depends on root state.
 */
export default defineConfig({
  test: {
    name: 'acquisition',
    root: dirname(fileURLToPath(import.meta.url)),
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
