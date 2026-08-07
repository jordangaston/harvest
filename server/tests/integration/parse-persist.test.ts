import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../src/db/index.js';
import { recipes, ingredients, recipeSteps, importJobs, users } from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';

const RECIPE: RecipeInput = {
  title: 'Test Bake',
  sourceType: 'website',
  sourceUrl: 'https://example.com/r',
  servings: 4,
  servingsEstimated: false,
  ingredients: [
    { name: 'garlic', amount: '3', unit: null, quantityText: '3 cloves garlic' },
    { name: 'butter', amount: '2', unit: 'tablespoon', quantityText: '2 tbsp butter' },
  ],
  steps: ['Mix', 'Bake'],
  confidence: 0.9,
  nutrition: null,
};

async function seedUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ phone: `+1${Date.now()}`, jwtPrivateKey: 'k', jwtPublicKey: 'k' })
    .returning({ id: users.id });
  return row.id;
}

// Clear this suite's rows FK-first before and after, so it never leaves join
// rows that a later serial suite's `delete users` would trip over.
async function clear(): Promise<void> {
  await db.delete(importJobs);
  await db.delete(recipes);
  await db.delete(users);
}

beforeEach(clear);
afterEach(clear);

afterAll(async () => {
  await pool.end();
});

describe('RecipeRepository.persist', () => {
  it('writes recipe (owned by user_id) + N ingredients (icon + separated amount/unit/quantity_text) + M steps', async () => {
    const userId = await seedUser();

    const recipeId = await RecipeRepository.create().persist(RECIPE, userId);

    const [recipeRow] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(recipeRow.userId).toBe(userId); // C6: owner is the creator, no saved_recipes
    expect(recipeRow.servings).toBe(4);
    expect(recipeRow.servingsEstimated).toBe(false);

    const ingRows = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.recipeId, recipeId))
      .orderBy(ingredients.position);
    expect(ingRows.map((r) => r.icon).sort()).toEqual(['butter', 'garlic']);
    // C3: measurement is separated from the display line.
    expect(ingRows.map((r) => ({ name: r.name, amount: r.amount, unit: r.unit, quantityText: r.quantityText }))).toEqual([
      { name: 'garlic', amount: '3', unit: null, quantityText: '3 cloves garlic' },
      { name: 'butter', amount: '2', unit: 'tablespoon', quantityText: '2 tbsp butter' },
    ]);
    expect(await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(2);
  });
});
