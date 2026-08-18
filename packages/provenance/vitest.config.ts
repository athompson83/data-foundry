import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'provenance',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM Postgres and applies every migration first.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
