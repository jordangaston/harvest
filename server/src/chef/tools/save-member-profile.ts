import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce } from './catalog.js';
import { ALLERGEN_SEVERITIES, DIET_STRICTNESS } from '../../schema.js';
import { PreferenceRepository } from '../../repositories/preference-repository.js';
import type { PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  member_user_id: z.string(),
  patch: z
    .object({
      allergens: z
        .array(z.object({ allergen: z.string(), severity: z.string().nullish(), confirmed: z.boolean().nullish() }))
        .nullish(),
      diets: z.array(z.object({ dietId: z.string(), strictness: z.string().nullish() })).nullish(),
      owned_equipment: z.array(z.string()).nullish(),
    })
    .passthrough(),
});

type Input = z.infer<typeof inputSchema>;

const isSeverity = (s: unknown): s is (typeof ALLERGEN_SEVERITIES)[number] => ALLERGEN_SEVERITIES.includes(s as never);
const isStrictness = (s: unknown): s is (typeof DIET_STRICTNESS)[number] => DIET_STRICTNESS.includes(s as never);

/** Splits resolved foodPrefs back into the like/dislike arrays `savePreferences` rebuilds from. */
function foodPrefsToLikesDislikes(prefs: UserPreferences) {
  const likes = prefs.foodPrefs.filter((f) => f.sentiment === 'like').map((f) => ({ facet: f.facet, value: f.value }));
  const dislikes = prefs.foodPrefs.filter((f) => f.sentiment === 'dislike').map((f) => ({ facet: f.facet, value: f.value }));
  return { likes, dislikes };
}

/**
 * Read-merge-writes one member's profile: allergens/diets/equipment union into their existing sets
 * (idempotent). An allergen must carry `confirmed: true` and a valid severity to land (the safety
 * gate); unconfirmed or unmatched values are rejected, never written raw. Legal once the household
 * has members; membership is re-checked defensively per call.
 */
export class SaveMemberProfileTool implements ChefTool {
  readonly id = 'save_member_profile';
  readonly saved: SaveResult[] = [];
  private readonly memberPrefs: PreferenceRepository;

  private constructor(private readonly ctx: TurnContext) {
    this.memberPrefs = PreferenceRepository.create(ctx.db);
  }

  static create(ctx: TurnContext): SaveMemberProfileTool {
    return new SaveMemberProfileTool(ctx);
  }

  canRun(): boolean {
    return this.ctx.members.length > 0;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        "Save one household member's profile (allergens, diets, equipment) once they give it. Allergens " +
        'require an explicit confirmation and a severity (mild|moderate|severe) before they are written ' +
        '(safety). Each diet carries a strictness of "strict" or "flexible" — pass what the member said. ' +
        'Coerces values to catalog ids; unmatched values are rejected with the nearest matches. ' +
        'member_user_id is the member\'s id from the Household list.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run({ member_user_id, patch }: Input): Promise<SaveResult> {
    if (!this.ctx.members.some((m) => m.userId === member_user_id)) {
      return { saved: {}, rejected: [{ input: member_user_id, reason: 'member does not exist yet' }] };
    }

    const saved: Record<string, unknown> = {};
    const rejected: SaveResult['rejected'] = [];
    const current = await this.memberPrefs.getPreferences(member_user_id);

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
      if (e == null) continue;
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
    await this.memberPrefs.savePreferences(member_user_id, update);
    const result: SaveResult = { saved, rejected };
    this.saved.push(result);
    return result;
  }
}
