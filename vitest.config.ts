import { defineConfig } from 'vitest/config';
import { projects } from './vitest.workspace.js';

export default defineConfig({
  test: {
    projects: projects.map((root) => ({
      test: {
        name: root.split('/').pop() ?? root,
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
