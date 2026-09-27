import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'obligation-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
