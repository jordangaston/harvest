import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { DietClassifier } from './diet-classifier.js';
import { recipes, ingredients, recipeCategories } from '../schema.js';
import type { StructuredIngredient } from '../parse/ingredient.js';

/**
 * Re-classifies every existing recipe and persists its food classes as
 * `recipe_categories(facet='food_category')` rows. The food-class union reads only ingredient
 * names, so amounts are irrelevant here. `onConflictDoNothing` on the composite PK makes a
 * re-run idempotent (no duplicate rows).
 * @param db - the target database.
 * @returns how many recipes were classified and how many category rows were written.
 */
export async function backfillFoodCategory(db: Database): Promise<{ recipes: number; rowsWritten: number }> {
  const classifier = DietClassifier.create(db);
  const rows = await db.select({ id: recipes.id, servings: recipes.servings }).from(recipes);

  let recipeCount = 0;
  let rowsWritten = 0;
  for (const r of rows) {
    const ings = await db
      .select({ name: ingredients.name })
      .from(ingredients)
      .where(eq(ingredients.recipeId, r.id))
      .orderBy(ingredients.position);
    const structured: StructuredIngredient[] = ings.map((i) => ({ name: i.name, amount: null, unit: null, quantityText: i.name }));
    const diets = await classifier.classify(structured, r.servings);
    if (!diets || diets.foodClasses.length === 0) continue;

    const values = diets.foodClasses.map((value) => ({ recipeId: r.id, facet: 'food_category' as const, value }));
    const inserted = await db.insert(recipeCategories).values(values).onConflictDoNothing().returning({ value: recipeCategories.value });
    recipeCount++;
    rowsWritten += inserted.length;
  }
  return { recipes: recipeCount, rowsWritten };
}
