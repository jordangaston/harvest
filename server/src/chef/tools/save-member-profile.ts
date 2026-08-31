import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce, type Candidate } from './catalog.js';
import { ALLERGEN_SEVERITIES, DIET_STRICTNESS, DIFFICULTY_BANDS, type AffinityFacet } from '../../schema.js';
import { PreferenceRepository } from '../../repositories/preference-repository.js';
import { TasteOptionsService, type TasteOptions } from '../../services/taste-options-service.js';
import type { PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

// The picker exposes three affinity facets; a like/dislike names one and a value we ground to the
// taste catalog (cuisine/dish-type slugs, or a taste-ingredient id). primary_ingredient is not a
// user-pickable facet, so it is not offered here.
const FOOD_FACETS = ['cuisine', 'dish_type', 'ingredient'] as const;
type FoodFacet = (typeof FOOD_FACETS)[number];
const affinitySelection = z.object({ facet: z.enum(FOOD_FACETS), value: z.string() });

const inputSchema = z.object({
  member_user_id: z.string(),
  patch: z
    .object({
      allergens: z
        .array(z.object({ allergen: z.string(), severity: z.string().nullish(), confirmed: z.boolean().nullish() }))
        .nullish(),
      diets: z.array(z.object({ dietId: z.string(), strictness: z.string().nullish() })).nullish(),
      likes: z.array(affinitySelection).nullish(),
      dislikes: z.array(affinitySelection).nullish(),
      skill_level: z.enum(DIFFICULTY_BANDS).nullish(),
      owned_equipment: z.array(z.string()).nullish(),
    })
    .passthrough(),
});

type Input = z.infer<typeof inputSchema>;
type Selection = { facet: AffinityFacet; value: string };

const isSeverity = (s: unknown): s is (typeof ALLERGEN_SEVERITIES)[number] => ALLERGEN_SEVERITIES.includes(s as never);
const isStrictness = (s: unknown): s is (typeof DIET_STRICTNESS)[number] => DIET_STRICTNESS.includes(s as never);

/** Splits resolved foodPrefs back into the like/dislike selection arrays `savePreferences` rebuilds from. */
function foodPrefsToLikesDislikes(prefs: UserPreferences): { likes: Selection[]; dislikes: Selection[] } {
  const likes = prefs.foodPrefs.filter((f) => f.sentiment === 'like').map((f) => ({ facet: f.facet, value: f.value }));
  const dislikes = prefs.foodPrefs.filter((f) => f.sentiment === 'dislike').map((f) => ({ facet: f.facet, value: f.value }));
  return { likes, dislikes };
}

/** Union two selection lists, de-duped on (facet, value). */
function mergeSelections(a: Selection[], b: Selection[]): Selection[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((s) => {
    const key = `${s.facet}:${s.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Read-merge-writes one member's profile through its own `PreferenceRepository`: allergens/diets/
 * equipment, food likes/dislikes, and skill union into their existing sets (idempotent). An allergen
 * needs `confirmed: true` and a valid severity to land (the safety gate); likes/dislikes ground to
 * the taste catalog per facet — the value that lands feeds affinity ranking (`user_food_prefs`).
 * Legal once the household has members; membership is re-checked defensively per call.
 */
export class SaveMemberProfileTool implements ChefTool {
  readonly id = 'save_member_profile';
  readonly saved: SaveResult[] = [];
  private readonly memberPrefs: PreferenceRepository;
  private readonly taste: TasteOptionsService;

  private constructor(private readonly ctx: TurnContext) {
    this.memberPrefs = PreferenceRepository.create(ctx.db);
    this.taste = TasteOptionsService.create(ctx.db);
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
        "Save one household member's profile (allergens, diets, likes, dislikes, skill, equipment) once " +
        'they give it. Allergens require confirmed:true and a severity (mild|moderate|severe) before they ' +
        'are written (safety). Each diet carries a strictness of "strict" or "flexible". likes/dislikes ' +
        'are { facet: "cuisine"|"dish_type"|"ingredient", value } — ground the value with search_catalog ' +
        '(kind:"taste") first (e.g. "Thai" -> cuisine, "cilantro" -> ingredient). skill_level is ' +
        'beginner|intermediate|advanced. Unmatched values are rejected with the nearest matches. ' +
        "member_user_id is the member's id from the Household list.",
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

    // Food prefs ground per facet against the taste catalog; savePreferences rebuilds the like set
    // from what we pass, so merge new selections onto the member's existing ones.
    const currentFood = foodPrefsToLikesDislikes(current);
    const opts = (patch.likes?.length || patch.dislikes?.length) ? await this.taste.options() : null;
    const likes = mergeSelections(currentFood.likes, opts ? this.ground(patch.likes ?? [], opts, saved, 'likes', rejected) : []);
    const dislikes = mergeSelections(currentFood.dislikes, opts ? this.ground(patch.dislikes ?? [], opts, saved, 'dislikes', rejected) : []);

    const skillLevel = patch.skill_level ?? current.skillLevel;
    if (patch.skill_level) saved.skill_level = patch.skill_level;

    const update: PreferencesUpdate = {
      skillLevel,
      weeklyBudgetCents: current.weeklyBudgetCents,
      timeBudgetMinutes: current.timeBudgetMinutes,
      timeByMeal: current.timeByMeal,
      weeklyMeals: current.weeklyMeals,
      likes,
      dislikes,
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

  /** Grounds each {facet,value} against its taste facet catalog, recording landed ids under `savedKey`. */
  private ground(raw: { facet: FoodFacet; value: string }[], opts: TasteOptions, saved: Record<string, unknown>, savedKey: string, rejected: SaveResult['rejected']): Selection[] {
    const out: Selection[] = [];
    for (const sel of raw) {
      const { value, closest } = coerce(sel.value, this.candidatesFor(sel.facet, opts));
      if (!value) { rejected.push({ input: sel.value, reason: 'no catalog match', closest }); continue; }
      out.push({ facet: sel.facet, value });
      saved[savedKey] = (saved[savedKey] as string[] | undefined ?? []).concat(value);
    }
    return out;
  }

  private candidatesFor(facet: FoodFacet, opts: TasteOptions): Candidate[] {
    if (facet === 'cuisine') return opts.cuisines;
    if (facet === 'dish_type') return opts.dish_types;
    return opts.ingredients;
  }
}
