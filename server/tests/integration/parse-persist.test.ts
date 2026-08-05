import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool } from '../../src/db/index.js';
import { recipes, ingredients, recipeSteps, savedRecipes, importJobs, users } from '../../src/db/schema/index.js';
import { RecipeRepository, type RecipeInput } from '../../src/repositories/recipe-repository.js';

const RECIPE: RecipeInput = {
  title: 'Test Bake',
  sourceType: 'website',
  sourceUrl: 'https://example.com/r',
  ingredients: ['3 cloves garlic', '2 tbsp butter'],
  steps: ['Mix', 'Bake'],
  confidence: 0.9,
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
  await db.delete(savedRecipes);
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
  it('writes recipe + N ingredients (each with an icon) + M steps + one join in a transaction', async () => {
    const userId = await seedUser();

    const recipeId = await RecipeRepository.create().persist(RECIPE, userId);

    const ingRows = await db.select().from(ingredients).where(eq(ingredients.recipeId, recipeId));
    expect(ingRows.map((r) => r.icon).sort()).toEqual(['butter', 'garlic']);
    expect(await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId))).toHaveLength(2);
    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.userId, userId))).toHaveLength(1);
  });

  it('is idempotent — re-saving the same recipe for the same user adds no duplicate join row', async () => {
    const userId = await seedUser();
    const repo = RecipeRepository.create();

    const recipeId = await repo.persist(RECIPE, userId);
    await db.insert(savedRecipes).values({ userId, recipeId }).onConflictDoNothing();

    expect(await db.select().from(savedRecipes).where(eq(savedRecipes.recipeId, recipeId))).toHaveLength(1);
  });
});
