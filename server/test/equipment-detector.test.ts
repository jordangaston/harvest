import { describe, it, expect } from "vitest";
import { EquipmentMatcher } from "../src/equipment/equipment-matcher.js";
import { EquipmentDetector, type EquipmentAnalyzer, type EquipmentAnalysis } from "../src/equipment/equipment-detector.js";

/** WI-EQ-2 — the pure EquipmentMatcher (deterministic fallback) and the EquipmentDetector
 * (LLM-primary, vocab-constrained, degrades to the matcher). Offline; no network. */

function analyzer(fn: () => EquipmentAnalysis): EquipmentAnalyzer {
  return { analyze: async () => fn() };
}

describe("EquipmentMatcher (WI-EQ-2)", () => {
  const matcher = EquipmentMatcher.create();

  it("catches explicit mentions per step, folds spacing/case, no substring false-match", () => {
    const { stepEquipment, equipment } = matcher.detect([
      "Whisk the eggs",
      "Cook in the air fryer at 400",
      "Purée in the blender until smooth",
    ]);
    expect(stepEquipment[0]).toEqual([]);
    expect(stepEquipment[1]).toEqual(["air_fryer"]);
    expect(stepEquipment[2]).toEqual(["blender"]);
    expect(equipment).toEqual([
      { equipment: "air_fryer", essentiality: "recommended" },
      { equipment: "blender", essentiality: "recommended" },
    ]);
  });

  it("folds hyphens and casing; does not match inside a longer word", () => {
    expect(matcher.detect(["Use the AIR FRYER"]).stepEquipment[0]).toEqual(["air_fryer"]);
    expect(matcher.detect(["An air-fryer works"]).stepEquipment[0]).toEqual(["air_fryer"]);
    expect(matcher.detect(["airfryerless notes"]).stepEquipment[0]).toEqual([]);
  });

  it("applies the config essentiality prior in the roll-up; empty in → empty out", () => {
    expect(matcher.detect(["Cook sous vide at 55C"]).equipment).toEqual([
      { equipment: "sous_vide", essentiality: "required" },
    ]);
    const empty = matcher.detect([]);
    expect(empty.stepEquipment).toEqual([]);
    expect(empty.equipment).toEqual([]);
  });
});

describe("EquipmentDetector (WI-EQ-2)", () => {
  const matcher = EquipmentMatcher.create();

  it("keeps only vocab types from the LLM, aligns stepEquipment, complete=true", async () => {
    const detector = new EquipmentDetector(
      matcher,
      analyzer(() => ({
        equipment: [
          { type: "air_fryer", essentiality: "recommended" },
          { type: "toaster", essentiality: "required" },
        ],
        stepEquipment: [["air_fryer"], ["toaster"]],
      })),
    );
    const result = await detector.detect("Air Fryer Wings", ["chicken wings"], ["Season", "Air fry"]);
    expect(result.equipment).toEqual([{ equipment: "air_fryer", essentiality: "recommended" }]);
    expect(result.stepEquipment).toEqual([["air_fryer"], []]);
    expect(result.complete).toBe(true);
  });

  it("degrades to the matcher on LLM failure, complete=false", async () => {
    const detector = new EquipmentDetector(
      matcher,
      analyzer(() => {
        throw new Error("LLM down");
      }),
    );
    const result = await detector.detect("Wings", ["chicken"], ["Cook in the air fryer"]);
    expect(result.equipment).toEqual([{ equipment: "air_fryer", essentiality: "recommended" }]);
    expect(result.complete).toBe(false);
  });

  it("with no analyzer configured, runs the deterministic matcher, complete=false", async () => {
    const detector = new EquipmentDetector(matcher, null);
    const result = await detector.detect("Smoked brisket", ["brisket"], ["Smoke in the smoker for 8h"]);
    expect(result.equipment).toEqual([{ equipment: "smoker", essentiality: "required" }]);
    expect(result.complete).toBe(false);
  });
});
