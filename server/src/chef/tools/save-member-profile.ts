import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { codeCandidates, coerce } from './catalog.js';
import { resolveEquipment } from './equipment-grounding.js';
import { ALLERGEN_SEVERITIES, DIET_STRICTNESS, DIFFICULTY_BANDS, SENTIMENTS, type AffinityFacet } from '../../schema.js';
import { PreferenceRepository } from '../../repositories/preference-repository.js';
import { TasteOptionsService, type TasteOptions } from '../../services/taste-options-service.js';
import { BaseIngredientResolver } from '../../nutrition/base-ingredient-resolver.js';
import type { FoodPrefUpdate, PreferencesUpdate, UserPreferences } from '../../models/user-preferences.js';
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
      no_allergens: z.boolean().nullish(),
      diets: z.array(z.object({ dietId: z.string(), strictness: z.string().nullish() })).nullish(),
      likes: z.array(affinitySelection).nullish(),
      dislikes: z.array(affinitySelection).nullish(),
      // Degreed food-class moderation ("trying to limit red meat"). `value` is a food class the
      // model grounds via search_catalog(food_category); `target` is the intent (−1 less … +1 more)
      // mapped from the NL degree ("trying to limit"≈−0.5, "cut way back"≈−0.9); optional `sentiment`
      // when the member states taste ("I love steak") and `reason` when they give a why.
      moderation: z
        .array(z.object({ value: z.string(), target: z.number().min(-1).max(1), sentiment: z.enum(SENTIMENTS).nullish(), reason: z.string().nullish() }))
        .nullish(),
      skill_level: z.enum(DIFFICULTY_BANDS).nullish(),
      owned_equipment: z.array(z.string()).nullish(),
    })
    .passthrough(),
});

type Input = z.infer<typeof inputSchema>;
type Selection = { facet: AffinityFacet; value: string };

const isSeverity = (s: unknown): s is (typeof ALLERGEN_SEVERITIES)[number] => ALLERGEN_SEVERITIES.includes(s as never);
const isStrictness = (s: unknown): s is (typeof DIET_STRICTNESS)[number] => DIET_STRICTNESS.includes(s as never);

/** Union food-pref rows de-duped on (facet, value) — the last write for a key wins so a fresh
 *  patch overrides the member's stored axes for that food class. */
function mergeFoodPrefs(existing: FoodPrefUpdate[], incoming: FoodPrefUpdate[]): FoodPrefUpdate[] {
  const byKey = new Map<string, FoodPrefUpdate>();
  for (const p of [...existing, ...incoming]) byKey.set(`${p.facet}:${p.value}`, p);
  return [...byKey.values()];
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
  private readonly ingredients: BaseIngredientResolver;

  private constructor(private readonly ctx: TurnContext) {
    this.memberPrefs = PreferenceRepository.create(ctx.db);
    this.taste = TasteOptionsService.create(ctx.db);
    this.ingredients = BaseIngredientResolver.create(ctx.db);
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
        'are written (safety); pass no_allergens:true when a member confirms they have none. Each diet ' +
        'carries a strictness of "strict" or "flexible". likes/dislikes are { facet: ' +
        '"cuisine"|"dish_type"|"ingredient", value } — pass the plain food word (e.g. "Thai" -> cuisine, ' +
        '"grilled chicken" -> ingredient); ingredient values are resolved against the food catalog for you. ' +
        'For a soft "eat more/less of a food class" (e.g. "trying to limit red meat"), use moderation: ' +
        '{ value: a food class like "red meat", target: -1..+1 (less..more; "trying to limit"~-0.5, ' +
        '"cut way back"~-0.9), sentiment?: like|dislike if they state taste, reason?: the why }. This is ' +
        'NOT a dislike — a member can like a food and still want less of it. ' +
        'skill_level is beginner|intermediate|advanced. Unmatched values are rejected. ' +
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
    // "No allergies" is real data — nothing to write, but echo 'none' so the required allergens
    // slot can flip on a value (a member with none is distinct from one not yet asked).
    if (patch.no_allergens === true && !allergens.length) saved.allergens = 'none';

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
      const matched = resolveEquipment(e);
      if (!matched.length) { rejected.push({ input: e, reason: 'no catalog match' }); continue; }
      for (const value of matched) {
        if (!ownedEquipment.includes(value as never)) ownedEquipment.push(value as never);
        saved.owned_equipment = (saved.owned_equipment as string[] | undefined ?? []).concat(value);
      }
    }

    // Food prefs ground per facet against the taste catalog; savePreferences upserts each element,
    // so merge new taste selections + moderations onto the member's existing unified foodPrefs.
    const opts = (patch.likes?.length || patch.dislikes?.length) ? await this.taste.options() : null;
    const tasteLikes = opts ? await this.ground(patch.likes ?? [], opts, saved, 'likes', rejected) : [];
    const tasteDislikes = opts ? await this.ground(patch.dislikes ?? [], opts, saved, 'dislikes', rejected) : [];
    const moderations = this.groundModeration(patch.moderation ?? [], saved, rejected);
    const incoming: FoodPrefUpdate[] = [
      ...tasteLikes.map((s) => ({ facet: s.facet, value: s.value, sentiment: 'like' as const })),
      ...tasteDislikes.map((s) => ({ facet: s.facet, value: s.value, sentiment: 'dislike' as const })),
      ...moderations,
    ];
    const foodPrefs = mergeFoodPrefs(current.foodPrefs, incoming);

    const skillLevel = patch.skill_level ?? current.skillLevel;
    if (patch.skill_level) saved.skill_level = patch.skill_level;

    const update: PreferencesUpdate = {
      skillLevel,
      weeklyBudgetCents: current.weeklyBudgetCents,
      timeBudgetMinutes: current.timeBudgetMinutes,
      timeByMeal: current.timeByMeal,
      weeklyMeals: current.weeklyMeals,
      foodPrefs,
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

  /** Grounds each moderation onto a food-class id (the same catalog matcher, floor 0.6) and emits
   *  a `food_category` foodPref carrying the intent target (+ optional taste/reason). An unmatched
   *  food class is rejected with nearest matches, like every other catalog write. */
  private groundModeration(raw: NonNullable<Input['patch']['moderation']>, saved: Record<string, unknown>, rejected: SaveResult['rejected']): FoodPrefUpdate[] {
    const out: FoodPrefUpdate[] = [];
    for (const m of raw) {
      const { value, closest } = coerce(m.value, codeCandidates('food_category'));
      if (!value) { rejected.push({ input: m.value, reason: 'no catalog match', closest }); continue; }
      out.push({ facet: 'food_category', value, target: m.target, sentiment: m.sentiment ?? null, reason: m.reason ?? null });
      saved.moderation = (saved.moderation as string[] | undefined ?? []).concat(value);
    }
    return out;
  }

  /** Grounds each {facet,value} to a catalog id, recording the landed display label under `savedKey`
   *  (a label, not an opaque id, so the reply can faithfully name what was saved). */
  private async ground(raw: { facet: FoodFacet; value: string }[], opts: TasteOptions, saved: Record<string, unknown>, savedKey: string, rejected: SaveResult['rejected']): Promise<Selection[]> {
    const out: Selection[] = [];
    for (const sel of raw) {
      const { value, label, closest } = await this.resolve(sel, opts);
      if (!value) { rejected.push({ input: sel.value, reason: 'no catalog match', closest }); continue; }
      out.push({ facet: sel.facet, value });
      saved[savedKey] = (saved[savedKey] as string[] | undefined ?? []).concat(label);
    }
    return out;
  }

  /**
   * Resolves one {facet,value} to its catalog id + display label. An `ingredient` value runs through
   * the shared food matcher (string → FDC food → base-ingredient cluster) — the same tuned path recipes
   * use, so "grilled chicken"→Chicken, "salmon"→Fish. cuisine/dish_type coerce onto the code VOCAB.
   */
  private async resolve(sel: { facet: FoodFacet; value: string }, opts: TasteOptions): Promise<{ value?: string; label: string; closest: string[] }> {
    if (sel.facet === 'ingredient') {
      // The value is either an already-grounded taste-ingredient id (from search_catalog) or free
      // text ("grilled chicken") — accept the id directly, else resolve the text through the matcher.
      const known = opts.ingredients.find((i) => i.value === sel.value);
      if (known) return { value: known.value, label: known.label, closest: [] };
      const base = await this.ingredients.resolve(sel.value);
      return base ? { value: base.id, label: base.label, closest: [] } : { label: sel.value, closest: [] };
    }
    const cands = sel.facet === 'cuisine' ? opts.cuisines : opts.dish_types;
    const { value, closest } = coerce(sel.value, cands);
    return { value, label: cands.find((c) => c.value === value)?.label ?? sel.value, closest };
  }
}
