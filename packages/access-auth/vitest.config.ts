import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'access-auth',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
