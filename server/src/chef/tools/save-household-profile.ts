import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce, parseBudgetCents } from './catalog.js';
import { HouseholdPreferenceRepository, type HouseholdPreferencesPatch } from '../../repositories/household-preference-repository.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

// Enum arrays and budget arrive as raw strings the tool coerces; scalars pass through. Optionals are
// `.nullish()` so a model that emits `null` for an absent field parses cleanly (treated as absent).
const mealCounts = z.object({
  breakfast: z.number().int().nonnegative().nullish(),
  lunch: z.number().int().nonnegative().nullish(),
  dinner: z.number().int().nonnegative().nullish(),
  snack: z.number().int().nonnegative().nullish(),
  kids: z.number().int().nonnegative().nullish(),
});
const mealMinutes = z.object({
  breakfast: z.number().int().nonnegative().nullish(),
  lunch: z.number().int().nonnegative().nullish(),
  dinner: z.number().int().nonnegative().nullish(),
});

/** Drop null/undefined values from a flat object (the model emits null for absent meal slots). */
function dropNulls<T extends Record<string, unknown>>(obj: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as { [K in keyof T]?: NonNullable<T[K]> };
}

const inputSchema = z.object({
  patch: z
    .object({
      grocery_stores: z.array(z.string()).nullish(),
      grocery_shopping_day: z.string().nullish(),
      weekly_budget_cents: z.union([z.string(), z.number()]).nullish(),
      owned_equipment: z.array(z.string()).nullish(),
      eats_leftovers: z.boolean().nullish(),
      household_adults: z.number().int().nullish(),
      household_kids: z.number().int().nullish(),
      // Per-meal counts to plan each week (e.g. "5 dinners" -> { dinner: 5 }); missing meals are 0.
      weekly_meals: mealCounts.nullish(),
      // How many days a week they cook.
      cook_days_count: z.number().int().nullish(),
      // Per-meal cook-time budget in minutes (e.g. "30-min dinners" -> { dinner: 30 }).
      time_by_meal: mealMinutes.nullish(),
    })
    .passthrough(),
});

type Patch = z.infer<typeof inputSchema>['patch'];

/** Coerces each raw value in a string[] against a code catalog, splitting saved vs rejected. */
function coerceSet(raw: string[], kind: 'store' | 'equipment') {
  const cands = codeCandidates(kind);
  const saved: string[] = [];
  const rejected: SaveResult['rejected'] = [];
  for (const r of raw) {
    if (r == null) continue;
    const { value, closest } = coerce(r, cands);
    if (value) saved.push(value);
    else rejected.push({ input: r, reason: 'no catalog match', closest });
  }
  return { saved, rejected };
}

/**
 * Saves household-scoped preferences: normalizes a patch (enum arrays coerced to catalog ids, budget
 * parsed to cents), then read-merge-writes via its own `HouseholdPreferenceRepository`. Enum-or-nothing:
 * unmatched values land in `rejected` with `closest`, never written raw. Idempotent.
 */
export class SaveHouseholdProfileTool implements ChefTool {
  readonly id = 'save_household_profile';
  readonly saved: SaveResult[] = [];
  private readonly prefs: HouseholdPreferenceRepository;

  private constructor(private readonly ctx: TurnContext) {
    this.prefs = HouseholdPreferenceRepository.create(ctx.db);
  }

  static create(ctx: TurnContext): SaveHouseholdProfileTool {
    return new SaveHouseholdProfileTool(ctx);
  }

  canRun(): boolean {
    return !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Save household-scoped preferences (grocery stores, budget, equipment, shopping day, headcount, ' +
        'leftovers, weekly meal counts, cook-days-per-week, per-meal time budget) once the user gives ' +
        'them. weekly_meals/time_by_meal are per-meal maps (e.g. "5 dinners" -> { dinner: 5 }). Coerces ' +
        'catalog values; unmatched are rejected with the nearest matches. Allergens are member-scoped — not here.',
      inputSchema,
      execute: async ({ patch }) => this.run(patch),
    });
  }

  async run(patch: Patch): Promise<SaveResult> {
    if (!this.ctx.householdId) return { saved: {}, rejected: [{ input: 'household', reason: 'no household yet' }] };
    const saved: Record<string, unknown> = {};
    const rejected: SaveResult['rejected'] = [];
    const write: HouseholdPreferencesPatch = {};

    const { grocery_stores, weekly_budget_cents, owned_equipment, weekly_meals, cook_days_count, time_by_meal, ...scalars } = patch;

    if (weekly_meals != null) {
      const meals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0, ...dropNulls(weekly_meals) };
      write.weeklyMeals = meals; saved.weekly_meals = meals;
    }
    // time_by_meal is the three cook-time sliders — the model requires all three positive, so only
    // write it when every meal is given; a partial ("30-min dinners") is left for the settings screen.
    if (time_by_meal != null) {
      const t = dropNulls(time_by_meal);
      if (t.breakfast && t.lunch && t.dinner) {
        const mins = { breakfast: t.breakfast, lunch: t.lunch, dinner: t.dinner };
        write.timeByMeal = mins; saved.time_by_meal = mins;
      }
    }
    if (cook_days_count != null) { write.cookDaysCount = cook_days_count; saved.cook_days_count = cook_days_count; }

    if (grocery_stores) {
      const r = coerceSet(grocery_stores, 'store');
      if (r.saved.length) { write.groceryStores = r.saved; saved.grocery_stores = r.saved; }
      rejected.push(...r.rejected);
    }
    if (owned_equipment) {
      const r = coerceSet(owned_equipment, 'equipment');
      if (r.saved.length) { write.ownedEquipment = r.saved as HouseholdPreferencesPatch['ownedEquipment']; saved.owned_equipment = r.saved; }
      rejected.push(...r.rejected);
    }
    if (weekly_budget_cents != null) {
      const cents = parseBudgetCents(weekly_budget_cents);
      if (cents !== null) { write.weeklyBudgetCents = cents; saved.weekly_budget_cents = cents; }
      else rejected.push({ input: String(weekly_budget_cents), reason: 'not a budget amount' });
    }

    // Remaining scalars map 1:1; a `null` (model's "absent") is skipped so NOT NULL columns survive.
    const passthrough: Record<string, keyof HouseholdPreferencesPatch> = {
      grocery_shopping_day: 'groceryShoppingDay',
      eats_leftovers: 'eatsLeftovers',
      household_adults: 'householdAdults',
      household_kids: 'householdKids',
    };
    for (const [k, col] of Object.entries(passthrough)) {
      const v = (scalars as Record<string, unknown>)[k];
      if (v != null) { (write as Record<string, unknown>)[col] = v; saved[k] = v; }
    }

    if (Object.keys(write).length) await this.prefs.savePreferences(this.ctx.householdId, write);
    const result: SaveResult = { saved, rejected };
    this.saved.push(result);
    return result;
  }
}
