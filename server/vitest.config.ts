import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          setupFiles: ['tests/helpers/unit-setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          // Share one module graph across specs: bootstrap.ts registers a
          // process-global DBOS data source at load, so a per-file reload would
          // re-register the same name and throw. getHarness() is likewise a
          // cross-spec singleton (one DBOS runtime + pool).
          isolate: false,
          globalSetup: ['tests/helpers/global-setup.ts'],
          hookTimeout: 60000,
          testTimeout: 60000,
        },
      },
    ],
  },
});
