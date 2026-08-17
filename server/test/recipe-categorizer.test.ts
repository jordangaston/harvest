import { describe, it, expect } from "vitest";
import { VOCAB, inVocab } from "../src/categorize/vocab.js";
import { toPrimaryIngredient } from "../src/categorize/fdc-category-map.js";
import { RuleTagger } from "../src/categorize/rule-tagger.js";
import { StubTasteClassifier, type TasteClassifier, type TasteFacets } from "../src/categorize/taste-classifier.js";
import { RecipeCategorizer } from "../src/categorize/recipe-categorizer.js";
import type { FoodMatch, IngredientMatcher } from "../src/nutrition/food-matcher.js";

/** WI-TS-2: the categorizer. Pure units + the dominance merge with injected stubs. */

// A stub FDC matcher keyed on ingredient name → canned FoodMatch.
function matcherOf(map: Record<string, FoodMatch>): IngredientMatcher {
  return {
    async match(name) {
      const key = Object.keys(map).find((k) => name.toLowerCase().includes(k));
      return key ? map[key] : null;
    },
  };
}

const SCAMPI_MATCHER = matcherOf({
  shrimp: { fdcId: 1, category: "Fish", quality: "high" },
  "chicken broth": { fdcId: 2, category: "Soups, Sauces and Gravies", quality: "medium" },
});

function classifierOf(facets: TasteFacets | (() => Promise<TasteFacets>)): TasteClassifier {
  return { classify: typeof facets === "function" ? facets : async () => facets };
}

describe("VOCAB", () => {
  it("exposes three facet lists and validates membership", () => {
    expect(VOCAB.cuisine).toContain("italian");
    expect(VOCAB.primaryIngredient).toContain("seafood");
    expect(inVocab("cuisine", "italian")).toBe(true);
    expect(inVocab("cuisine", "klingon")).toBe(false);
    expect(inVocab("primaryIngredient", "seafood")).toBe(true);
  });
});

describe("FdcCategoryMap.toPrimaryIngredient", () => {
  it("maps ingredient food groups and nulls non-ingredient groups", () => {
    expect(toPrimaryIngredient("Fish")).toBe("seafood");
    expect(toPrimaryIngredient("Poultry")).toBe("poultry");
    expect(toPrimaryIngredient("Beef")).toBe("beef");
    expect(toPrimaryIngredient("Cheese")).toBe("cheese");
    expect(toPrimaryIngredient("Eggs")).toBe("egg");
    expect(toPrimaryIngredient("Grains")).toBe("grain");
    expect(toPrimaryIngredient("Vegetables, dark green")).toBe("vegetable");
    // Non-ingredient groups → null (the guard that stops chicken-broth tagging poultry).
    expect(toPrimaryIngredient("Soups, Sauces and Gravies")).toBeNull();
    expect(toPrimaryIngredient("Fats and oils")).toBeNull();
    expect(toPrimaryIngredient("Milk")).toBeNull();
    expect(toPrimaryIngredient(null)).toBeNull();
  });

  it("only ever emits VOCAB primary-ingredient values", () => {
    for (const g of ["Fish", "Poultry", "Beef", "Cheese", "Eggs", "Grains", "Vegetables, other"]) {
      const v = toPrimaryIngredient(g);
      expect(v && inVocab("primaryIngredient", v)).toBe(true);
    }
  });
});

describe("RuleTagger.tag", () => {
  it("tags primary_ingredient with title vs body location", () => {
    const hits = new RuleTagger().tag("Shrimp Scampi", ["shrimp", "spaghetti", "garlic", "chicken broth"]);
    expect(hits.primaryIngredient).toContainEqual({ value: "seafood", location: "title" });
    expect(hits.primaryIngredient).toContainEqual({ value: "poultry", location: "body" });
  });
});

describe("RecipeCategorizer.categorize — LLM taste + FDC primary dominance", () => {
  it("takes cuisine/meal_type/dish_type from the classifier and primary from FDC + title", async () => {
    const cat = new RecipeCategorizer(
      SCAMPI_MATCHER,
      new RuleTagger(),
      classifierOf({ cuisine: ["italian"], mealType: ["dinner"], dishType: ["pasta"] }),
    );
    const result = await cat.categorize("Shrimp Scampi", [
      { name: "shrimp" },
      { name: "spaghetti" },
      { name: "garlic" },
      { name: "chicken broth" },
    ]);
    expect(result).toEqual({
      cuisine: ["italian"], mealType: ["dinner"], dishType: ["pasta"], primaryIngredient: ["seafood"],
    });
  });

  it("uses the FDC seed for primary_ingredient when the title has no protein keyword", async () => {
    const matcher = matcherOf({ salmon: { fdcId: 3, category: "Fish", quality: "high" } });
    const cat = new RecipeCategorizer(matcher, new RuleTagger(), classifierOf({ cuisine: [], mealType: [], dishType: [] }));
    const result = await cat.categorize("Weeknight Sheet Pan Dinner", [
      { name: "salmon" },
      { name: "broccoli" },
      { name: "olive oil" },
    ]);
    expect(result.primaryIngredient).toEqual(["seafood"]);
  });

  it("constrains classifier output to VOCAB for every facet", async () => {
    const cat = new RecipeCategorizer(
      matcherOf({}),
      new RuleTagger(),
      classifierOf({ cuisine: ["italian", "klingon"], mealType: ["brunch", "teatime"], dishType: ["pasta", "warp"] }),
    );
    const result = await cat.categorize("Mystery Dish", [{ name: "water" }]);
    expect(result.cuisine).toEqual(["italian"]); // non-VOCAB "klingon" dropped
    expect(result.mealType).toEqual(["brunch"]); // non-VOCAB "teatime" dropped
    expect(result.dishType).toEqual(["pasta"]); // non-VOCAB "warp" dropped
  });

  it("returns all-empty and never throws when nothing matches (no network via stub)", async () => {
    const cat = new RecipeCategorizer(matcherOf({}), new RuleTagger(), new StubTasteClassifier());
    const result = await cat.categorize("Mystery", [{ name: "water" }]);
    expect(result).toEqual({ cuisine: [], mealType: [], dishType: [], primaryIngredient: [] });
  });

  it("degrades to empty taste facets if the classifier throws (primary survives)", async () => {
    const boom = classifierOf(async () => {
      throw new Error("LLM down");
    });
    const cat = new RecipeCategorizer(SCAMPI_MATCHER, new RuleTagger(), boom);
    const result = await cat.categorize("Shrimp Pasta", [{ name: "shrimp" }, { name: "spaghetti" }]);
    expect(result.cuisine).toEqual([]);
    expect(result.mealType).toEqual([]);
    expect(result.dishType).toEqual([]);
    expect(result.primaryIngredient).toEqual(["seafood"]);
  });
});
