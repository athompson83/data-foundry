import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'private-canary',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
