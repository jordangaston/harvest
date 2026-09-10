import type { Database } from '../db.js';
import type { RecipeCategories } from '../models/recipe.js';
import { recipeCategories } from '../schema.js';
import { RecipeCategorizer } from './recipe-categorizer.js';
import { RecipeRepository, FACET_BY_KEY } from '../repositories/recipe-repository.js';
import { auditFacetCoverage } from './audit-facet-coverage.js';

/** Anything that can classify a recipe — the real `RecipeCategorizer`, or a stub in tests. */
type Categorizer = Pick<RecipeCategorizer, 'analyze'>;

export interface FacetBackfillResult {
  /** Gap recipes examined (missing cuisine and/or dish_type). */
  scanned: number;
  /** Recipes that gained ≥1 new facet row. */
  filled: number;
  rowsWritten: number;
  /** Recipe ids still missing cuisine or dish_type after the run (the analyzer couldn't classify). */
  residual: string[];
}

/**
 * Re-runs the categorizer over recipes missing `cuisine` or `dish_type` and writes back only the
 * facets that are still empty — never overwriting an existing good row. Idempotent: a re-run only
 * refills what stayed empty. Sequential to respect LLM rate limits.
 *
 * `ponytail: sequential — the slowest-but-safest rung for a one-shot founder run. Add small-batch
 * concurrency here only if the corpus grows large enough that wall-clock matters.`
 *
 * @param db - the target database.
 * @param categorizer - the classifier (defaults to the live `RecipeCategorizer`; inject a stub in tests).
 * @returns counts scanned/filled/rowsWritten and the residual (still-uncategorized) recipe ids.
 */
export async function backfillFacets(
  db: Database,
  categorizer: Categorizer = RecipeCategorizer.create(db),
): Promise<FacetBackfillResult> {
  const { gapCuisine, gapDishType } = await auditFacetCoverage(db);
  const gapIds = [...new Set([...gapCuisine, ...gapDishType])];
  const repo = RecipeRepository.create(db);
  const KEYS = Object.keys(FACET_BY_KEY) as (keyof RecipeCategories)[];

  let filled = 0;
  let rowsWritten = 0;
  const residual: string[] = [];

  for (const id of gapIds) {
    const detail = await repo.findById(id);
    if (!detail) continue;
    const existing = detail.categories;
    const { categories: produced } = await categorizer.analyze(
      detail.recipe.title,
      detail.ingredients.map((i) => ({ name: i.name })),
      detail.steps,
      detail.recipe.servings,
    );

    // Insert only facets the recipe has none of — leaves existing rows untouched.
    const values = KEYS.filter((k) => existing[k].length === 0 && produced[k].length > 0).flatMap((k) =>
      produced[k].map((value) => ({ recipeId: id, facet: FACET_BY_KEY[k], value })),
    );
    if (values.length > 0) {
      const inserted = await db.insert(recipeCategories).values(values).onConflictDoNothing().returning({ value: recipeCategories.value });
      if (inserted.length > 0) filled++;
      rowsWritten += inserted.length;
    }

    const hasCuisine = existing.cuisine.length > 0 || produced.cuisine.length > 0;
    const hasDishType = existing.dishType.length > 0 || produced.dishType.length > 0;
    if (!hasCuisine || !hasDishType) residual.push(id);
  }

  return { scanned: gapIds.length, filled, rowsWritten, residual };
}
