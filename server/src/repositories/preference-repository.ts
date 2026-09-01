import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, userPreferences, userAllergens, userDiets, userFoodPrefs, userEquipment, type AffinityFacet } from '../schema.js';
import { UserPreferencesSchema, ZERO_MEALS, timeByMealFromColumns, type UserPreferences, type PreferencesUpdate } from '../models/user-preferences.js';

/** A drizzle transaction client — the type passed to each write in a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Maps a weight signal to its `user_preferences` column (drizzle property + column). */
const WEIGHT_COLUMN = {
  cost: 'weightCost',
  difficulty: 'weightDifficulty',
  nutrition: 'weightNutrition',
  affinity: 'weightAffinity',
  time: 'weightTime',
  popularity: 'weightPopularity',
  mealPrep: 'weightMealPrep',
} as const;

export type WeightSignal = keyof typeof WEIGHT_COLUMN;

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database) {
    return new PreferenceRepository(db);
  }

  /**
   * Resolves a user's ranking preferences: their stored `user_preferences` row plus
   * child tables when present, else goals-derived cold-start defaults.
   * @param userId - The authenticated user (caller guarantees they exist).
   * @returns The fully-resolved preferences, parsed at the domain boundary.
   * @throws If the row is stored but fails validation (e.g. an out-of-range weight),
   *   or if no `users` row exists for the id (a bug — callers pass an authed user).
   */
  async getPreferences(userId: string): Promise<UserPreferences> {
    const [prefs] = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    if (!prefs) return this.coldStart(userId);

    const [allergens, diets, foodPrefs, equipment] = await Promise.all([
      this.db.select().from(userAllergens).where(eq(userAllergens.userId, userId)),
      this.db.select().from(userDiets).where(eq(userDiets.userId, userId)),
      this.db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId)),
      this.db.select().from(userEquipment).where(eq(userEquipment.userId, userId)),
    ]);

    return UserPreferencesSchema.parse({
      userId: prefs.userId,
      skillLevel: prefs.skillLevel,
      budgetCentsPerServing: prefs.budgetCentsPerServing,
      weeklyBudgetCents: prefs.weeklyBudgetCents,
      timeBudgetMinutes: prefs.timeBudgetMinutes,
      timeByMeal: timeByMealFromColumns(prefs.timeBreakfastMinutes, prefs.timeLunchMinutes, prefs.timeDinnerMinutes),
      weeklyMeals: prefs.weeklyMeals ?? ZERO_MEALS,
      weights: {
        cost: prefs.weightCost,
        difficulty: prefs.weightDifficulty,
        nutrition: prefs.weightNutrition,
        affinity: prefs.weightAffinity,
        time: prefs.weightTime,
        popularity: prefs.weightPopularity,
        mealPrep: prefs.weightMealPrep,
      },
      allergens: allergens.map((a) => ({ allergen: a.allergen, severity: a.severity })),
      diets: diets.map((d) => ({ dietId: d.dietId, strictness: d.strictness })),
      foodPrefs: foodPrefs.map((f) => ({ facet: f.facet, value: f.value, sentiment: f.sentiment, target: f.target, reason: f.reason })),
      ownedEquipment: equipment.map((e) => e.equipment),
      equipmentReviewed: prefs.equipmentReviewed,
      groceryStores: prefs.groceryStores ?? [],
      household: { adults: prefs.householdAdults, kids: prefs.householdKids },
      eatsLeftovers: prefs.eatsLeftovers,
    });
  }

  /** Cold-start defaults from `users.goals`: all weights 1 (popularity 0), bumped by goal. */
  private async coldStart(userId: string): Promise<UserPreferences> {
    const row = await this.coldStartRow(this.db, userId);
    return UserPreferencesSchema.parse({
      ...row,
      weeklyBudgetCents: null,
      timeByMeal: null,
      weeklyMeals: ZERO_MEALS,
      weights: {
        cost: row.weightCost,
        difficulty: row.weightDifficulty,
        nutrition: row.weightNutrition,
        affinity: row.weightAffinity,
        time: row.weightTime,
        popularity: row.weightPopularity,
        mealPrep: row.weightMealPrep,
      },
      allergens: [],
      diets: [],
      foodPrefs: [],
      ownedEquipment: [],
      equipmentReviewed: false,
      groceryStores: [],
      household: { adults: 2, kids: 0 },
      eatsLeftovers: true,
    });
  }

  /**
   * The `user_preferences` column values for a cold-start user, derived from
   * `users.goals`. Shared by the read path (resolve without writing) and the write
   * path (materialize the row before the first nudge).
   * @throws If no `users` row exists for the id (a bug — callers pass an authed user).
   */
  private async coldStartRow(db: Database | Tx, userId: string) {
    const [user] = await db.select({ goals: users.goals }).from(users).where(eq(users.id, userId));
    if (!user) throw new Error(`No user for id ${userId}`);
    const goals = user.goals ?? [];
    return {
      userId,
      skillLevel: 'beginner' as const,
      budgetCentsPerServing: null,
      timeBudgetMinutes: null,
      weightCost: goals.includes('save_money') ? 3 : 1,
      weightDifficulty: 1,
      weightNutrition: goals.includes('eat_healthier') ? 3 : 1,
      weightAffinity: 1,
      weightTime: goals.includes('quick_meals') ? 3 : 1,
      weightPopularity: 0,
      weightMealPrep: goals.includes('meal_prepping') ? 3 : 1,
    };
  }

  /** Ensures a `user_preferences` row exists, materializing cold-start defaults if not. */
  private async ensureRow(tx: Tx, userId: string): Promise<void> {
    const { userId: _id, ...row } = await this.coldStartRow(tx, userId);
    await tx.insert(userPreferences).values({ userId, ...row }).onConflictDoNothing();
  }

  /**
   * Nudges one weight up by 1 (capped at 3), the first write-path into
   * `user_preferences`. A cold-start user's defaults are materialized as a row first,
   * so the nudge lands on their goal-derived baseline.
   */
  async bumpWeight(userId: string, signal: WeightSignal): Promise<void> {
    const property = WEIGHT_COLUMN[signal];
    const column = userPreferences[property];
    await this.db.transaction(async (tx) => {
      await this.ensureRow(tx, userId);
      await tx.update(userPreferences).set({ [property]: sql`min(3, ${column} + 1)` }).where(eq(userPreferences.userId, userId));
    });
  }

  /**
   * Records a food-pref dislike (a like on the same facet/value flips to dislike).
   * Materializes cold-start preferences first so the user has a resolved profile.
   */
  async addDislike(userId: string, facet: AffinityFacet, value: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.ensureRow(tx, userId);
      await tx
        .insert(userFoodPrefs)
        .values({ userId, facet, value, sentiment: 'dislike' })
        .onConflictDoUpdate({ target: [userFoodPrefs.userId, userFoodPrefs.facet, userFoodPrefs.value], set: { sentiment: 'dislike' } });
    });
  }

  /**
   * Persists the user-editable preferences from the settings surface (a full upsert of the
   * editable subset). Weights are left untouched — they're server-owned (dislike-tuned). Liked
   * cuisines / disliked ingredients replace only the `cuisine`/`like` and `primary_ingredient`/
   * `dislike` food-pref slices; other facets survive. Reviewing preferences sets the equipment gate.
   * @returns The re-resolved preferences after the write.
   */
  async savePreferences(userId: string, input: PreferencesUpdate): Promise<UserPreferences> {
    await this.db.transaction(async (tx) => {
      await this.ensureRow(tx, userId);

      // Seed the meal-prep weight once when leftovers flip false→true (mirrors the goals
      // cold-start seed); never lower it. Read the pre-save value inside the tx.
      const [before] = await tx.select({ eatsLeftovers: userPreferences.eatsLeftovers }).from(userPreferences).where(eq(userPreferences.userId, userId));
      const leftoversTurnedOn = input.eatsLeftovers && before && !before.eatsLeftovers;

      // `time_budget_minutes` is the derived max(...) scalar (back-compat + cold-start); when the
      // client sends per-meal budgets it wins (the largest set meal), else the client's own scalar.
      const mealTimes = input.timeByMeal
        ? [input.timeByMeal.breakfast, input.timeByMeal.lunch, input.timeByMeal.dinner].filter((n): n is number => n != null)
        : [];
      const timeBudgetMinutes = mealTimes.length ? Math.max(...mealTimes) : input.timeBudgetMinutes;

      await tx
        .update(userPreferences)
        .set({
          skillLevel: input.skillLevel,
          weeklyBudgetCents: input.weeklyBudgetCents,
          timeBudgetMinutes,
          timeBreakfastMinutes: input.timeByMeal?.breakfast ?? null,
          timeLunchMinutes: input.timeByMeal?.lunch ?? null,
          timeDinnerMinutes: input.timeByMeal?.dinner ?? null,
          weeklyMeals: input.weeklyMeals,
          equipmentReviewed: true,
          // Domain model keeps stores as string[]; the wire DTO already validated them against
          // the GROCERY_STORES enum the column types, so this widening cast is safe.
          groceryStores: input.groceryStores as (typeof userPreferences.$inferInsert)['groceryStores'],
          householdAdults: input.household.adults,
          householdKids: input.household.kids,
          eatsLeftovers: input.eatsLeftovers,
          ...(leftoversTurnedOn ? { weightMealPrep: sql`min(3, ${userPreferences.weightMealPrep} + 1)` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, userId));

      await tx.delete(userAllergens).where(eq(userAllergens.userId, userId));
      if (input.allergens.length)
        await tx.insert(userAllergens).values(input.allergens.map((a) => ({ userId, allergen: a.allergen, severity: a.severity })));

      await tx.delete(userDiets).where(eq(userDiets.userId, userId));
      if (input.diets.length)
        await tx.insert(userDiets).values(input.diets.map((d) => ({ userId, dietId: d.dietId, strictness: d.strictness })));

      await tx.delete(userEquipment).where(eq(userEquipment.userId, userId));
      if (input.ownedEquipment.length)
        await tx.insert(userEquipment).values(input.ownedEquipment.map((equipment) => ({ userId, equipment })));

      // One write routine: upsert each unified foodPref by (userId, facet, value), writing all
      // three axis columns. Untouched rows (a dislike-loop dislike, a moderation the picker didn't
      // resend) survive — the picker sends only what it changed. The Zod model already rejects a
      // neither-axis element; guard here too since the repo is a public boundary.
      const foodRows = input.foodPrefs.map((p) => {
        if (p.sentiment == null && p.target == null)
          throw new Error(`food pref (${p.facet}, ${p.value}) has neither sentiment nor target`);
        return { userId, facet: p.facet, value: p.value, sentiment: p.sentiment ?? null, target: p.target ?? null, reason: p.reason ?? null };
      });
      if (foodRows.length)
        await tx
          .insert(userFoodPrefs)
          .values(foodRows)
          .onConflictDoUpdate({
            target: [userFoodPrefs.userId, userFoodPrefs.facet, userFoodPrefs.value],
            set: { sentiment: sql`excluded.sentiment`, target: sql`excluded.target`, reason: sql`excluded.reason` },
          });
    });
    return this.getPreferences(userId);
  }
}
