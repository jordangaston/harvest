import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce, parseBudgetCents } from './catalog.js';
import type { HouseholdPreferencesPatch } from '../../repositories/household-preference-repository.js';
import type { ChefState, SaveResult, ToolCtx } from './types.js';

// The model-facing patch: enum arrays and budget arrive as raw strings the tool coerces;
// scalars pass through. Allergens are member-scoped and absent here by design (AC-3).
const inputSchema = z.object({
  patch: z
    .object({
      grocery_stores: z.array(z.string()).optional(),
      grocery_shopping_day: z.string().optional(),
      weekly_budget_cents: z.union([z.string(), z.number()]).optional(),
      owned_equipment: z.array(z.string()).optional(),
      eats_leftovers: z.boolean().optional(),
      household_adults: z.number().int().optional(),
      household_kids: z.number().int().optional(),
    })
    .passthrough(),
});

type Input = z.infer<typeof inputSchema>;

/** Pure precondition: household preferences are always writable once a thread has a household. */
export function canRun(_state: ChefState): boolean {
  return true;
}

/** Coerces each raw value in a string[] against a code catalog, splitting saved vs rejected. */
function coerceSet(raw: string[], kind: 'store' | 'equipment') {
  const cands = codeCandidates(kind);
  const saved: string[] = [];
  const rejected: SaveResult['rejected'] = [];
  for (const r of raw) {
    const { value, closest } = coerce(r, cands);
    if (value) saved.push(value);
    else rejected.push({ input: r, reason: 'no catalog match', closest });
  }
  return { saved, rejected };
}

/**
 * Normalizes a household patch (enum arrays coerced to catalog ids, budget parsed to cents),
 * then read-merge-writes it via `HouseholdPreferenceRepository`. Enum-or-nothing: unmatched
 * values land in `rejected` with `closest`, never written raw. Idempotent (scalars
 * last-writer-wins; the receiver is a partial UPDATE).
 */
export async function execute({ patch }: Input, ctx: ToolCtx): Promise<SaveResult> {
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
    // coerce() guarantees each id is in EQUIPMENT_TYPES; narrow to the column enum here.
    if (r.saved.length) { write.ownedEquipment = r.saved as HouseholdPreferencesPatch['ownedEquipment']; saved.owned_equipment = r.saved; }
    rejected.push(...r.rejected);
  }
  if (weekly_budget_cents !== undefined) {
    const cents = parseBudgetCents(weekly_budget_cents);
    if (cents !== null) { write.weeklyBudgetCents = cents; saved.weekly_budget_cents = cents; }
    else rejected.push({ input: String(weekly_budget_cents), reason: 'not a budget amount' });
  }

  // Remaining scalars (eats_leftovers, household_adults/kids, grocery_shopping_day) map 1:1.
  const passthrough: Record<string, keyof HouseholdPreferencesPatch> = {
    grocery_shopping_day: 'groceryShoppingDay',
    eats_leftovers: 'eatsLeftovers',
    household_adults: 'householdAdults',
    household_kids: 'householdKids',
  };
  for (const [k, col] of Object.entries(passthrough)) {
    const v = (scalars as Record<string, unknown>)[k];
    if (v !== undefined) { (write as Record<string, unknown>)[col] = v; saved[k] = v; }
  }

  if (Object.keys(write).length) await ctx.householdPrefs.savePreferences(ctx.state.householdId, write);
  return { saved, rejected };
}

export const saveHouseholdProfileTool = createTool({
  id: 'save_household_profile',
  description:
    'Save household-scoped preferences (grocery stores, budget, equipment, shopping day, headcount, ' +
    'leftovers). Coerces values to catalog ids; unmatched values are rejected with the nearest ' +
    'matches, never guessed. Idempotent read-merge-write. Allergens are member-scoped — not here.',
  inputSchema,
  execute: (input, ctx) => execute(input, ctx as unknown as ToolCtx),
});
