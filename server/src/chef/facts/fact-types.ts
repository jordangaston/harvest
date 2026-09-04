import type { Database } from '../../db.js';
import {
  GROCERY_STORES,
  GROCERY_SHOPPING_DAYS,
  MAJOR_ALLERGENS,
  ALLERGEN_SEVERITIES,
  DIET_STRICTNESS,
  DIFFICULTY_BANDS,
  GOALS,
  DIRECTIVE_SCOPES,
  DIRECTIONS,
  STRENGTHS,
  type DirectiveScope,
  type Direction,
  type Strength,
} from '../../schema.js';
import { HouseholdPreferenceRepository } from '../../repositories/household-preference-repository.js';
import { HouseholdRepository } from '../../repositories/household-repository.js';
import { PreferenceRepository } from '../../repositories/preference-repository.js';
import { UserRepository } from '../../repositories/user-repository.js';
import { TasteOptionsService, type TasteOptions } from '../../services/taste-options-service.js';
import { BaseIngredientResolver } from '../../nutrition/base-ingredient-resolver.js';
import { WeeklyMealsSchema, TimeByMealSchema } from '../../models/user-preferences.js';
import { coerce, codeCandidates, labelFor, parseBudgetCents, rank, type Candidate } from '../tools/catalog.js';
import { resolveEquipment } from '../tools/equipment-grounding.js';
import type { FactType, Flavor, Subject, Tx, TypeDoc, ValidateResult, ValuePage } from './fact-type.js';

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
    if (!query.trim()) return { values: this.candidates };
    const { value } = coerce(query, this.candidates);
    // A strong coerce hit returns just that id; otherwise rank the catalog by fuzzy score (sorted,
    // near-misses kept) so a misspelled query still surfaces its nearest legal values.
    return { values: value ? this.candidates.filter((c) => c.value === value) : rank(query, this.candidates) };
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
    await this.prefs.setSkillLevel(memberId(subject), this.normalize(value) as (typeof DIFFICULTY_BANDS)[number]);
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
 *  household-wide; `PreferenceRepository.coldStart` reads it to seed ranking weights). The member
 *  fan-out is the repository's job — this type only grounds the goal id. */
class GoalType extends EnumType {
  protected readonly candidates = GOALS.map((value) => ({ value, label: labelFor(value) }));
  constructor(private readonly households: HouseholdRepository) {
    super('GOAL', 'A household cooking goal (e.g. eat_healthier, quick_meals).', 'catalog');
  }
  async persist(subject: Subject, value: unknown, tx: Tx): Promise<void> {
    await this.households.addHouseholdGoal(householdId(subject), this.normalize(value) as (typeof GOALS)[number], tx);
  }
  async read(subject: Subject): Promise<unknown> {
    return this.households.householdGoals(householdId(subject));
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
type AllergenValue = { value?: string; allergen?: string; name?: string; severity?: string; confirmed?: boolean; no_allergens?: boolean };
/** The allergen id, read forgivingly from the field the model most naturally reaches for. */
const allergenId = (v: AllergenValue): string => String(v.value ?? v.allergen ?? v.name ?? '');
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
    return { name: this.name, flavor: this.flavor, description: 'A member allergen. Value: { value: <one of the listed allergens>, confirmed: true, severity: mild|moderate|severe }; or { no_allergens: true } for none.', values: this.candidates };
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
    const { value: id, closest } = coerce(allergenId(v), this.candidates);
    return id ? { ok: true } : { ok: false, reason: `ALLERGEN: no match for "${allergenId(v)}"`, closest };
  }
  normalize(value: unknown): unknown {
    const v = (value ?? {}) as AllergenValue;
    if (v.no_allergens === true) return 'none';
    return { allergen: coerce(allergenId(v), this.candidates).value!, severity: v.severity };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const normalized = this.normalize(value);
    if (normalized === 'none') return; // "no allergies" is real data with nothing to write
    const { allergen, severity } = normalized as { allergen: (typeof MAJOR_ALLERGENS)[number]; severity: (typeof ALLERGEN_SEVERITIES)[number] };
    await this.prefs.upsertAllergen(memberId(subject), { allergen, severity });
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
    return { name: this.name, flavor: this.flavor, description: 'A member diet. Value: { value: <one of the listed diets>, strictness: strict|flexible }.', values: this.candidates };
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
    const { dietId, strictness } = this.normalize(value) as { dietId: string; strictness: (typeof DIET_STRICTNESS)[number] };
    await this.prefs.upsertDiet(memberId(subject), { dietId, strictness });
  }
  async read(subject: Subject): Promise<unknown> {
    return (await this.prefs.getPreferences(memberId(subject))).diets;
  }
}

// ── member: directives (catalog value + enum modifiers, DB-backed grounding) ──

/** The raw directive value: a dimension, a value the matcher grounds, and the enum/aggregate modifiers. */
type DirectiveValue = { dimension?: string; value?: string; scope?: string; direction?: string; strength?: string; target?: number; unit?: string; reason?: string };
/** The dimensions the chef may author (the server-owned `primary_ingredient` is excluded). */
const DIRECTIVE_FACETS = ['cuisine', 'dish_type', 'ingredient', 'food_category', 'nutrient'] as const;
const isDirectiveFacet = (d: unknown): d is (typeof DIRECTIVE_FACETS)[number] => DIRECTIVE_FACETS.includes(d as never);
const isScope = (s: unknown): s is DirectiveScope => DIRECTIVE_SCOPES.includes(s as never);
const isDirection = (d: unknown): d is Direction => DIRECTIONS.includes(d as never);
const isStrength = (s: unknown): s is Strength => STRENGTHS.includes(s as never);

/**
 * A member food directive: `{ dimension, value, scope?, direction, strength?, target?, unit?, reason? }`.
 * `value` is catalog-grounded per dimension (nutrient via NUTRIENT_IDS; cuisine/dish_type coerce onto the
 * code VOCAB; ingredient runs the tuned string→FDC→base-cluster matcher; food_category coerces against
 * FOOD_CLASSES). `scope`/`direction`/`strength` are fixed-enum validation. Persists the whole directive
 * through the targeted `upsertFoodPref` (default scope `recipe`, strength `soft`). Replaces the old
 * FOOD_PREFERENCE like/dislike fact — a like is `{direction:'more'}`, a dislike `{direction:'less'}`.
 */
class DirectiveType implements FactType {
  readonly name = 'FOOD_PREFERENCE';
  readonly flavor = 'catalog' as const;
  private readonly foodCategories = codeCandidates('food_category');
  private readonly nutrients = codeCandidates('nutrient');
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
        'A member food directive: { dimension: cuisine|dish_type|ingredient|food_category|nutrient, ' +
        'value, direction: more|less, scope?: recipe|breakfast|lunch|dinner|snack|day|week (default ' +
        'recipe), strength?: soft|firm|strict (default soft), target?: number, unit?: count|grams|…, ' +
        'reason? }. A like is direction:more, a dislike direction:less; an aggregate limit uses a ' +
        'day/week scope with target + unit. Pass ONE directive, or an ARRAY of them to record several preferences in one write.',
    };
  }
  async search(query: string): Promise<ValuePage> {
    const opts = await this.taste.options();
    const all = [...opts.cuisines, ...opts.dish_types, ...opts.ingredients, ...this.foodCategories, ...this.nutrients];
    // Fuzzy-rank rather than substring-match, so a plural or loose phrasing still lands ("tacos" -> taco).
    const ranked = rank(query, all).slice(0, 10);
    if (ranked.length) return { values: ranked.map((c) => ({ value: c.value, label: c.label })) };
    // No catalog hit — fall back to the ingredient resolver so lookups agree with the write path
    // (e.g. "salmon" rolls up to Fish). Without this the model sees "no match" and drops the value,
    // even though persist() would have grounded it.
    const base = await this.ingredients.resolve(query);
    return { values: base ? [{ value: base.label, label: base.label }] : [] };
  }
  // A directive value may be a single object or an array of them — a member states several
  // preferences at once ("Italian, tacos, salmon"), and read_facts returns a list, so the model
  // naturally batches. Both shapes are accepted; each element is validated/grounded/persisted on its own.
  validate(value: unknown): ValidateResult {
    const items = Array.isArray(value) ? value : [value];
    if (items.length === 0) return { ok: false, reason: `${this.name}: needs at least one directive` };
    for (const item of items) {
      const v = (item ?? {}) as DirectiveValue;
      if (!isDirectiveFacet(v.dimension)) return { ok: false, reason: `${this.name}: dimension must be cuisine, dish_type, ingredient, food_category, or nutrient` };
      if (!v.value) return { ok: false, reason: `${this.name}: needs a value` };
      if (!isDirection(v.direction)) return { ok: false, reason: `${this.name}: direction must be ${DIRECTIONS.join(' or ')}` };
      if (v.scope !== undefined && !isScope(v.scope)) return { ok: false, reason: `${this.name}: scope must be one of ${DIRECTIVE_SCOPES.join(', ')}` };
      if (v.strength !== undefined && !isStrength(v.strength)) return { ok: false, reason: `${this.name}: strength must be ${STRENGTHS.join(', ')}` };
    }
    return { ok: true };
  }
  /** Grounding hits the DB, so it lives in `persist`; `normalize` just shapes the input. */
  normalize(value: unknown): unknown {
    return Array.isArray(value) ? value.map((v) => this.normalizeOne(v)) : this.normalizeOne(value);
  }
  private normalizeOne(value: unknown) {
    const v = (value ?? {}) as DirectiveValue;
    return {
      dimension: v.dimension,
      value: v.value,
      scope: v.scope ?? 'recipe',
      direction: v.direction,
      strength: v.strength ?? 'soft',
      target: v.target ?? null,
      unit: v.unit ?? null,
      reason: v.reason ?? null,
    };
  }
  async persist(subject: Subject, value: unknown): Promise<void> {
    const items = (Array.isArray(value) ? value : [value]).map((v) => this.normalizeOne(v)) as {
      dimension: (typeof DIRECTIVE_FACETS)[number]; value: string; scope: DirectiveScope; direction: Direction; strength: Strength; target: number | null; unit: string | null; reason: string | null;
    }[];
    // Persist each directive independently: one off-catalog value shouldn't drop the rest. Ground and
    // write what we can, then throw naming the misses so the model gets instructive feedback while the
    // grounded ones are already saved (upsertFoodPref commits per call, not on the turn's tx).
    const unmatched: string[] = [];
    for (const v of items) {
      const grounded = await this.ground(v.dimension, v.value);
      if (!grounded) { unmatched.push(v.value); continue; }
      await this.prefs.upsertFoodPref(memberId(subject), { dimension: v.dimension, value: grounded, scope: v.scope, direction: v.direction, strength: v.strength, target: v.target, unit: v.unit, reason: v.reason });
    }
    if (unmatched.length) throw new Error(`${this.name}: no catalog match for ${unmatched.map((u) => `"${u}"`).join(', ')}`);
  }
  async read(subject: Subject): Promise<unknown> {
    const prefs = (await this.prefs.getPreferences(memberId(subject))).foodPrefs;
    if (!prefs.length) return prefs;
    // Stored `value` is the grounded catalog id (a UUID for ingredient; a slug elsewhere) — resolve
    // it back to the human label so the model reads "avocado", not an opaque id it can't reason over.
    const opts = await this.taste.options();
    const pools: Record<string, { value: string; label: string }[]> = {
      cuisine: opts.cuisines,
      dish_type: opts.dish_types,
      ingredient: opts.ingredients,
      food_category: this.foodCategories,
      nutrient: this.nutrients,
    };
    const labelOf = (dimension: string, value: string): string =>
      pools[dimension]?.find((c) => c.value === value)?.label ?? value;
    return prefs.map((p) => ({ ...p, value: labelOf(p.dimension, p.value) }));
  }

  /** Grounds one value to its catalog id per dimension, reusing each dimension's tuned resolution path. */
  private async ground(dimension: (typeof DIRECTIVE_FACETS)[number], value: string): Promise<string | null> {
    if (dimension === 'nutrient') return coerce(value, this.nutrients).value ?? null;
    if (dimension === 'food_category') return coerce(value, this.foodCategories).value ?? null;
    const opts = await this.taste.options();
    if (dimension === 'ingredient') {
      const known = opts.ingredients.find((i) => i.value === value);
      if (known) return known.value;
      const base = await this.ingredients.resolve(value);
      return base ? base.id : null;
    }
    const cands = dimension === 'cuisine' ? opts.cuisines : opts.dish_types;
    return coerce(value, cands).value ?? null;
  }
}

/** The fact-type registry: name → FactType, wired with the caller's db + reused services. */
export class FactTypeRegistry {
  private constructor(private readonly types: Map<string, FactType>) {}

  static create(db: Database): FactTypeRegistry {
    const hh = HouseholdPreferenceRepository.create(db);
    const households = HouseholdRepository.create(db);
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
      new GoalType(households),
      new HouseholdSizeType(hh),
      new NameType(userRepo),
      new AllergenType(member),
      new DietType(member),
      new DirectiveType(member, taste, ingredients),
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
