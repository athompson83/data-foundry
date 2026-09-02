import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'usage-consumer',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Persistence tests boot PGlite and apply the real migrations: the
    // consumer is tested against the real `api_usage_events` table, never a
    // stub of it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
