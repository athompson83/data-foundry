import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'private-canary-worker',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
