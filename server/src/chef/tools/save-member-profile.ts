import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce } from './catalog.js';
import { ALLERGEN_SEVERITIES, DIET_STRICTNESS } from '../../schema.js';
import type { PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';
import type { ChefState, SaveResult, ToolCtx } from './types.js';

const inputSchema = z.object({
  member_user_id: z.string(),
  patch: z
    .object({
      allergens: z
        .array(z.object({ allergen: z.string(), severity: z.string().optional(), confirmed: z.boolean().optional() }))
        .optional(),
      diets: z.array(z.object({ dietId: z.string(), strictness: z.string().optional() })).optional(),
      owned_equipment: z.array(z.string()).optional(),
    })
    .passthrough(),
});

type Input = z.infer<typeof inputSchema>;

/** Pure precondition: the named member must belong to the thread's household. */
export function canRun(state: ChefState): boolean {
  const memberId = (state.args as { member_user_id?: string } | undefined)?.member_user_id;
  return !!memberId && state.members.some((m) => m.userId === memberId);
}

const isSeverity = (s: unknown): s is (typeof ALLERGEN_SEVERITIES)[number] =>
  ALLERGEN_SEVERITIES.includes(s as never);
const isStrictness = (s: unknown): s is (typeof DIET_STRICTNESS)[number] =>
  DIET_STRICTNESS.includes(s as never);

/** Splits the resolved foodPrefs back into the like/dislike arrays `savePreferences` rebuilds from. */
function foodPrefsToLikesDislikes(prefs: UserPreferences) {
  const likes = prefs.foodPrefs.filter((f) => f.sentiment === 'like').map((f) => ({ facet: f.facet, value: f.value }));
  const dislikes = prefs.foodPrefs.filter((f) => f.sentiment === 'dislike').map((f) => ({ facet: f.facet, value: f.value }));
  return { likes, dislikes };
}

/**
 * Read-merge-writes one member's profile: allergens/diets/equipment union into their
 * existing sets (never duplicate — idempotent). An allergen must carry `confirmed: true`
 * and a valid severity to land (the safety gate); unconfirmed or unmatched values are
 * rejected, never written raw. Re-checks membership defensively (a bad model turn).
 */
export async function execute({ member_user_id, patch }: Input, ctx: ToolCtx): Promise<SaveResult> {
  if (!canRun({ ...ctx.state, args: { member_user_id } })) {
    return { saved: {}, rejected: [{ input: member_user_id, reason: 'member does not exist yet' }] };
  }

  const saved: Record<string, unknown> = {};
  const rejected: SaveResult['rejected'] = [];
  const current = await ctx.memberPrefs.getPreferences(member_user_id);

  const allergens = [...current.allergens];
  for (const a of patch.allergens ?? []) {
    if (a.confirmed !== true) { rejected.push({ input: a.allergen, reason: 'allergen not confirmed' }); continue; }
    const { value, closest } = coerce(a.allergen, codeCandidates('allergen'));
    if (!value) { rejected.push({ input: a.allergen, reason: 'no catalog match', closest }); continue; }
    if (!isSeverity(a.severity)) { rejected.push({ input: a.allergen, reason: 'invalid severity' }); continue; }
    if (!allergens.some((x) => x.allergen === value)) allergens.push({ allergen: value as never, severity: a.severity });
    saved.allergens = (saved.allergens as string[] | undefined ?? []).concat(value);
  }

  const diets = [...current.diets];
  for (const d of patch.diets ?? []) {
    const { value, closest } = coerce(d.dietId, codeCandidates('diet'));
    if (!value) { rejected.push({ input: d.dietId, reason: 'no catalog match', closest }); continue; }
    const strictness = isStrictness(d.strictness) ? d.strictness : 'strict';
    if (!diets.some((x) => x.dietId === value)) diets.push({ dietId: value, strictness });
    saved.diets = (saved.diets as string[] | undefined ?? []).concat(value);
  }

  const ownedEquipment = [...current.ownedEquipment];
  for (const e of patch.owned_equipment ?? []) {
    const { value, closest } = coerce(e, codeCandidates('equipment'));
    if (!value) { rejected.push({ input: e, reason: 'no catalog match', closest }); continue; }
    if (!ownedEquipment.includes(value as never)) ownedEquipment.push(value as never);
    saved.owned_equipment = (saved.owned_equipment as string[] | undefined ?? []).concat(value);
  }

  const update: PreferencesUpdate = {
    skillLevel: current.skillLevel,
    weeklyBudgetCents: current.weeklyBudgetCents,
    timeBudgetMinutes: current.timeBudgetMinutes,
    timeByMeal: current.timeByMeal,
    weeklyMeals: current.weeklyMeals,
    ...foodPrefsToLikesDislikes(current),
    allergens,
    diets,
    ownedEquipment,
    groceryStores: current.groceryStores,
    household: current.household,
    eatsLeftovers: current.eatsLeftovers,
  };
  await ctx.memberPrefs.savePreferences(member_user_id, update);
  return { saved, rejected };
}

export const saveMemberProfileTool = createTool({
  id: 'save_member_profile',
  description:
    "Save one household member's profile (allergens, diets, equipment). Allergens require an " +
    "explicit confirmation and a severity before they are written (safety). Coerces values to " +
    'catalog ids; unmatched values are rejected with the nearest matches. Idempotent set-union.',
  inputSchema,
  execute: (input, ctx) => execute(input, ctx as unknown as ToolCtx),
});
