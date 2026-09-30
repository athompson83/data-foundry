import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'equipment-model-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
