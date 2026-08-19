import { describe, it, expect } from "vitest";
import { VOCAB, inVocab } from "../src/categorize/vocab.js";
import { toPrimaryIngredient } from "../src/categorize/fdc-category-map.js";
import { RuleTagger } from "../src/categorize/rule-tagger.js";
import { StubRecipeAnalyzer, type RecipeAnalyzer, type TasteFacets } from "../src/categorize/taste-classifier.js";
import { RecipeCategorizer } from "../src/categorize/recipe-categorizer.js";
import type { FoodMatch, IngredientMatcher } from "../src/nutrition/food-matcher.js";
import type { MealPrepFit } from "../src/schema.js";

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

/** A stub analyzer that yields the given taste facets (no step techniques). The optional
 * `mealPrepFit` seeds the LLM band; omitted → null (the categorizer falls to its heuristic). */
function analyzerOf(
  facets: TasteFacets | (() => Promise<TasteFacets>),
  mealPrepFit: MealPrepFit | null = null,
): RecipeAnalyzer {
  const resolve = typeof facets === "function" ? facets : async () => facets;
  return { analyze: async () => ({ ...(await resolve()), stepTechniques: [], mealPrepFit }) };
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
      analyzerOf({ cuisine: ["italian"], mealType: ["dinner"], dishType: ["pasta"] }),
    );
    const { categories } = await cat.analyze(
      "Shrimp Scampi",
      [{ name: "shrimp" }, { name: "spaghetti" }, { name: "garlic" }, { name: "chicken broth" }],
      [],
    );
    expect(categories).toEqual({
      cuisine: ["italian"], mealType: ["dinner"], dishType: ["pasta"], primaryIngredient: ["seafood"],
    });
  });

  it("uses the FDC seed for primary_ingredient when the title has no protein keyword", async () => {
    const matcher = matcherOf({ salmon: { fdcId: 3, category: "Fish", quality: "high" } });
    const cat = new RecipeCategorizer(matcher, new RuleTagger(), analyzerOf({ cuisine: [], mealType: [], dishType: [] }));
    const { categories } = await cat.analyze(
      "Weeknight Sheet Pan Dinner",
      [{ name: "salmon" }, { name: "broccoli" }, { name: "olive oil" }],
      [],
    );
    expect(categories.primaryIngredient).toEqual(["seafood"]);
  });

  it("constrains classifier output to VOCAB for every facet", async () => {
    const cat = new RecipeCategorizer(
      matcherOf({}),
      new RuleTagger(),
      analyzerOf({ cuisine: ["italian", "klingon"], mealType: ["brunch", "teatime"], dishType: ["pasta", "warp"] }),
    );
    const { categories } = await cat.analyze("Mystery Dish", [{ name: "water" }], []);
    expect(categories.cuisine).toEqual(["italian"]); // non-VOCAB "klingon" dropped
    expect(categories.mealType).toEqual(["brunch"]); // non-VOCAB "teatime" dropped
    expect(categories.dishType).toEqual(["pasta"]); // non-VOCAB "warp" dropped
  });

  it("returns all-empty and never throws when nothing matches (no network via stub)", async () => {
    const cat = new RecipeCategorizer(matcherOf({}), new RuleTagger(), new StubRecipeAnalyzer());
    const { categories } = await cat.analyze("Mystery", [{ name: "water" }], []);
    expect(categories).toEqual({ cuisine: [], mealType: [], dishType: [], primaryIngredient: [] });
  });

  it("degrades to empty taste facets if the classifier throws (primary survives)", async () => {
    const boom = analyzerOf(async () => {
      throw new Error("LLM down");
    });
    const cat = new RecipeCategorizer(SCAMPI_MATCHER, new RuleTagger(), boom);
    const { categories } = await cat.analyze("Shrimp Pasta", [{ name: "shrimp" }, { name: "spaghetti" }], []);
    expect(categories.cuisine).toEqual([]);
    expect(categories.mealType).toEqual([]);
    expect(categories.dishType).toEqual([]);
    expect(categories.primaryIngredient).toEqual(["seafood"]);
  });
});

describe("RecipeCategorizer.analyze — meal-prep fit (signal #10)", () => {
  const rules = new RuleTagger();

  it("takes the LLM band when present, over the heuristic", async () => {
    // Non-keeps-well dish + low servings would heuristic to `unsuitable`; the LLM `designed` wins.
    const cat = new RecipeCategorizer(matcherOf({}), rules, analyzerOf({ cuisine: [], mealType: [], dishType: ["salad"] }, "designed"));
    const { mealPrepFit } = await cat.analyze("Batch Meal-Prep Salad Jars", [{ name: "water" }], [], 2);
    expect(mealPrepFit).toBe("designed");
  });

  it("falls back to `suitable` for a keeps-well dish at batch scale", async () => {
    const cat = new RecipeCategorizer(matcherOf({}), rules, analyzerOf({ cuisine: [], mealType: [], dishType: ["stew"] }));
    const { mealPrepFit } = await cat.analyze("Beef Stew", [{ name: "beef" }], [], 8);
    expect(mealPrepFit).toBe("suitable");
  });

  it("falls back to `unsuitable`, never `designed`, without batch cues", async () => {
    const cat = new RecipeCategorizer(matcherOf({}), rules, new StubRecipeAnalyzer());
    // keeps-well dish but low servings → not batch-scale.
    expect((await cat.analyze("Small Soup", [{ name: "water" }], [], 2)).mealPrepFit).toBe("unsuitable");
    // batch servings but a non-keeps-well dish (empty from the stub) → unsuitable.
    expect((await cat.analyze("Fried Thing", [{ name: "oil" }], [], 8)).mealPrepFit).toBe("unsuitable");
    // no servings info → unsuitable (the C4 default-4 must not read as batch intent).
    expect((await cat.analyze("Mystery", [{ name: "water" }], [])).mealPrepFit).toBe("unsuitable");
  });
});
