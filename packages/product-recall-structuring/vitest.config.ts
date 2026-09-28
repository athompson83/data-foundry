import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'product-recall-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
