import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db.js';
import { users, userPreferences, userAllergens, userDiets, userFoodPrefs, userEquipment, MAJOR_ALLERGENS, ALLERGEN_SEVERITIES, DIET_STRICTNESS, DIFFICULTY_BANDS, type DirectiveDimension, type DirectiveScope, type Direction, type Strength } from '../schema.js';
import { UserPreferencesSchema, ZERO_MEALS, timeByMealFromColumns, type UserPreferences, type PreferencesUpdate } from '../models/user-preferences.js';

/** A drizzle transaction client — the type passed to each write in a transaction. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A write executor: an open transaction, or the bare `db` (which opens its own). */
type Executor = Database | Tx;

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database) {
    return new PreferenceRepository(db);
  }

  /**
   * Resolves a user's ranking preferences: their stored `user_preferences` row plus
   * child tables when present, else cold-start defaults.
   * @param userId - The authenticated user (caller guarantees they exist).
   * @returns The fully-resolved preferences, parsed at the domain boundary.
   * @throws If the row is stored but fails validation, or if no `users` row exists for the id
   *   (a bug — callers pass an authed user).
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
      allergens: allergens.map((a) => ({ allergen: a.allergen, severity: a.severity })),
      diets: diets.map((d) => ({ dietId: d.dietId, strictness: d.strictness })),
      foodPrefs: foodPrefs.map((f) => ({ dimension: f.dimension, value: f.value, scope: f.scope, direction: f.direction, strength: f.strength, target: f.target, unit: f.unit, reason: f.reason })),
      ownedEquipment: equipment.map((e) => e.equipment),
      equipmentReviewed: prefs.equipmentReviewed,
      groceryStores: prefs.groceryStores ?? [],
      household: { adults: prefs.householdAdults, kids: prefs.householdKids },
      eatsLeftovers: prefs.eatsLeftovers,
    });
  }

  /** Cold-start defaults: the baseline `user_preferences` row plus empty child tables. */
  private async coldStart(userId: string): Promise<UserPreferences> {
    const row = await this.coldStartRow(this.db, userId);
    return UserPreferencesSchema.parse({
      ...row,
      weeklyBudgetCents: null,
      timeByMeal: null,
      weeklyMeals: ZERO_MEALS,
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
   * The baseline `user_preferences` column values for a cold-start user. Shared by the read path
   * (resolve without writing) and the write path (materialize the row before the first write).
   * Goal→weight seeding is retired with the weight vector (WI-3); goals now shape ranking only as
   * seeded directives, not baseline weights.
   * @throws If no `users` row exists for the id (a bug — callers pass an authed user).
   */
  private async coldStartRow(db: Database | Tx, userId: string) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new Error(`No user for id ${userId}`);
    return {
      userId,
      skillLevel: 'beginner' as const,
      budgetCentsPerServing: null,
      timeBudgetMinutes: null,
    };
  }

  /** Ensures a `user_preferences` row exists, materializing cold-start defaults if not. */
  private async ensureRow(tx: Executor, userId: string): Promise<void> {
    const { userId: _id, ...row } = await this.coldStartRow(tx, userId);
    await tx.insert(userPreferences).values({ userId, ...row }).onConflictDoNothing();
  }

  /**
   * Records a dislike as a recipe-scope `less` directive (a `more` at the same
   * dimension/value/scope flips to `less`). Materializes cold-start preferences first.
   */
  async addDislike(userId: string, dimension: DirectiveDimension, value: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.ensureRow(tx, userId);
      await tx
        .insert(userFoodPrefs)
        .values({ userId, dimension, value, scope: 'recipe', direction: 'less', strength: 'soft' })
        .onConflictDoUpdate({ target: [userFoodPrefs.userId, userFoodPrefs.dimension, userFoodPrefs.value, userFoodPrefs.scope], set: { direction: 'less' } });
    });
  }

  /**
   * Upserts one directive targeted on `(userId, dimension, value, scope)` — the chef's incremental
   * write path. Deletes any existing directive at that key then inserts the new one, so a re-write
   * flips its fields without touching sibling rows or the dislike loop's server-owned
   * `primary_ingredient` dimension. `scope`/`strength` default when omitted. Materializes cold-start
   * preferences first.
   * @throws If `dimension` is `primary_ingredient` (server-owned — the picker authors it, not the chef).
   */
  async upsertFoodPref(
    userId: string,
    pref: { dimension: DirectiveDimension; value: string; scope?: DirectiveScope; direction: Direction; strength?: Strength; target?: number | null; unit?: string | null; reason?: string | null },
    tx?: Executor,
  ): Promise<void> {
    if (pref.dimension === 'primary_ingredient') throw new Error('primary_ingredient is server-owned');
    const scope = pref.scope ?? 'recipe';
    await this.on(tx, async (t) => {
      await this.ensureRow(t, userId);
      await t.delete(userFoodPrefs).where(and(eq(userFoodPrefs.userId, userId), eq(userFoodPrefs.dimension, pref.dimension), eq(userFoodPrefs.value, pref.value), eq(userFoodPrefs.scope, scope)));
      await t.insert(userFoodPrefs).values({ userId, dimension: pref.dimension, value: pref.value, scope, direction: pref.direction, strength: pref.strength ?? 'soft', target: pref.target ?? null, unit: pref.unit ?? null, reason: pref.reason ?? null });
    });
  }

  /**
   * Upserts one member allergen targeted on `(userId, allergen)` — the chef's incremental write path.
   * Deletes any existing row at that allergen then inserts, leaving other allergens and every other
   * slice untouched. The caller (the ALLERGEN fact) gates confirmation + severity; this just persists.
   */
  async upsertAllergen(userId: string, entry: { allergen: (typeof MAJOR_ALLERGENS)[number]; severity: (typeof ALLERGEN_SEVERITIES)[number] }, tx?: Executor): Promise<void> {
    await this.on(tx, async (t) => {
      await this.ensureRow(t, userId);
      await t.delete(userAllergens).where(and(eq(userAllergens.userId, userId), eq(userAllergens.allergen, entry.allergen)));
      await t.insert(userAllergens).values({ userId, allergen: entry.allergen, severity: entry.severity });
    });
  }

  /**
   * Upserts one member diet targeted on `(userId, dietId)` — the chef's incremental write path.
   * Deletes any existing row at that diet then inserts, leaving other diets and every other slice
   * untouched. The caller (the DIET fact) applies the default strictness; this just persists.
   */
  async upsertDiet(userId: string, entry: { dietId: string; strictness: (typeof DIET_STRICTNESS)[number] }, tx?: Executor): Promise<void> {
    await this.on(tx, async (t) => {
      await this.ensureRow(t, userId);
      await t.delete(userDiets).where(and(eq(userDiets.userId, userId), eq(userDiets.dietId, entry.dietId)));
      await t.insert(userDiets).values({ userId, dietId: entry.dietId, strictness: entry.strictness });
    });
  }

  /** Sets ONLY `user_preferences.skill_level`, materializing the row first. Touches no other slice. */
  async setSkillLevel(userId: string, level: (typeof DIFFICULTY_BANDS)[number], tx?: Executor): Promise<void> {
    await this.on(tx, async (t) => {
      await this.ensureRow(t, userId);
      await t.update(userPreferences).set({ skillLevel: level, updatedAt: new Date() }).where(eq(userPreferences.userId, userId));
    });
  }

  /** Runs `fn` on the given executor, or opens its own transaction when none is passed. */
  private async on(tx: Executor | undefined, fn: (t: Executor) => Promise<void>): Promise<void> {
    if (tx) return fn(tx);
    await this.db.transaction(fn);
  }

  /**
   * Persists the user-editable preferences from the settings surface (a full replace of the
   * editable subset). The food-pref write replaces every caller-authored facet (taste like/dislike +
   * food_category moderation), leaving the dislike loop's `primary_ingredient` rows intact. Reviewing
   * preferences sets the equipment gate.
   * @returns The re-resolved preferences after the write.
   */
  async savePreferences(userId: string, input: PreferencesUpdate): Promise<UserPreferences> {
    await this.db.transaction(async (tx) => {
      await this.ensureRow(tx, userId);

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

      // The caller owns every directive dimension it can author — the taste dimensions (cuisine,
      // dish_type, ingredient) and food_category/nutrient moderation — so this is a full replace of
      // that slice: delete the owned dimensions, then insert what came in. `primary_ingredient` is the
      // dislike loop's dimension, which the picker never authors, so those rows survive untouched. The
      // chef read-merge-writes the full set it read, so its rows come back in `input` and re-land.
      const foodRows = input.foodPrefs.map((p) => ({
        userId,
        dimension: p.dimension,
        value: p.value,
        scope: p.scope,
        direction: p.direction,
        strength: p.strength,
        target: p.target ?? null,
        unit: p.unit ?? null,
        reason: p.reason ?? null,
      }));
      await tx.delete(userFoodPrefs).where(and(eq(userFoodPrefs.userId, userId), ne(userFoodPrefs.dimension, 'primary_ingredient')));
      if (foodRows.length) await tx.insert(userFoodPrefs).values(foodRows);
    });
    return this.getPreferences(userId);
  }
}
