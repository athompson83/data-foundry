import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { projects } from './vitest.workspace.js';

const cloudflareWorkersShim = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  'tooling/test-support/cloudflare-workers.ts',
);

export default defineConfig({
  test: {
    projects: projects.map((root) => ({
      resolve: {
        alias: {
          'cloudflare:workers': cloudflareWorkersShim,
        },
      },
      test: {
        // The shared contract and its Worker intentionally live in sibling
        // `private-canary` directories. Keep both in the root gate rather
        // than silently excluding either because Vitest project names are
        // globally unique.
        name: root === 'apps/private-canary'
          ? 'private-canary-worker'
          : root.split('/').pop() ?? root,
        root,
        environment: 'node',
        // `test/` is the platform convention; doc 11 mandates `tests/` inside a
        // vertical folder, so both are collected rather than forking the runner.
        include: ['test/**/*.test.ts', 'tests/**/*.test.ts'],
        // PGlite boots a WASM Postgres; the default 5s is not enough on a cold run.
        testTimeout: 60_000,
        hookTimeout: 60_000,
      },
    })),
  },
});
