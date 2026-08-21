import { describe, it, expect } from "vitest";
import {
  foodGroupOf,
  subgroupOf,
  deQualify,
  curate,
  loadOverrides,
  type CurationFood,
} from "../scripts/curate-taste-ingredients.js";

/**
 * Pure curation logic (no DB): the FNDDS food-code slicing, de-qualification, and the
 * (subgroup, base-name) clustering that collapses foods into base ingredients. The full 5k
 * pass + QA band runs only at real-seed time; here we prove the algorithm on a small slice.
 */

const overrides = loadOverrides();

describe("curation food-code keys", () => {
  it("derives the FNDDS major group and subgroup from the 8-digit food code", () => {
    expect(foodGroupOf(24100100)).toBe(2); // Meat/Protein
    expect(foodGroupOf(75100100)).toBe(7); // Vegetables
    expect(subgroupOf(24100100)).toBe("2410");
    expect(subgroupOf(75100100)).toBe("7510");
  });
});

describe("deQualify", () => {
  it("keeps the head noun and strips form/prep/percent qualifiers", () => {
    expect(deQualify("Chicken breast, grilled, skin not eaten", overrides.qualifiers)).toBe("chicken breast");
    expect(deQualify("Milk, whole, low fat (1%)", overrides.qualifiers)).toBe("milk");
    expect(deQualify("Okra, cooked, from frozen", overrides.qualifiers)).toBe("okra");
    // singularization of the head noun
    expect(deQualify("Carrots, raw", overrides.qualifiers)).toBe("carrot");
  });
});

describe("curate", () => {
  const foods: CurationFood[] = [
    { fdcId: 1, foodCode: 24100100, category: "Poultry", description: "Chicken breast, grilled, skin not eaten" },
    { fdcId: 2, foodCode: 24100200, category: "Poultry", description: "Chicken thigh, roasted" },
    { fdcId: 3, foodCode: 75100100, category: "Other vegetables", description: "Okra, cooked, from frozen" },
    { fdcId: 4, foodCode: 27500100, category: "Mixed dishes - grain-based", description: "Fried rice with chicken" },
    { fdcId: 5, foodCode: null, category: "Water", description: "Water, tap" },
  ];

  it("clusters by (subgroup, base name), merging chicken parts, excluding non-ingredients", () => {
    let n = 0;
    const { ingredients, stamps } = curate(foods, overrides, () => `id-${++n}`);

    // Chicken breast + thigh share a subgroup and both merge to "chicken" → one cluster (2 members).
    const chicken = ingredients.find((i) => i.label === "Chicken");
    expect(chicken).toBeDefined();
    expect(chicken!.fdcIds.sort()).toEqual([1, 2]);
    expect(chicken!.section).toBe("Meat & Seafood");
    expect(chicken!.foodGroup).toBe(2);

    // Okra is its own cluster in the Vegetables section.
    const okra = ingredients.find((i) => i.label === "Okra");
    expect(okra).toBeDefined();
    expect(okra!.section).toBe("Vegetables");

    // The mixed dish and the code-less water are excluded → never stamped.
    expect(ingredients).toHaveLength(2);
    expect(stamps.map((s) => s.fdcId).sort()).toEqual([1, 2, 3]);
    // Every stamp points at a real ingredient id.
    const ids = new Set(ingredients.map((i) => i.id));
    expect(stamps.every((s) => ids.has(s.baseIngredientId))).toBe(true);
  });
});
