import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    hookTimeout: 30000,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest_dbos',
    },
  },
});
