import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'eligibility-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
