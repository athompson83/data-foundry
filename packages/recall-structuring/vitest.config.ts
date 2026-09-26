import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'recall-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
