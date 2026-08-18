import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, userPreferences, userAllergens, userDiets, userFoodPrefs, type AffinityFacet } from '../schema.js';
import { UserPreferencesSchema, type UserPreferences } from '../models/user-preferences.js';

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
    const row = await this.coldStartRow(this.db, userId);
    return UserPreferencesSchema.parse({
      ...row,
      weights: {
        cost: row.weightCost,
        difficulty: row.weightDifficulty,
        nutrition: row.weightNutrition,
        affinity: row.weightAffinity,
        time: row.weightTime,
        popularity: row.weightPopularity,
      },
      allergens: [],
      diets: [],
      foodPrefs: [],
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
      weightTime: 1,
      weightPopularity: 0,
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
}
