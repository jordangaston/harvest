import { describe, it, expect } from "vitest";
import { tuneActionFor } from "../src/ranking/tune-mapping.js";

/** WI-RANK-4: the pure reason→tuning-action map. */
describe("tuneActionFor", () => {
  it("maps each reason to its action", () => {
    expect(tuneActionFor("too_expensive")).toEqual({ kind: "weight", signal: "cost" });
    expect(tuneActionFor("too_hard")).toEqual({ kind: "weight", signal: "difficulty" });
    expect(tuneActionFor("too_slow")).toEqual({ kind: "weight", signal: "time" });
    expect(tuneActionFor("not_nutritious")).toEqual({ kind: "weight", signal: "nutrition" });
    expect(tuneActionFor("disliked_ingredient")).toEqual({ kind: "dislike" });
    expect(tuneActionFor("other")).toEqual({ kind: "none" });
  });
});
