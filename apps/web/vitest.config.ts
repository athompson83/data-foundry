import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The composition suite boots PGlite and applies the real migrations: pages
    // render against the real query layer, never a stub of it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
