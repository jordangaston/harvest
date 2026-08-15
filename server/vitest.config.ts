import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    // e2e hits real Apify/Groq and costs money — it runs only via `npm run test:e2e`.
    // spike-cf is the throwaway Cloudflare-serverless prototype — it has its own
    // vitest config and runs via `cd spike-cf && npm test`, never the server suite.
    exclude: [...configDefaults.exclude, 'tests/e2e/**', 'spike-cf/**'],
    hookTimeout: 30000,
    // Integration suites share one local Postgres; run test files serially so
    // their per-test cleanups don't race.
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest_dbos',
    },
  },
});
