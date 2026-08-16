import { describe, it, expect } from "vitest";
import { toPublicJob, type ImportJob } from "../src/models/import-job.js";

// Ported from main's tests/unit/import-job.test.ts — subject unchanged
// (src/models/import-job.ts). Extended with the migrated `recipe_ids` set a
// slideshow import produces.

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    status: "queued",
    progress: 0,
    sourceType: "tiktok",
    sourceRef: "https://tiktok.com/@x/video/1",
    recipeId: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("toPublicJob", () => {
  it("exposes only id/status/progress/source_type, omitting null error_code/recipe_id", () => {
    expect(toPublicJob(makeJob())).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      status: "queued",
      progress: 0,
      source_type: "tiktok",
    });
  });

  it("includes error_code and recipe_id when set, and never leaks user_id/source_ref", () => {
    const result = toPublicJob(
      makeJob({ status: "failed", progress: 100, errorCode: "NO_RECIPE", recipeId: "33333333-3333-3333-3333-333333333333" }),
    );
    expect(result).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      status: "failed",
      progress: 100,
      source_type: "tiktok",
      error_code: "NO_RECIPE",
      recipe_id: "33333333-3333-3333-3333-333333333333",
    });
    expect(JSON.stringify(result)).not.toMatch(/user_id|userId|source_ref|sourceRef/);
  });

  it("surfaces every recipe of a slideshow import in recipe_ids, omitting it when empty", () => {
    const ids = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    const ready = makeJob({ status: "ready", progress: 100, recipeId: ids[0] });
    expect(toPublicJob(ready, ids).recipe_ids).toEqual(ids);
    expect(toPublicJob(ready, []).recipe_ids).toBeUndefined();
  });
});
