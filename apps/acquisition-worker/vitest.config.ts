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
    name: 'acquisition-worker',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
