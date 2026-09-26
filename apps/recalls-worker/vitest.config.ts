import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'recalls-worker',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
