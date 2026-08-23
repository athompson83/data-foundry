import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api-keys',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
