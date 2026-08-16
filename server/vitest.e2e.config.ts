import { defineConfig } from "vitest/config";

// Real e2e tier (npm run test:e2e). Drives the migrated stack over HTTP under a
// live `vercel dev` (booted once by the global setup) against the real providers
// (Groq, Apify, InnerTube, Pinterest, ffmpeg). Hits the network, costs money, and
// is slow — separate from the fast `test/**` suite.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    globals: false,
    globalSetup: ["tests/e2e/helpers/global-setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
