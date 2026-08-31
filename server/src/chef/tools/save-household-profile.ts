import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce, parseBudgetCents } from './catalog.js';
import { HouseholdPreferenceRepository, type HouseholdPreferencesPatch } from '../../repositories/household-preference-repository.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

// Enum arrays and budget arrive as raw strings the tool coerces; scalars pass through. Optionals are
// `.nullish()` so a model that emits `null` for an absent field parses cleanly (treated as absent).
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
        'leftovers) once the user gives them. Coerces values to catalog ids; unmatched values are ' +
        'rejected with the nearest matches, never guessed. Allergens are member-scoped — not here.',
      inputSchema,
      execute: async ({ patch }) => this.run(patch),
    });
  }

  async run(patch: Patch): Promise<SaveResult> {
    if (!this.ctx.householdId) return { saved: {}, rejected: [{ input: 'household', reason: 'no household yet' }] };
    const saved: Record<string, unknown> = {};
    const rejected: SaveResult['rejected'] = [];
    const write: HouseholdPreferencesPatch = {};

    const { grocery_stores, weekly_budget_cents, owned_equipment, ...scalars } = patch;

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
