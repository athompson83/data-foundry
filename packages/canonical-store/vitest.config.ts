import { defineConfig } from 'vitest/config';

/**
 * Standalone runner for this package. The root `vitest.config.ts` composes the
 * workspace; this exists so `vitest run --root packages/canonical-store` uses
 * the same timeouts. PGlite boots a WASM Postgres and applies every migration
 * before the first assertion, which the 5s default does not survive on a cold
 * run.
 */
export default defineConfig({
  test: {
    name: 'canonical-store',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
