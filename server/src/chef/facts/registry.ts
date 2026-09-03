/** How a fact may be written: `writable` accepts a value; `derived` is computed, read-only. */
export type Access = 'writable' | 'derived';

/** Whether a fact belongs to the household or an individual member. */
export type FactScope = 'household' | 'member';

/** A flat-file fact definition: a typed view over a domain-table value. Not a persisted row. */
export interface FactDef {
  key: string;
  description: string;
  factType: string;
  scope: FactScope;
  access: Access;
}

// The onboarding facts, keyed exactly as the onboarding objective addresses them: household facts
// are `household.*`; member facts are bare (`name`, `allergens`, …). Each names its FactType.
const DEFS: FactDef[] = [
  { key: 'household.grocery_stores', description: 'Where the household shops for groceries', factType: 'GROCERY_STORE', scope: 'household', access: 'writable' },
  { key: 'household.grocery_shopping_day', description: 'The weekday the household shops', factType: 'GROCERY_SHOPPING_DAY', scope: 'household', access: 'writable' },
  { key: 'household.weekly_budget_cents', description: 'The weekly grocery budget', factType: 'WEEKLY_BUDGET_CENTS', scope: 'household', access: 'writable' },
  { key: 'household.weekly_meals', description: 'How many of each meal to plan per week', factType: 'WEEKLY_MEALS', scope: 'household', access: 'writable' },
  { key: 'household.time_by_meal', description: 'Per-meal cook-time budget in minutes', factType: 'TIME_BY_MEAL', scope: 'household', access: 'writable' },
  { key: 'household.cook_days_count', description: 'How many days a week the household cooks', factType: 'COOK_DAYS_COUNT', scope: 'household', access: 'writable' },
  { key: 'household.eats_leftovers', description: 'Whether the household eats leftovers', factType: 'EATS_LEFTOVERS', scope: 'household', access: 'writable' },
  { key: 'household.owned_equipment', description: 'Kitchen equipment the household owns', factType: 'OWNED_EQUIPMENT', scope: 'household', access: 'writable' },
  { key: 'household.goals', description: "The household's cooking goals", factType: 'GOAL', scope: 'household', access: 'writable' },
  { key: 'household.household_size', description: 'Household headcount (adults + kids)', factType: 'HOUSEHOLD_SIZE', scope: 'household', access: 'derived' },
  { key: 'name', description: "A member's display name", factType: 'NAME', scope: 'member', access: 'writable' },
  { key: 'allergens', description: "A member's allergens", factType: 'ALLERGEN', scope: 'member', access: 'writable' },
  { key: 'diets', description: "A member's diets", factType: 'DIET', scope: 'member', access: 'writable' },
  { key: 'food_preferences', description: "A member's food directives — like/dislike (direction) and scoped moderation (target/unit) over a cuisine, dish_type, ingredient, food_category, or nutrient", factType: 'SET_DIRECTIVE', scope: 'member', access: 'writable' },
  { key: 'skill_level', description: "A member's cooking skill", factType: 'SKILL_LEVEL', scope: 'member', access: 'writable' },
];

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/**
 * The flat registry of onboarding facts — key → definition. Flat-file, not a persisted table.
 * Tools hold an instance via `static create()` (an instance field, not a static reach); the two
 * non-tool call sites (`factTypeFor` in the objective definition, the fact-def test) use the static
 * `get`/`list`, which read the same shared map.
 */
export class FactRegistry {
  static create(): FactRegistry {
    return new FactRegistry();
  }

  get(key: string): FactDef | undefined {
    return BY_KEY.get(key);
  }
  list(): FactDef[] {
    return DEFS;
  }

  static get(key: string): FactDef | undefined {
    return BY_KEY.get(key);
  }
  static list(): FactDef[] {
    return DEFS;
  }
}
