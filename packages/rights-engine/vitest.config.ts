import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'rights-engine',
    environment: 'node',
    include: ['test/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
