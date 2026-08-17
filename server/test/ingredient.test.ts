import { describe, it, expect } from "vitest";
import { parseIngredientLine } from "../src/parse/ingredient.js";

/** parseIngredientLine (C3) — ported from tests/unit/ingredient.test.ts. Offline. */
describe("parseIngredientLine (C3, minimal deterministic)", () => {
  it("separates a leading amount + known unit + name", () => {
    expect(parseIngredientLine("2 cups flour")).toEqual({ name: "flour", amount: "2", unit: "cup", quantityText: "2 cups flour" });
    expect(parseIngredientLine("1 lb chicken")).toEqual({ name: "chicken", amount: "1", unit: "pound", quantityText: "1 lb chicken" });
    expect(parseIngredientLine("1/2 teaspoon salt")).toEqual({ name: "salt", amount: "0.5", unit: "teaspoon", quantityText: "1/2 teaspoon salt" });
    expect(parseIngredientLine("1 1/2 cups sugar")).toEqual({ name: "sugar", amount: "1.5", unit: "cup", quantityText: "1 1/2 cups sugar" });
  });

  it("keeps a leading count with no unit (the descriptor rides in the name)", () => {
    expect(parseIngredientLine("3 large eggs")).toEqual({ name: "large eggs", amount: "3", unit: null, quantityText: "3 large eggs" });
  });

  it('drops a leading "of" after the unit', () => {
    expect(parseIngredientLine("2 cups of whole milk")).toEqual({ name: "whole milk", amount: "2", unit: "cup", quantityText: "2 cups of whole milk" });
  });

  it("collapses a leading numeric range to its lower bound (conservative, common in recipes)", () => {
    expect(parseIngredientLine("6-8 chicken wings")).toEqual({ name: "chicken wings", amount: "6", unit: null, quantityText: "6-8 chicken wings" });
    expect(parseIngredientLine("2-3 cups broth")).toEqual({ name: "broth", amount: "2", unit: "cup", quantityText: "2-3 cups broth" });
    expect(parseIngredientLine("1 to 2 tablespoons olive oil")).toEqual({ name: "olive oil", amount: "1", unit: "tablespoon", quantityText: "1 to 2 tablespoons olive oil" });
  });

  it('combines a "plus"/"+" secondary measure into the smaller unit and recovers the name', () => {
    // Unmeasured aside ("plus more…") — no second amount, so the leading measure stands.
    expect(parseIngredientLine("3 tablespoons melted salted butter, plus more for the pan")).toEqual({
      name: "melted salted butter", amount: "3", unit: "tablespoon",
      quantityText: "3 tablespoons melted salted butter, plus more for the pan",
    });
    // 1 tbsp + 1 tsp → 4 teaspoon (summed in the smaller unit), name after the plus.
    expect(parseIngredientLine("1 tablespoon, plus 1 teaspoon vanilla extract")).toEqual({
      name: "vanilla extract", amount: "4", unit: "teaspoon",
      quantityText: "1 tablespoon, plus 1 teaspoon vanilla extract",
    });
    // Same, no comma / abbreviated units.
    expect(parseIngredientLine("1 tbsp plus 1 tsp butter")).toEqual({
      name: "butter", amount: "4", unit: "teaspoon", quantityText: "1 tbsp plus 1 tsp butter",
    });
    // Cross-system (volume + mass) can't combine → the leading measure stands.
    expect(parseIngredientLine("1 cup flour, plus 50 grams")).toEqual({
      name: "flour", amount: "1", unit: "cup", quantityText: "1 cup flour, plus 50 grams",
    });
  });

  it("leaves genuinely ambiguous lines unparsed but always preserves the display line (safety guard)", () => {
    for (const raw of ["salt to taste", "a handful of basil"]) {
      const r = parseIngredientLine(raw);
      expect(r.amount).toBeNull();
      expect(r.unit).toBeNull();
      expect(r.quantityText).toBe(raw);
      expect(r.name.length).toBeGreaterThan(0);
    }
  });
});
