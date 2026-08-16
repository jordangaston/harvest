import { describe, it, expect, afterEach, vi } from "vitest";
import { StubApifyFetcher, HikerFetcher, selectSourceFetcher } from "../src/fetch/apify-fetcher.js";

/**
 * Ported from server/tests/unit/apify-fetcher.test.ts (main). The migrated
 * `selectSourceFetcher` reads `process.env` lazily, so `vi.stubEnv` alone flips
 * the selection — no `resetModules` dance. Assertions are intact: no keys → the
 * offline stub; HIKER_API_KEY → the HikerAPI Instagram path.
 */
describe("selectSourceFetcher", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the stub when no fetch keys are set (test env)", () => {
    expect(selectSourceFetcher()).toBeInstanceOf(StubApifyFetcher);
  });

  it("uses HikerFetcher for Instagram when HIKER_API_KEY is set", () => {
    vi.stubEnv("HIKER_API_KEY", "hk_test");
    expect(selectSourceFetcher()).toBeInstanceOf(HikerFetcher);
  });
});
