import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CandidateProvider } from '../src/planning/candidate-provider.js';
import { CookbookRepository } from '../src/repositories/cookbook-repository.js';
import { MealPlanRepository } from '../src/repositories/meal-plan-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { recipes, recipeCategories, cookbookRecipes, userPreferences, userAllergens } from '../src/schema.js';
import { makeHarness, type Harness } from './helpers/wave2-harness.js';

/** WI-MP-2 — CandidateProvider (O-01): tiering, meal-type filter, recency, ranking filters honored. */

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

/** Inserts a recipe + a meal_type category row; returns its id. `userId=null` = a global recipe. */
async function seedRecipe(opts: {
  userId: string | null;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  allergens?: { contains: string[]; mayContain: string[] };
}): Promise<string> {
  const [row] = await h.db
    .insert(recipes)
    .values({
      userId: opts.userId,
      title: 'Seed Recipe',
      sourceType: 'website',
      allergens: opts.allergens ?? { contains: [], mayContain: [] },
      allergensComplete: true, // so a severe allergen only excludes actual-peanut recipes, not unknowns
    })
    .returning({ id: recipes.id });
  await h.db.insert(recipeCategories).values({ recipeId: row.id, facet: 'meal_type', value: opts.mealType });
  return row.id;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('CandidateProvider.candidates', () => {
  it('tiers by ownership + liked/saved, filters by meal type, drops recency + ranking-excluded (TC1)', async () => {
    const me = await h.mintBearer();
    const cookbooks = CookbookRepository.create(h.db);
    const likedId = await cookbooks.ensureSystemCookbook(me.userId, 'liked', 'Liked');
    const savedId = await cookbooks.ensureSystemCookbook(me.userId, 'saved', 'Saved');

    const imported = await seedRecipe({ userId: me.userId, mealType: 'dinner' });
    const liked = await seedRecipe({ userId: null, mealType: 'dinner' });
    const saved = await seedRecipe({ userId: null, mealType: 'dinner' });
    const global = await seedRecipe({ userId: null, mealType: 'dinner' });
    const dual = await seedRecipe({ userId: me.userId, mealType: 'dinner' }); // owned AND liked → imported wins
    const recent = await seedRecipe({ userId: null, mealType: 'dinner' });
    const breakfast = await seedRecipe({ userId: null, mealType: 'breakfast' });
    const peanut = await seedRecipe({ userId: null, mealType: 'dinner', allergens: { contains: ['peanut'], mayContain: [] } });

    await h.db.insert(cookbookRecipes).values([
      { cookbookId: likedId, recipeId: liked },
      { cookbookId: likedId, recipeId: dual },
      { cookbookId: savedId, recipeId: saved },
    ]);
    // A severe peanut allergy → the ranking AllergenFilter must drop the peanut recipe.
    await h.db.insert(userPreferences).values({ userId: me.userId });
    await h.db.insert(userAllergens).values({ userId: me.userId, allergen: 'peanut', severity: 'severe' });
    // `recent` was cooked 3 days ago → inside the cooldown window.
    await MealPlanRepository.create(h.db).add(me.userId, daysAgo(3), 'dinner', recent);

    const prefs = await PreferenceRepository.create(h.db).getPreferences(me.userId);
    const pool = await CandidateProvider.create(h.db).candidates(me.userId, 'dinner', prefs);
    const tierOf = (id: string) => pool.find((c) => c.recipeId === id)?.tier;

    expect(tierOf(imported)).toBe('imported');
    expect(tierOf(liked)).toBe('liked');
    expect(tierOf(saved)).toBe('saved');
    expect(tierOf(global)).toBe('global');
    expect(tierOf(dual)).toBe('imported'); // highest tier wins

    const ids = new Set(pool.map((c) => c.recipeId));
    expect(ids.has(recent)).toBe(false); // recency-excluded
    expect(ids.has(breakfast)).toBe(false); // wrong meal type
    expect(ids.has(peanut)).toBe(false); // ranking allergen filter

    // Sorted by baseScore desc, and imported/liked/saved are marked familiar, plain global is new.
    const scores = pool.map((c) => c.baseScore);
    expect([...scores]).toEqual([...scores].sort((a, b) => b - a));
    expect(pool.find((c) => c.recipeId === global)!.familiar).toBe(false);
    expect(pool.find((c) => c.recipeId === imported)!.familiar).toBe(true);
  });
});
