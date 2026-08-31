import type { SlotSpec } from '../objective-repository.js';
import type { ReplyPlan } from '../types.js';
import type { DefinitionSlot, ObjectiveDefinition } from './types.js';

const req = true;

/** A household-scoped definition slot, with optional fill guidance shown beside it. */
const slot = (key: string, required = false, guidance?: string): DefinitionSlot => ({ key: `household.${key}`, scope: 'household', required, guidance });
/** A member-scoped definition slot — instantiated per member as they are identified. */
const mslot = (key: string, required = false, guidance?: string): DefinitionSlot => ({ key, scope: 'member', required, guidance });

/**
 * The onboarding objective: guide a household through its cooking profile. It declares the
 * slots to fill, the three command tools, and condition-gated L2 guidance — never a
 * conversational path (no step list, no cursor). The model self-orchestrates the dialogue;
 * ObjectiveRepository seeds the household slots on push, and member slots are instantiated per
 * member as the "same kitchen" identity flow (onboarding-identity.ts) creates memberships.
 */
export const onboardingObjective: ObjectiveDefinition = {
  id: 'onboarding',
  instructions:
    "Goal: learn this household's cooking profile — names, grocery stores, budget, cook days, " +
    'allergies, diets, tastes, and skill — writing each answer through with a command tool, following ' +
    "each slot's fill guidance. Ack low-stakes answers with a tapback; never write a value the tools did " +
    'not return. If a required slot stays unanswered after the room moves on, send one reworded follow-up ' +
    'then state a default. Done when every required slot is filled or defaulted — then send the close: a ' +
    'celebration, "drop a recipe here anytime," and the promise of a first menu, and the objective pops.',
  tools: ['create_household', 'save_household_profile', 'save_household_goals', 'save_member_profile', 'search_catalog', 'import_recipe'],
  slots: [
    // household-scoped
    slot('same_household', req),
    slot('goals'),
    slot('grocery_stores', req, 'Ground each store with search_catalog; acknowledge and drop any it does not return.'),
    slot('grocery_shopping_day'),
    slot('weekly_budget_cents'),
    slot('household_size', req),
    slot('weekly_meals', req),
    slot('cook_days_count', req),
    slot('time_by_meal'),
    slot('eats_leftovers'),
    slot('owned_equipment', false, 'Ground each item with search_catalog; drop anything off-catalog.'),
    // member-scoped (one set per member)
    mslot('name', req),
    mslot(
      'allergens',
      req,
      'If an allergen is named without a severity, ask mild/moderate/severe, then write it with confirmed:true ' +
        '(an unconfirmed allergen is never saved). If the member confirms none, save no_allergens:true — "none" ' +
        'fills this slot. Restate a saved allergy as a consequence ("peanuts never enter this kitchen").',
    ),
    mslot('diets', false, 'If strictness is unstated, ask strict (never breaks it) or flexible (bends occasionally) before saving, and write it through.'),
    mslot('likes', false, 'If a like is broad ("anything with chicken"), drill down (fajitas / creamy pasta / stir-fry?) and ground each value with search_catalog before saving.'),
    mslot('dislikes'),
    mslot('skill_level'),
  ],
};

/** The member-scoped slot keys the onboarding definition declares, with their required flags. */
const MEMBER_SLOTS = onboardingObjective.slots.filter((s) => s.scope === 'member');

/** The household-scoped slot specs to seed when the objective is pushed onto a new thread. */
export function householdSlotSpecs(): SlotSpec[] {
  return onboardingObjective.slots
    .filter((s) => s.scope === 'household')
    .map((s) => ({ key: s.key, scope: 'household', required: s.required }));
}

/** The member-scoped slot specs for one identified member (instantiated as they join). */
export function memberSlotSpecs(memberUserId: string): SlotSpec[] {
  return MEMBER_SLOTS.map((s) => ({ key: s.key, scope: 'member', memberUserId, required: s.required }));
}

/**
 * The completion close the response renders when every required slot is terminal (AC-5):
 * the celebration, the drop-a-recipe invitation, and the first-menu promise. The reasoning
 * model emits these intents (steered by the last guidance pair); this is the canonical plan
 * the WI-08 eval asserts against and tests drive with.
 */
export const ONBOARDING_CLOSE: ReplyPlan = {
  intents: [
    { kind: 'confirm', fact: "That's everything — your kitchen is all set." },
    { kind: 'acknowledge', note: 'Drop a recipe link here anytime and I\'ll save it.' },
    { kind: 'hand_off', note: 'Give me a sec — I\'m cooking up your first menu.' },
  ],
  must_say: [],
};
