import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Every suite boots PGlite and applies the real migrations: the API is
    // tested against the real query layer, never a stub of it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
