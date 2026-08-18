import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, userPreferences, userAllergens, userDiets, userFoodPrefs } from '../schema.js';
import { UserPreferencesSchema, type UserPreferences } from '../models/user-preferences.js';

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

    const [allergens, diets, foodPrefs] = await Promise.all([
      this.db.select().from(userAllergens).where(eq(userAllergens.userId, userId)),
      this.db.select().from(userDiets).where(eq(userDiets.userId, userId)),
      this.db.select().from(userFoodPrefs).where(eq(userFoodPrefs.userId, userId)),
    ]);

    return UserPreferencesSchema.parse({
      userId: prefs.userId,
      skillLevel: prefs.skillLevel,
      budgetCentsPerServing: prefs.budgetCentsPerServing,
      timeBudgetMinutes: prefs.timeBudgetMinutes,
      weights: {
        cost: prefs.weightCost,
        difficulty: prefs.weightDifficulty,
        nutrition: prefs.weightNutrition,
        affinity: prefs.weightAffinity,
        time: prefs.weightTime,
        popularity: prefs.weightPopularity,
      },
      allergens: allergens.map((a) => ({ allergen: a.allergen, severity: a.severity })),
      diets: diets.map((d) => ({ dietId: d.dietId, strictness: d.strictness })),
      foodPrefs: foodPrefs.map((f) => ({ facet: f.facet, value: f.value, sentiment: f.sentiment })),
    });
  }

  /** Cold-start defaults from `users.goals`: all weights 1 (popularity 0), bumped by goal. */
  private async coldStart(userId: string): Promise<UserPreferences> {
    const [user] = await this.db.select({ goals: users.goals }).from(users).where(eq(users.id, userId));
    if (!user) throw new Error(`No user for id ${userId}`);
    const goals = user.goals ?? [];

    return UserPreferencesSchema.parse({
      userId,
      skillLevel: 'beginner',
      budgetCentsPerServing: null,
      timeBudgetMinutes: null,
      weights: {
        cost: goals.includes('save_money') ? 3 : 1,
        difficulty: 1,
        nutrition: goals.includes('eat_healthier') ? 3 : 1,
        affinity: 1,
        time: 1,
        popularity: 0,
      },
      allergens: [],
      diets: [],
      foodPrefs: [],
    });
  }
}
