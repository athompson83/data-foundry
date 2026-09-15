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
    name: 'web',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The composition suite boots PGlite and applies the real migrations: pages
    // render against the real query layer, never a stub of it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
