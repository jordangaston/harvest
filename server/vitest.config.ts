import { defineConfig } from 'vitest/config';

// Fast offline tier: tests run against a `file:` libSQL database migrated from the
// generated DDL. No network, no account, no global-setup.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    // Forks: libsql's native client leaks ~2 fds per transaction connection even through
    // close(), and the DB-heavy files burn >32k fds in one process — so `npm test` raises
    // the soft limit to ~1M (see package.json) and forks keep each file's tab separate.
    // A lower ceiling fails as ConnectionFailed(:14) at whatever file crosses it.
    pool: 'forks',
  },
});
