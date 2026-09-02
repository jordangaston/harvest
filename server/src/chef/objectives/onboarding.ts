import type { TaskSpec } from '../objective-repository.js';
import type { ReplyPlan } from '../types.js';
import type { DefinitionTask, ObjectiveDefinition } from './types.js';

const req = true;

/** A household-scoped definition task, with optional fill guidance shown beside it. */
const task = (key: string, required = false, guidance?: string): DefinitionTask => ({ key: `household.${key}`, scope: 'household', required, guidance });
/** A member-scoped definition task — instantiated per member as they are identified. */
const mtask = (key: string, required = false, guidance?: string): DefinitionTask => ({ key, scope: 'member', required, guidance });

/**
 * The onboarding objective: guide a household through its cooking profile. It declares the
 * tasks to pursue, the command tools, and condition-gated L2 guidance — never a
 * conversational path (no step list, no cursor). The model self-orchestrates the dialogue;
 * ObjectiveRepository seeds the household tasks on push, and member tasks are instantiated per
 * member as the "same kitchen" identity flow (onboarding-identity.ts) creates memberships.
 */
export const onboardingObjective: ObjectiveDefinition = {
  id: 'onboarding',
  instructions:
    "Goal: learn this household's cooking profile — names, grocery stores, budget, cook days, " +
    'allergies, diets, tastes, and skill — writing each answer through with a command tool, following ' +
    "each task's fill guidance. Ack low-stakes answers with a tapback; never write a value the tools did " +
    'not return. If a required task stays unanswered after the room moves on, send one reworded follow-up ' +
    'then state a default. Done when every required task is filled or defaulted — then send the close: a ' +
    'celebration, "drop a recipe here anytime," and the promise of a first menu, and the objective pops.',
  tools: ['create_household', 'save_household_profile', 'save_household_goals', 'save_member_profile', 'search_catalog', 'import_recipe'],
  tasks: [
    // household-scoped
    task('same_household', req),
    task('goals'),
    task('grocery_stores', req, 'Ground each store with search_catalog; acknowledge and drop any it does not return.'),
    task('grocery_shopping_day'),
    task('weekly_budget_cents'),
    task('household_size', req),
    task('weekly_meals', req),
    task('cook_days_count', req),
    task('time_by_meal'),
    task('eats_leftovers'),
    task('owned_equipment', false, 'Ground each item with search_catalog; drop anything off-catalog.'),
    // member-scoped (one set per member)
    mtask('name', req),
    mtask(
      'allergens',
      req,
      'If an allergen is named without a severity, ask mild/moderate/severe, then write it with confirmed:true ' +
        '(an unconfirmed allergen is never saved). If the member confirms none, save no_allergens:true — "none" ' +
        'fills this task. Restate a saved allergy as a consequence ("peanuts never enter this kitchen").',
    ),
    mtask('diets', false, 'If strictness is unstated, ask strict (never breaks it) or flexible (bends occasionally) before saving, and write it through.'),
    mtask('likes', false, 'If a like is broad ("anything with chicken"), drill down (fajitas / creamy pasta / stir-fry?) and ground each value with search_catalog before saving.'),
    mtask('dislikes'),
    mtask('skill_level'),
  ],
};

/** The member-scoped task keys the onboarding definition declares, with their required flags. */
const MEMBER_TASKS = onboardingObjective.tasks.filter((t) => t.scope === 'member');

/** The household-scoped task specs to seed when the objective is pushed onto a new thread. */
export function householdTaskSpecs(): TaskSpec[] {
  return onboardingObjective.tasks
    .filter((t) => t.scope === 'household')
    .map((t) => ({ key: t.key, kind: 'elicit', fact: t.key, scope: 'household', required: t.required }));
}

/** The member-scoped task specs for one identified member (instantiated as they join). */
export function memberTaskSpecs(memberUserId: string): TaskSpec[] {
  return MEMBER_TASKS.map((t) => ({ key: t.key, kind: 'elicit', fact: t.key, scope: 'member', memberUserId, required: t.required }));
}

/**
 * The completion close the response renders when every required task is terminal:
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
