import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': resolve(
        fileURLToPath(new URL('.', import.meta.url)),
        '../../tooling/test-support/cloudflare-workers.ts',
      ),
    },
  },
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
