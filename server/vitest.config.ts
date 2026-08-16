import { defineConfig } from 'vitest/config';

// Fast offline tier: tests run against a `file:` libSQL database migrated from the
// generated DDL. No network, no account, no global-setup.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
