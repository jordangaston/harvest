import { describe, it, expect } from "vitest";
import { WebsiteFetcher } from "../src/parse/website.js";

// Ported from main's tests/unit/website-fetch.test.ts + website-nutrition.test.ts —
// subject moved from src/fetch/website.ts to src/parse/website.ts; the pure
// static `parse(html, url)` API and assertions are unchanged.

// A minimal but realistic recipe page: JSON-LD in a @graph, HowToStep instructions,
// an entity in the title, an array recipeYield, and ISO durations.
const FIXTURE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "name": "Blog" },
    {
      "@type": "Recipe",
      "name": "Honey Sesame Chicken &amp; Rice",
      "recipeIngredient": ["1 lb chicken", "2 tbsp honey", "&frac12; cup rice"],
      "recipeInstructions": [
        { "@type": "HowToStep", "text": "Sear the chicken." },
        { "@type": "HowToStep", "text": "Add the honey glaze." }
      ],
      "recipeYield": ["4 servings"],
      "prepTime": "PT10M",
      "cookTime": "PT20M",
      "totalTime": "PT1H30M",
      "image": ["https://example.com/dish.jpg"],
      "aggregateRating": { "ratingValue": "4.8", "ratingCount": "212" }
    }
  ]
}
</script>
</head><body></body></html>`;

/** Build a page with one schema.org Recipe JSON-LD block. */
function pageWith(recipe: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", ...recipe })}</script></head></html>`;
}

describe("WebsiteFetcher.parse", () => {
  it("extracts a recipe from JSON-LD (@graph, HowToStep, entities, ISO durations)", () => {
    const recipe = WebsiteFetcher.parse(FIXTURE_HTML, "https://example.com/r");

    expect(recipe.title).toBe("Honey Sesame Chicken & Rice");
    expect(recipe.ingredients).toEqual(["1 lb chicken", "2 tbsp honey", "½ cup rice"]);
    expect(recipe.steps).toEqual(["Sear the chicken.", "Add the honey glaze."]);
    expect(recipe.servings).toBe("4 servings");
    expect(recipe.totalMinutes).toBe(90); // PT1H30M
    expect(recipe.prepMinutes).toBe(10);
    expect(recipe.cookMinutes).toBe(20);
    expect(recipe.imageUrl).toBe("https://example.com/dish.jpg");
    expect(recipe.rating).toEqual({ value: "4.8", count: "212" });
  });

  it("explodes a single collapsed numbered HowToStep into discrete ordered steps", () => {
    // WP Recipe Maker themes emit the whole method as ONE HowToStep whose text is
    // "1. … 2. … 3. …". Numbers inside a step ("375° F", "2 tablespoons") must NOT
    // trigger a split — only the "N. " list markers do.
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Croissant French Toast",
      "recipeIngredient":["4 croissants"],
      "recipeInstructions":[{"@type":"HowToStep","text":"1. Preheat the oven to 375° F. 2. Whisk 2 tablespoons of the eggs and milk. 3. Bake for 20-25 minutes until golden.4. Serve warm."}]}</script>`;
    const recipe = WebsiteFetcher.parse(html);
    expect(recipe.steps).toEqual([
      "Preheat the oven to 375° F.",
      "Whisk 2 tablespoons of the eggs and milk.",
      "Bake for 20-25 minutes until golden.",
      "Serve warm.",
    ]);
  });

  it("throws distinctly when no Recipe node is present", () => {
    expect(() => WebsiteFetcher.parse("<html><body>No recipe here</body></html>", "https://example.com/x")).toThrow(
      /No schema.org Recipe/,
    );
  });
});

describe("WebsiteFetcher.parse — schema.org NutritionInformation (C5 parsed path)", () => {
  it("maps NutritionInformation to the label core, stripping units", () => {
    const html = pageWith({
      name: "Test",
      recipeIngredient: ["1 cup flour"],
      recipeInstructions: ["Bake"],
      nutrition: {
        "@type": "NutritionInformation",
        calories: "250 calories",
        fatContent: "9 g",
        saturatedFatContent: "3 g",
        carbohydrateContent: "30 g",
        fiberContent: "2 g",
        sugarContent: "5 g",
        proteinContent: "8 g",
        sodiumContent: "150 mg",
      },
    });

    const recipe = WebsiteFetcher.parse(html);
    expect(recipe.nutrition).toEqual({
      calories: "250",
      grams_of_fat: "9",
      grams_of_saturated_fat: "3",
      grams_of_carbohydrate: "30",
      grams_of_fiber: "2",
      grams_of_sugar: "5",
      grams_of_protein: "8",
      milligrams_of_sodium: "150",
    });
  });

  it("omits nutrition when the block is absent", () => {
    const recipe = WebsiteFetcher.parse(pageWith({ name: "Test", recipeIngredient: ["1 cup flour"], recipeInstructions: ["Bake"] }));
    expect(recipe.nutrition).toBeUndefined();
  });
});
