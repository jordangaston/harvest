import { describe, it, expect, afterEach, vi } from "vitest";
import { selectTikTokFetcher, LamatokFetcher } from "../src/fetch/lamatok-fetcher.js";

/**
 * Ported from server/tests/unit/lamatok-fetcher.test.ts (main). The migrated
 * `selectTikTokFetcher` reads `process.env.LAMATOK_API_KEY` lazily (not the eager
 * `env` module), so `vi.stubEnv` alone flips the selection — no `resetModules`
 * dance around a module-load-time read. Assertions are intact.
 */
describe("selectTikTokFetcher", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to caption-only oEmbed when LAMATOK_API_KEY is unset (test env)", () => {
    expect(selectTikTokFetcher()).not.toBeInstanceOf(LamatokFetcher);
  });

  it("uses LamatokFetcher when LAMATOK_API_KEY is set", () => {
    vi.stubEnv("LAMATOK_API_KEY", "lt_test");
    expect(selectTikTokFetcher()).toBeInstanceOf(LamatokFetcher);
  });
});
