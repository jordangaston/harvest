import type { SlotSpec } from '../objective-store.js';
import type { ReplyPlan } from '../types.js';
import type { DefinitionSlot, ObjectiveDefinition } from './types.js';

const req = true;

/** A household-scoped definition slot. */
const slot = (key: string, required = false): DefinitionSlot => ({ key: `household.${key}`, scope: 'household', required });
/** A member-scoped definition slot — instantiated per member as they are identified. */
const mslot = (key: string, required = false): DefinitionSlot => ({ key, scope: 'member', required });

/**
 * The onboarding objective: guide a household through its cooking profile. It declares the
 * slots to fill, the three command tools, and condition-gated L2 guidance — never a
 * conversational path (no step list, no cursor). The model self-orchestrates the dialogue;
 * ObjectiveStore seeds the household slots on push, and member slots are instantiated per
 * member as the "same kitchen" identity flow (onboarding-identity.ts) creates memberships.
 */
export const onboardingObjective: ObjectiveDefinition = {
  id: 'onboarding',
  instructions:
    "Goal: learn this household's cooking profile — names, grocery stores, budget, cook days, " +
    'allergies, diets, tastes, and skill — writing each answer through with a command tool. ' +
    'Done when every required slot is filled or defaulted; then send the close.',
  tools: ['create_household', 'save_household_profile', 'save_member_profile', 'search_catalog'],
  slots: [
    // household-scoped
    slot('same_household', req),
    slot('goals'),
    slot('grocery_stores', req),
    slot('grocery_shopping_day'),
    slot('weekly_budget_cents'),
    slot('household_size', req),
    slot('weekly_meals', req),
    slot('cook_days_count', req),
    slot('time_by_meal'),
    slot('eats_leftovers'),
    slot('owned_equipment'),
    // member-scoped (one set per member)
    mslot('name', req),
    mslot('allergens', req),
    mslot('diets'),
    mslot('likes'),
    mslot('dislikes'),
    mslot('skill_level'),
  ],
  guidance: [
    {
      when: 'a member named an allergen without a severity',
      then: 'ask mild, moderate, or severe, then write the allergen only with confirmed:true — an unconfirmed allergen is never saved.',
    },
    {
      when: 'a member named a diet without saying how strictly they follow it',
      then: 'ask whether it is strict (never breaks it) or flexible (bends occasionally) before saving, and write that strictness through.',
    },
    {
      when: 'a like is broad ("anything with chicken")',
      then: 'drill down (fajitas / creamy pasta / stir-fry?) and ground each value with search_catalog before saving it.',
    },
    {
      when: 'a store, diet, or equipment answer is off-catalog',
      then: 'acknowledge it and drop it — never write a value the tools did not return.',
    },
    {
      when: 'a required slot is still unanswered after the room moved on',
      then: 'send one reworded follow-up, then state a default. For allergens use the safety-asymmetry voice: "I\'ll plan as if Sam has no allergies until he says otherwise."',
    },
    {
      when: 'an answer just landed',
      then: 'ack low-stakes answers with a tapback; for an allergy or diet restate the consequence explicitly ("peanuts never enter this kitchen") before moving on.',
    },
    {
      when: 'every required slot is filled or defaulted',
      then: 'send the close: a celebration, "drop a recipe here anytime," and the promise of a first menu — then the objective completes and pops.',
    },
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
