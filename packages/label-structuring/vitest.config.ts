import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'label-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
