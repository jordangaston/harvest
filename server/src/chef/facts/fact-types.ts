import { eq } from 'drizzle-orm';
import type { Database } from '../../db.js';
import {
  GROCERY_STORES,
  GROCERY_SHOPPING_DAYS,
  MAJOR_ALLERGENS,
  ALLERGEN_SEVERITIES,
  DIET_STRICTNESS,
  DIFFICULTY_BANDS,
  GOALS,
  users,
  householdMembers,
} from '../../schema.js';
import { HouseholdPreferenceRepository } from '../../repositories/household-preference-repository.js';
import { PreferenceRepository } from '../../repositories/preference-repository.js';
import { UserRepository } from '../../repositories/user-repository.js';
import { TasteOptionsService, type TasteOptions } from '../../services/taste-options-service.js';
import { BaseIngredientResolver } from '../../nutrition/base-ingredient-resolver.js';
import { WeeklyMealsSchema, TimeByMealSchema } from '../../models/user-preferences.js';
import { coerce, codeCandidates, labelFor, parseBudgetCents, type Candidate } from '../tools/catalog.js';
import { resolveEquipment } from '../tools/equipment-grounding.js';
import type { FactType, Flavor, Subject, Tx, TypeDoc, ValidateResult, ValuePage } from './fact-type.js';
import { mergeMemberFact } from './member-persist.js';

/** A member subject's user id, or throws for a household subject (a member type mis-routed). */
function memberId(subject: Subject): string {
  if (subject.scope !== 'member') throw new Error(`expected member subject, got ${subject.scope}`);
  return subject.userId;
}

/** A household subject's id, or throws for a member subject. */
function householdId(subject: Subject): string {
  if (subject.scope !== 'household') throw new Error(`expected household subject, got ${subject.scope}`);
  return subject.householdId;
}

// ── enum ────────────────────────────────────────────────────────────────────

/**
 * A closed vocabulary the model must land on. `validate`/`normalize` coerce loose phrasing to a
 * legal id via the shared `coerce`; a miss rejects with the nearest ids as `closest`.
 */
abstract class EnumType implements FactType {
  protected abstract readonly candidates: Candidate[];
  // A store/goal id enumerates like an enum but reads as a `catalog` flavor to the model.
  constructor(readonly name: string, private readonly description: string, readonly flavor: Flavor = 'enum') {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: this.description, values: this.candidates };
  }
  search(query: string): ValuePage {
    const slug = query.trim();
    if (!slug) return { values: this.candidates };
    const { value } = coerce(query, this.candidates);
    return { values: this.candidates.filter((c) => (value ? c.value === value : c.value.includes(slug))) };
  }
  validate(value: unknown): ValidateResult {
    if (typeof value !== 'string') return { ok: false, reason: `${this.name} needs a string` };
    const { value: id, closest } = coerce(value, this.candidates);
    return id ? { ok: true } : { ok: false, reason: `${this.name}: no match for "${value}"`, closest };
  }
  normalize(value: unknown): string {
    return coerce(String(value), this.candidates).value!;
  }
  abstract persist(subject: Subject, value: unknown, tx: Tx): Promise<void>;
  abstract read(subject: Subject): Promise<unknown>;
}

class GroceryShoppingDayType extends EnumType {
  protected readonly candidates = GROCERY_SHOPPING_DAYS.map((value) => ({ value, label: labelFor(value) }));
  constructor(private readonly prefs: HouseholdPreferenceRepository) {
    super('GROCERY_SHOPPING_DAY', 'The weekday the household shops for groceries.');
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { groceryShoppingDay: this.normalize(value) as never });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).groceryShoppingDay;
  }
}

class SkillLevelType extends EnumType {
  protected readonly candidates = DIFFICULTY_BANDS.map((value) => ({ value, label: labelFor(value) }));
  constructor(private readonly prefs: PreferenceRepository) {
    super('SKILL_LEVEL', "A member's cooking skill: beginner, intermediate, or advanced.");
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await mergeMemberFact(this.prefs, memberId(subject), () => ({ skillLevel: this.normalize(value) as never }));
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(memberId(subject))).skillLevel;
  }
}

// ── catalog ───────────────────────────────────────────────────────────────

/** A store id (via the GROCERY_STORES vocab). Persists to the household's `grocery_stores` array. */
class GroceryStoreType extends EnumType {
  protected readonly candidates = codeCandidates('store');
  constructor(private readonly prefs: HouseholdPreferenceRepository) {
    super('GROCERY_STORE', 'A grocery store the household shops at.', 'catalog');
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const hh = householdId(subject);
    const current = (await this.prefs.getPreferences(hh)).groceryStores ?? [];
    const next = [...new Set([...current, this.normalize(value) as string])];
    await this.prefs.savePreferences(hh, { groceryStores: next });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).groceryStores ?? [];
  }
}

/** Owned kitchen equipment, grounded through the app's equipment gazetteer (not a prefix rank). */
class OwnedEquipmentType implements FactType {
  readonly name = 'OWNED_EQUIPMENT';
  readonly flavor = 'catalog' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'A kitchen appliance the household owns.', values: codeCandidates('equipment') };
  }
  search(query: string): ValuePage {
    const matched = resolveEquipment(query);
    return { values: matched.map((value) => ({ value, label: labelFor(value) })) };
  }
  validate(value: unknown): ValidateResult {
    if (typeof value !== 'string') return { ok: false, reason: 'OWNED_EQUIPMENT needs a string' };
    return resolveEquipment(value).length ? { ok: true } : { ok: false, reason: `OWNED_EQUIPMENT: no match for "${value}"` };
  }
  normalize(value: unknown): string[] {
    return resolveEquipment(String(value));
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const hh = householdId(subject);
    const current = ((await this.prefs.getPreferences(hh)).ownedEquipment ?? []) as string[];
    const next = [...new Set([...current, ...this.normalize(value)])];
    await this.prefs.savePreferences(hh, { ownedEquipment: next as never });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).ownedEquipment ?? [];
  }
}

/** The household's cooking goals, fanned out onto EVERY member's `users.goals` (the goal set is
 *  household-wide; `PreferenceRepository.coldStart` reads it to seed ranking weights). */
class GoalType extends EnumType {
  protected readonly candidates = GOALS.map((value) => ({ value, label: labelFor(value) }));
  constructor(private readonly db: Database) {
    super('GOAL', 'A household cooking goal (e.g. eat_healthier, quick_meals).', 'catalog');
  }
  async persist(subject: Subject, value: unknown, tx: Tx): Promise<void> {
    const hh = householdId(subject);
    const goal = this.normalize(value) as (typeof GOALS)[number];
    const members = await tx
      .select({ id: users.id, goals: users.goals })
      .from(users)
      .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, hh));
    for (const m of members) {
      const merged = Array.from(new Set([...(m.goals ?? []), goal])) as (typeof GOALS)[number][];
      await tx.update(users).set({ goals: merged }).where(eq(users.id, m.id));
    }
  }
  async read(subject: Subject): Promise<unknown> {
    const rows = await this.db
      .select({ goals: users.goals })
      .from(users)
      .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId(subject)));
    // Household-wide goals are unioned onto every member, so any member's set represents it.
    return rows[0]?.goals ?? [];
  }
}

// ── scalar ────────────────────────────────────────────────────────────────

/** The weekly grocery budget, parsed from a fuzzy money phrase to whole cents. */
class WeeklyBudgetCentsType implements FactType {
  readonly name = 'WEEKLY_BUDGET_CENTS';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'The weekly grocery budget.', rule: 'a dollar amount (e.g. "$120") → whole cents' };
  }
  validate(value: unknown): ValidateResult {
    return parseBudgetCents(value as string | number) === null ? { ok: false, reason: `${this.name}: not a budget amount` } : { ok: true };
  }
  normalize(value: unknown): number {
    return parseBudgetCents(value as string | number)!;
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { weeklyBudgetCents: this.normalize(value) });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).weeklyBudgetCents;
  }
}

/** How many days a week the household cooks (a non-negative count). */
class CookDaysCountType implements FactType {
  readonly name = 'COOK_DAYS_COUNT';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'How many days a week the household cooks.', rule: 'a non-negative whole number of days' };
  }
  validate(value: unknown): ValidateResult {
    return Number.isInteger(value) && (value as number) >= 0 ? { ok: true } : { ok: false, reason: `${this.name}: needs a non-negative whole number` };
  }
  normalize(value: unknown): number {
    return value as number;
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { cookDaysCount: this.normalize(value) });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).cookDaysCount;
  }
}

/** Whether the household eats leftovers (a boolean). */
class EatsLeftoversType implements FactType {
  readonly name = 'EATS_LEFTOVERS';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'Whether the household eats leftovers.', rule: 'true or false' };
  }
  validate(value: unknown): ValidateResult {
    return typeof value === 'boolean' ? { ok: true } : { ok: false, reason: `${this.name}: needs true or false` };
  }
  normalize(value: unknown): boolean {
    return value as boolean;
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { eatsLeftovers: this.normalize(value) });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).eatsLeftovers;
  }
}

/** Per-meal counts to plan each week ({ dinner: 5, … }); missing meals default to 0. */
class WeeklyMealsType implements FactType {
  readonly name = 'WEEKLY_MEALS';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'How many of each meal to plan per week.', rule: 'an object like { breakfast, lunch, dinner, snack, kids } of non-negative counts' };
  }
  validate(value: unknown): ValidateResult {
    return WeeklyMealsSchema.safeParse(this.normalize(value)).success ? { ok: true } : { ok: false, reason: `${this.name}: needs per-meal counts` };
  }
  normalize(value: unknown): unknown {
    const v = (value ?? {}) as Record<string, number>;
    return { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0, ...dropNulls(v) };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { weeklyMeals: this.normalize(value) as never });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).weeklyMeals;
  }
}

/** Per-meal cook-time budget in minutes ({ dinner: 30 }); a partial lands (independent columns). */
class TimeByMealType implements FactType {
  readonly name = 'TIME_BY_MEAL';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'Per-meal cook-time budget in minutes.', rule: 'an object like { breakfast, lunch, dinner } of positive minutes' };
  }
  validate(value: unknown): ValidateResult {
    return TimeByMealSchema.safeParse(this.normalize(value)).success ? { ok: true } : { ok: false, reason: `${this.name}: needs positive per-meal minutes` };
  }
  normalize(value: unknown): unknown {
    const t = dropNulls((value ?? {}) as Record<string, number>);
    return { breakfast: t.breakfast ?? null, lunch: t.lunch ?? null, dinner: t.dinner ?? null };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    await this.prefs.savePreferences(householdId(subject), { timeByMeal: this.normalize(value) as never });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(householdId(subject))).timeByMeal;
  }
}

/** Drop null/undefined values from a flat object (the model emits null for absent meal slots). */
function dropNulls(obj: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as Record<string, number>;
}

/** Household headcount — DERIVED from adults + kids; `writeFact` rejects any write (read-only). */
class HouseholdSizeType implements FactType {
  readonly name = 'HOUSEHOLD_SIZE';
  readonly flavor = 'scalar' as const;
  constructor(private readonly prefs: HouseholdPreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'Household headcount (adults + kids). Read-only, derived.', rule: 'derived from household_adults + household_kids' };
  }
  validate(): ValidateResult {
    return { ok: false, reason: 'derived/read-only' };
  }
  normalize(value: unknown): unknown {
    return value;
  }
  async persist(): Promise<void> {
    throw new Error('HOUSEHOLD_SIZE is derived/read-only');
  }
  async read(subject: Subject): Promise<unknown> {
    const p = await this.prefs.getPreferences(householdId(subject));
    return p.householdAdults + p.householdKids;
  }
}

// ── member: name (scalar) ────────────────────────────────────────────────

/** A member's display name (a non-empty string). Persists via `UserRepository.setName`. */
class NameType implements FactType {
  readonly name = 'NAME';
  readonly flavor = 'scalar' as const;
  constructor(private readonly users: UserRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: "A member's display name.", rule: 'a non-empty name' };
  }
  validate(value: unknown): ValidateResult {
    return typeof value === 'string' && value.trim().length > 0 ? { ok: true } : { ok: false, reason: 'NAME: needs a non-empty name' };
  }
  normalize(value: unknown): string {
    return String(value).trim();
  }
  async persist(subject: Subject, value: unknown, tx: Tx): Promise<void> {
    await this.users.setName(memberId(subject), this.normalize(value), tx);
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.users.findById(memberId(subject)))?.name ?? null;
  }
}

// ── member: allergens (catalog + rich rule) ──────────────────────────────

/** The raw allergen value: a name plus the safety fields, or the no_allergens sentinel. */
type AllergenValue = { value?: string; severity?: string; confirmed?: boolean; no_allergens?: boolean };
const isSeverity = (s: unknown): s is (typeof ALLERGEN_SEVERITIES)[number] => ALLERGEN_SEVERITIES.includes(s as never);

/**
 * A member allergen — the safety gate: requires `confirmed:true` + a valid severity and grounds the
 * name to `MAJOR_ALLERGENS`. `{ no_allergens: true }` is the "member has none" sentinel (normalizes
 * to 'none', writes no row). Missing severity/confirmed reject with `missing`.
 */
class AllergenType implements FactType {
  readonly name = 'ALLERGEN';
  readonly flavor = 'catalog' as const;
  private readonly candidates = codeCandidates('allergen');
  constructor(private readonly prefs: PreferenceRepository) {}

  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'A member allergen; requires confirmed:true and a severity (mild|moderate|severe). Pass { no_allergens: true } for none.', values: this.candidates };
  }
  search(query: string): ValuePage {
    const { value } = coerce(query, this.candidates);
    return { values: value ? this.candidates.filter((c) => c.value === value) : this.candidates };
  }
  validate(value: unknown): ValidateResult {
    const v = (value ?? {}) as AllergenValue;
    if (v.no_allergens === true) return { ok: true };
    const missing: string[] = [];
    if (!isSeverity(v.severity)) missing.push('severity');
    if (v.confirmed !== true) missing.push('confirmed');
    if (missing.length) return { ok: false, reason: 'ALLERGEN requires severity ∈ {mild,moderate,severe} and confirmed:true', missing };
    const { value: id, closest } = coerce(String(v.value ?? ''), this.candidates);
    return id ? { ok: true } : { ok: false, reason: `ALLERGEN: no match for "${v.value}"`, closest };
  }
  normalize(value: unknown): unknown {
    const v = (value ?? {}) as AllergenValue;
    if (v.no_allergens === true) return 'none';
    return { allergen: coerce(String(v.value ?? ''), this.candidates).value!, severity: v.severity };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const normalized = this.normalize(value);
    if (normalized === 'none') return; // "no allergies" is real data with nothing to write
    const { allergen, severity } = normalized as { allergen: string; severity: string };
    await mergeMemberFact(this.prefs, memberId(subject), (current) => ({
      allergens: current.allergens.some((a) => a.allergen === allergen)
        ? current.allergens
        : [...current.allergens, { allergen: allergen as never, severity: severity as never }],
    }));
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(memberId(subject))).allergens;
  }
}

// ── member: diets (catalog + strictness) ─────────────────────────────────

/** The raw diet value: an id/phrasing plus optional strictness. */
type DietValue = { value?: string; dietId?: string; strictness?: string };
const isStrictness = (s: unknown): s is (typeof DIET_STRICTNESS)[number] => DIET_STRICTNESS.includes(s as never);

/** A member diet, grounded to the `DIET_RULES` ids, carrying a strictness (default `strict`). */
class DietType implements FactType {
  readonly name = 'DIET';
  readonly flavor = 'catalog' as const;
  private readonly candidates = codeCandidates('diet');
  constructor(private readonly prefs: PreferenceRepository) {}

  private idOf(value: unknown): string {
    const v = (value ?? {}) as DietValue;
    return String(v.dietId ?? v.value ?? '');
  }
  describe(): TypeDoc {
    return { name: this.name, flavor: this.flavor, description: 'A member diet with a strictness (strict|flexible).', values: this.candidates };
  }
  search(query: string): ValuePage {
    const { value } = coerce(query, this.candidates);
    return { values: value ? this.candidates.filter((c) => c.value === value) : this.candidates };
  }
  validate(value: unknown): ValidateResult {
    const { value: id, closest } = coerce(this.idOf(value), this.candidates);
    return id ? { ok: true } : { ok: false, reason: `DIET: no match for "${this.idOf(value)}"`, closest };
  }
  normalize(value: unknown): unknown {
    const v = (value ?? {}) as DietValue;
    return { dietId: coerce(this.idOf(value), this.candidates).value!, strictness: isStrictness(v.strictness) ? v.strictness : 'strict' };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const { dietId, strictness } = this.normalize(value) as { dietId: string; strictness: string };
    await mergeMemberFact(this.prefs, memberId(subject), (current) => ({
      diets: current.diets.some((d) => d.dietId === dietId) ? current.diets : [...current.diets, { dietId, strictness: strictness as never }],
    }));
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(memberId(subject))).diets;
  }
}

// ── member: food preferences (catalog, faceted, DB-backed grounding) ──────

/** The raw food-pref value: a facet, a value the matcher grounds, and its two orthogonal axes. */
type FoodPrefValue = { facet?: string; value?: string; sentiment?: string; target?: number; reason?: string };
const FOOD_FACETS = ['cuisine', 'dish_type', 'ingredient', 'food_category'] as const;
const isFoodFacet = (f: unknown): f is (typeof FOOD_FACETS)[number] => FOOD_FACETS.includes(f as never);
const isSentiment = (s: unknown): s is 'like' | 'dislike' => s === 'like' || s === 'dislike';

/**
 * A member food preference over a `facet`, carrying two orthogonal axes: `sentiment` (taste:
 * like/dislike) and `target` (intent: −1 eat-less … +1 eat-more), plus a `reason`. Taste facets
 * (cuisine/dish_type/ingredient) require `sentiment`; `food_category` requires a `target` (moderation
 * is a food_category row with a negative target). Grounded per facet: cuisine/dish_type coerce onto
 * the code VOCAB, ingredient runs the tuned string→FDC→base-cluster matcher ("salmon"→Fish),
 * food_category coerces against FOOD_CLASSES. Writes land through the targeted `upsertFoodPref`.
 */
class FoodPreferenceType implements FactType {
  readonly name = 'FOOD_PREFERENCE';
  readonly flavor = 'catalog' as const;
  private readonly foodCategories = codeCandidates('food_category');
  constructor(
    private readonly prefs: PreferenceRepository,
    private readonly taste: TasteOptionsService,
    private readonly ingredients: BaseIngredientResolver,
  ) {}

  describe(): TypeDoc {
    return {
      name: this.name,
      flavor: this.flavor,
      description:
        'A member food preference: { facet: cuisine|dish_type|ingredient|food_category, value, ' +
        'sentiment?: like|dislike, target?: -1..1, reason? }. A taste facet needs sentiment; ' +
        'food_category needs a target (negative = eat less).',
    };
  }
  async search(query: string): Promise<ValuePage> {
    const opts = await this.taste.options();
    const q = query.toLowerCase();
    const all = [...opts.cuisines, ...opts.dish_types, ...opts.ingredients, ...this.foodCategories];
    return { values: all.filter((c) => c.value.includes(q) || c.label.toLowerCase().includes(q)).map((c) => ({ value: c.value, label: c.label })) };
  }
  validate(value: unknown): ValidateResult {
    const v = (value ?? {}) as FoodPrefValue;
    if (!isFoodFacet(v.facet)) return { ok: false, reason: `${this.name}: facet must be cuisine, dish_type, ingredient, or food_category` };
    if (!v.value) return { ok: false, reason: `${this.name}: needs a value` };
    if (v.facet === 'food_category') {
      if (typeof v.target !== 'number' || v.target < -1 || v.target > 1) return { ok: false, reason: 'food_category requires target (-1..1)' };
      return { ok: true };
    }
    if (!isSentiment(v.sentiment)) return { ok: false, reason: `${v.facet} requires sentiment like|dislike` };
    return { ok: true };
  }
  /** Grounding hits the DB, so it lives in `persist`; `normalize` just shapes the input. */
  normalize(value: unknown): unknown {
    const v = (value ?? {}) as FoodPrefValue;
    return { facet: v.facet, value: v.value, sentiment: v.sentiment ?? null, target: v.target ?? null, reason: v.reason ?? null };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const v = this.normalize(value) as { facet: (typeof FOOD_FACETS)[number]; value: string; sentiment: 'like' | 'dislike' | null; target: number | null; reason: string | null };
    const grounded = await this.ground(v.facet, v.value);
    if (!grounded) throw new Error(`${this.name}: no catalog match for "${v.value}"`);
    await this.prefs.upsertFoodPref(memberId(subject), { facet: v.facet, value: grounded, sentiment: v.sentiment, target: v.target, reason: v.reason });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(memberId(subject))).foodPrefs;
  }

  /** Grounds one value to its catalog id per facet, reusing each facet's tuned resolution path. */
  private async ground(facet: (typeof FOOD_FACETS)[number], value: string): Promise<string | null> {
    if (facet === 'food_category') return coerce(value, this.foodCategories).value ?? null;
    const opts = await this.taste.options();
    if (facet === 'ingredient') {
      const known = opts.ingredients.find((i) => i.value === value);
      if (known) return known.value;
      const base = await this.ingredients.resolve(value);
      return base ? base.id : null;
    }
    const cands = facet === 'cuisine' ? opts.cuisines : opts.dish_types;
    return coerce(value, cands).value ?? null;
  }
}

/** The fact-type registry: name → FactType, wired with the caller's db + reused services. */
export class FactTypeRegistry {
  private constructor(private readonly types: Map<string, FactType>) {}

  static create(db: Database): FactTypeRegistry {
    const hh = HouseholdPreferenceRepository.create(db);
    const member = PreferenceRepository.create(db);
    const userRepo = UserRepository.create(db);
    const taste = TasteOptionsService.create(db);
    const ingredients = BaseIngredientResolver.create(db);
    const types: FactType[] = [
      new GroceryStoreType(hh),
      new GroceryShoppingDayType(hh),
      new WeeklyBudgetCentsType(hh),
      new WeeklyMealsType(hh),
      new TimeByMealType(hh),
      new CookDaysCountType(hh),
      new EatsLeftoversType(hh),
      new OwnedEquipmentType(hh),
      new GoalType(db),
      new HouseholdSizeType(hh),
      new NameType(userRepo),
      new AllergenType(member),
      new DietType(member),
      new FoodPreferenceType(member, taste, ingredients),
      new SkillLevelType(member),
    ];
    return new FactTypeRegistry(new Map(types.map((t) => [t.name, t])));
  }

  get(name: string): FactType | undefined {
    return this.types.get(name);
  }
  list(): { name: string; flavor: string; description: string }[] {
    return [...this.types.values()].map((t) => {
      const doc = t.describe();
      return { name: doc.name, flavor: doc.flavor, description: doc.description };
    });
  }
}
