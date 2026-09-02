import type { TaskSpec } from '../objective-repository.js';
import type { ReplyPlan } from '../types.js';
import { FactRegistry } from '../facts/registry.js';

const req = true;

/** The stable key for the solo explainer-ack task — a fact-less elicit gating the rest of onboarding,
 *  confirmed by the user's next inbound (the consumer), not by a tool. */
export const EXPLAINER_ACK_KEY = 'explainer_ack';
/** The stable key for the close emit — a fact-less emit gated after every required elicit. */
export const CLOSE_EMIT_KEY = 'close';

/** The factType a registry key elicits, or undefined for a fact the registry doesn't know (e.g.
 *  `same_household`, which has no domain fact and is code-filled). */
function factTypeFor(key: string): string | undefined {
  return FactRegistry.get(key)?.factType;
}

/** A household-scoped elicit task, typed from the registry so `update_tasks` can route its fill. */
function hh(key: string, required = false, guidance?: string, extra: Partial<TaskSpec> = {}): TaskSpec {
  const fact = `household.${key}`;
  return { key: fact, kind: 'elicit', fact, factType: factTypeFor(fact), scope: 'household', required, guidance, ...extra };
}
/** A member-scoped elicit task template (memberUserId resolved per member at instantiation). */
function member(key: string, required = false, guidance?: string): TaskSpec {
  return { key, kind: 'elicit', fact: key, factType: factTypeFor(key), scope: 'member', required, guidance };
}

/**
 * The onboarding objective: guide a household through its cooking profile as a set of typed tasks.
 * A solo `explainer-ack` elicit runs first and gates the rest; the profile elicits are filled by the
 * model through `update_tasks`; the close is a required `emit` gated after every required elicit.
 * `same_household`/`household_size` are code-filled by the identity flow (not via `update_tasks`).
 * The model self-orchestrates the dialogue; it never sees a step list or cursor.
 */

/** The household-scoped task specs seeded when the objective is pushed onto a new thread. */
export function householdTaskSpecs(): TaskSpec[] {
  return [
    // The solo explainer-ack: fact-less, first, gating everything. Confirmed by the next inbound.
    { key: EXPLAINER_ACK_KEY, kind: 'elicit', scope: 'household', required: req, solo: true },
    // Code-filled identity tasks (SameKitchenFlow.establish, via markTaskFilled) — not model-fillable.
    { key: 'household.same_household', kind: 'elicit', fact: 'household.same_household', scope: 'household', required: req },
    { key: 'household.household_size', kind: 'elicit', fact: 'household.household_size', factType: 'HOUSEHOLD_SIZE', scope: 'household', required: req },
    // Model-filled household elicits.
    hh('goals'),
    hh('grocery_stores', req, 'Ground each store with fact_types(GROCERY_STORE, "<store>"); acknowledge and drop any it does not return.'),
    hh('grocery_shopping_day'),
    hh('weekly_budget_cents'),
    hh('weekly_meals', req),
    hh('cook_days_count', req),
    hh('time_by_meal'),
    hh('eats_leftovers'),
    hh('owned_equipment', false, 'Ground each item with fact_types(OWNED_EQUIPMENT, "<item>"); drop anything off-catalog.'),
    // The close: a required emit gated after every required elicit (delivered via the reply plan,
    // confirmed at send-time by the consumer).
    {
      key: CLOSE_EMIT_KEY,
      kind: 'emit',
      scope: 'household',
      required: req,
      after: ['household.same_household', 'household.household_size', 'household.grocery_stores', 'household.weekly_meals', 'household.cook_days_count'],
    },
  ];
}

/** The member-scoped task specs for one identified member (instantiated as they join). */
export function memberTaskSpecs(memberUserId: string): TaskSpec[] {
  return [
    member('name', req),
    member(
      'allergens',
      req,
      'If an allergen is named without a severity, ask mild/moderate/severe, then write it with confirmed:true ' +
        '(an unconfirmed allergen is never saved). If the member confirms none, write no_allergens:true — "none" ' +
        'fills this task. Restate a saved allergy as a consequence ("peanuts never enter this kitchen").',
    ),
    member('diets', false, 'If strictness is unstated, ask strict (never breaks it) or flexible (bends occasionally) before writing it through.'),
    member('likes', false, 'If a like is broad ("anything with chicken"), drill down (fajitas / creamy pasta / stir-fry?) and ground each value with fact_types(TASTE_LIKE, "<phrase>") before writing.'),
    member('dislikes'),
    member('skill_level'),
  ].map((t) => ({ ...t, memberUserId }));
}

/** Fill guidance keyed by the task's fact/key, for the briefing to render beside a task. Built from
 *  the seed specs (guidance is not persisted on the task row). */
export function taskGuidance(): Map<string, string> {
  const specs = [...householdTaskSpecs(), ...memberTaskSpecs('')];
  return new Map(specs.filter((s) => s.guidance).map((s) => [s.fact ?? s.key, s.guidance!]));
}

/** The tools resident in the onboarding prompt (the fact surface + identity + import). */
const ONBOARDING_TOOLS = ['read_facts', 'fact_types', 'update_facts', 'update_tasks', 'create_household', 'import_recipe'];

/** The onboarding objective definition, keyed by the `objectives.definition` string. Tasks are
 *  seeded via `householdTaskSpecs`/`memberTaskSpecs`; this carries the id, instructions, and tools. */
export const onboardingObjective = {
  id: 'onboarding',
  instructions:
    "Goal: learn this household's cooking profile — names, grocery stores, budget, cook days, allergies, " +
    'diets, tastes, and skill — filling each objective task through update_tasks by its [id], following the ' +
    "task's fill guidance. Discover a fact type's legal values or ground a loose phrase with fact_types. Ack " +
    'low-stakes answers with a tapback; never write a value the tools did not return. If a required task stays ' +
    'unanswered after the room moves on, send one reworded follow-up then state a default. When every required ' +
    'task is filled the close emit becomes eligible — deliver it (a celebration, "drop a recipe here anytime," ' +
    'and the promise of a first menu); the objective pops once its bubbles send.',
  tools: ONBOARDING_TOOLS,
};

/**
 * The completion close the response renders when the close `emit` is eligible: the celebration, the
 * drop-a-recipe invitation, and the first-menu promise. The reasoning model emits these intents; this
 * is the canonical plan the WI-08 eval asserts against and tests drive with.
 */
export const ONBOARDING_CLOSE: ReplyPlan = {
  intents: [
    { kind: 'confirm', fact: "That's everything — your kitchen is all set." },
    { kind: 'acknowledge', note: 'Drop a recipe link here anytime and I\'ll save it.' },
    { kind: 'hand_off', note: 'Give me a sec — I\'m cooking up your first menu.' },
  ],
  must_say: [],
};
