import { defineConfig } from 'vitest/config';

// Isolated from server/vitest.config.ts — the spike's unit tests are pure and
// offline (no Postgres global-setup, no network).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
