import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'billing',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
