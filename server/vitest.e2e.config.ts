import { defineConfig } from 'vitest/config';

// End-to-end config: runs ONLY tests/e2e, against the REAL providers (Apify
// scraping, Groq ASR/vision/extraction, ffmpeg). NODE_ENV is 'development' — not
// 'test' — so the pipeline selects the live fetchers/extractors instead of the
// offline stubs, and env.ts loads APIFY_TOKEN/GROQ_API_KEY from `.env`. Point
// DATABASE_URL at the local test DBs (migrated + reset by global-setup); the
// preset value wins because loadEnvFile never overwrites an already-set var.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    include: ['tests/e2e/**/*.test.ts'],
    // Real scraping + LLM per import is slow, and the vision model's ~8k TPM cap
    // paces a multi-slide carousel to several minutes; give each case room.
    hookTimeout: 120000,
    testTimeout: 600000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/harvest_dbos',
    },
  },
});
