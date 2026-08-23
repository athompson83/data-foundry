import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'usage-events',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
