import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import type { RecipeCategories } from "../src/models/recipe.js";
import { auditFacetCoverage } from "../src/categorize/audit-facet-coverage.js";
import { backfillFacets } from "../src/categorize/backfill-facets.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/** Phase 0.2 — facet coverage audit + backfill, against a migrated file db (offline, no LLM). */

const BASE: RecipeInput = {
  title: "Test Dish",
  sourceType: "website",
  servings: 4,
  servingsEstimated: false,
  ingredients: [{ name: "water", amount: null, unit: null, quantityText: "water" }],
  steps: ["Cook"],
  nutrition: null,
  allergens: null,
};

const cats = (o: Partial<RecipeCategories>): RecipeCategories => ({
  cuisine: [], mealType: [], course: [], dishType: [], primaryIngredient: [], foodCategory: [], ...o,
});

/** A categorizer stub that yields the same facets for every recipe (no LLM, no network). */
function stubCategorizer(categories: RecipeCategories) {
  return { analyze: async () => ({ categories, stepTechniques: [], mealPrepFit: null }) };
}

let db: Database;
let cleanup: () => void;
let repo: RecipeRepository;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  repo = RecipeRepository.create(db);
});
afterEach(() => cleanup());

async function seedCorpus(): Promise<{ full: string; cuisineOnly: string; empty: string }> {
  const full = await repo.persist({ ...BASE, categories: cats({ cuisine: ["italian"], dishType: ["pasta"] }) }, null);
  const cuisineOnly = await repo.persist({ ...BASE, categories: cats({ cuisine: ["french"] }) }, null);
  const empty = await repo.persist(BASE, null);
  return { full, cuisineOnly, empty };
}

describe("auditFacetCoverage", () => {
  it("counts cuisine / dish_type / both and lists the gaps", async () => {
    const { cuisineOnly, empty } = await seedCorpus();

    const c = await auditFacetCoverage(db);

    expect(c.total).toBe(3);
    expect(c.withCuisine).toBe(2); // full + cuisineOnly
    expect(c.withDishType).toBe(1); // full
    expect(c.withBoth).toBe(1); // full — the Tier 1 ceiling
    expect(c.gapCuisine).toEqual([empty]);
    expect(c.gapDishType.sort()).toEqual([cuisineOnly, empty].sort());
  });
});

describe("backfillFacets", () => {
  it("fills only the missing facets and never overwrites an existing one", async () => {
    const { full, cuisineOnly, empty } = await seedCorpus();
    // The stub would classify everything thai/soup — but cuisineOnly already has a cuisine.
    const r = await backfillFacets(db, stubCategorizer(cats({ cuisine: ["thai"], dishType: ["soup"] })));

    expect(r.scanned).toBe(2); // the two gap recipes; `full` is untouched
    expect(r.filled).toBe(2);
    expect(r.rowsWritten).toBe(3); // cuisineOnly:+dish_type(1), empty:+cuisine+dish_type(2)
    expect(r.residual).toEqual([]);

    // cuisineOnly keeps its French cuisine (not overwritten with thai) and gains the dish form.
    expect((await repo.findById(cuisineOnly))!.categories.cuisine).toEqual(["french"]);
    expect((await repo.findById(cuisineOnly))!.categories.dishType).toEqual(["soup"]);
    // empty is filled from scratch.
    const filledEmpty = (await repo.findById(empty))!.categories;
    expect(filledEmpty.cuisine).toEqual(["thai"]);
    expect(filledEmpty.dishType).toEqual(["soup"]);
    // The already-complete recipe is never scanned, so it is untouched.
    const untouched = (await repo.findById(full))!.categories;
    expect(untouched.cuisine).toEqual(["italian"]);
    expect(untouched.dishType).toEqual(["pasta"]);
  });

  it("is idempotent — a second run has no gaps left to fill", async () => {
    await seedCorpus();
    await backfillFacets(db, stubCategorizer(cats({ cuisine: ["thai"], dishType: ["soup"] })));

    const again = await backfillFacets(db, stubCategorizer(cats({ cuisine: ["thai"], dishType: ["soup"] })));

    expect(again.scanned).toBe(0);
    expect(again.rowsWritten).toBe(0);
  });

  it("records residual recipes the classifier still can't categorize", async () => {
    const { cuisineOnly, empty } = await seedCorpus();
    // A classifier that returns nothing — the LLM-off / unclassifiable case.
    const r = await backfillFacets(db, stubCategorizer(cats({})));

    expect(r.rowsWritten).toBe(0);
    expect(r.residual.sort()).toEqual([cuisineOnly, empty].sort());
  });
});
