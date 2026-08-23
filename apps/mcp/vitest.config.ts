import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mcp',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The dispatcher is tested against a real PGlite database with the real
    // migrations applied, exactly like the query layer it reads through.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
