import { describe, it, expect } from "vitest";
import { tuneActionFor } from "../src/ranking/tune-mapping.js";

/** WI-RANK-4: the pure reason→tuning-action map. */
describe("tuneActionFor", () => {
  it("maps each reason to its action", () => {
    // The cost/time/difficulty/nutrition reasons bumped the retired weight vector; with no
    // recipe-scope directive dimension for them yet (WI-3), they record only.
    expect(tuneActionFor("too_expensive")).toEqual({ kind: "none" });
    expect(tuneActionFor("too_hard")).toEqual({ kind: "none" });
    expect(tuneActionFor("too_slow")).toEqual({ kind: "none" });
    expect(tuneActionFor("not_nutritious")).toEqual({ kind: "none" });
    expect(tuneActionFor("disliked_ingredient")).toEqual({ kind: "dislike" });
    expect(tuneActionFor("other")).toEqual({ kind: "none" });
  });
});
