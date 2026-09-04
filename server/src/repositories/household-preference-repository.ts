import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { householdPreferences } from '../schema.js';
import { HouseholdPreferencesSchema, type HouseholdPreferences } from '../models/household-preferences.js';
import { timeByMealFromColumns } from '../models/user-preferences.js';

/** A partial patch of the household-scoped preferences (the tool sends a subset). */
export type HouseholdPreferencesPatch = Partial<Omit<HouseholdPreferences, 'householdId' | 'updatedAt'>>;

/**
 * Read-merge-write on `household_preferences` (1:1 per household), mirroring
 * `PreferenceRepository`. `writeFact` persists household facts through here; last-writer-wins
 * per scalar, matching the design's idempotent read-merge-write invariant.
 */
export class HouseholdPreferenceRepository {
  constructor(private readonly db: Database) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new HouseholdPreferenceRepository(db);
  }

  /**
   * Reads the household's preferences, or the static column defaults when no row exists yet
   * (`eats_leftovers = true`, `household_adults = 2`, etc.).
   */
  async getPreferences(householdId: string): Promise<HouseholdPreferences> {
    const [row] = await this.db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    if (!row) return HouseholdPreferencesSchema.parse(DEFAULTS(householdId));
    const { timeBreakfastMinutes, timeLunchMinutes, timeDinnerMinutes, ...rest } = row;
    return HouseholdPreferencesSchema.parse({ ...rest, timeByMeal: timeByMealFromColumns(timeBreakfastMinutes, timeLunchMinutes, timeDinnerMinutes) });
  }

  /**
   * A read-merge-write: ensures the row exists with defaults, then updates only the keys in
   * `patch` (untouched fields survive), bumping `updated_at`.
   * @returns The re-resolved preferences after the write.
   */
  async savePreferences(householdId: string, patch: HouseholdPreferencesPatch): Promise<HouseholdPreferences> {
    await this.db.transaction(async (tx) => {
      await tx.insert(householdPreferences).values({ householdId }).onConflictDoNothing();
      // ponytail: partial-patch UPDATE (only patch keys), last-writer-wins per scalar — the design's
      // idempotent-read-merge-write invariant. The domain `timeByMeal` object maps onto its three
      // columns; everything else is a 1:1 column (widening string[]/enum casts validated upstream).
      const { timeByMeal, ...rest } = patch;
      const set = {
        ...rest,
        ...(timeByMeal !== undefined && {
          timeBreakfastMinutes: timeByMeal?.breakfast ?? null,
          timeLunchMinutes: timeByMeal?.lunch ?? null,
          timeDinnerMinutes: timeByMeal?.dinner ?? null,
        }),
        updatedAt: new Date(),
      } as typeof householdPreferences.$inferInsert;
      await tx.update(householdPreferences).set(set).where(eq(householdPreferences.householdId, householdId));
    });
    return this.getPreferences(householdId);
  }
}

/** The static column defaults, resolved without writing a row. */
const DEFAULTS = (householdId: string): HouseholdPreferences => ({
  householdId,
  groceryStores: null,
  groceryShoppingDay: null,
  weeklyBudgetCents: null,
  weeklyMeals: null,
  timeByMeal: null,
  timeBudgetMinutes: null,
  cookDays: null,
  eatsLeftovers: true,
  ownedEquipment: null,
  equipmentReviewed: false,
  householdAdults: 2,
  householdKids: 0,
  updatedAt: new Date(),
});
