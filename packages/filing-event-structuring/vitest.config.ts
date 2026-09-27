import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'filing-event-structuring',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
