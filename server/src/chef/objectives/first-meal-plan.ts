import type { TaskSpec } from '../objective-repository.js';

/** Task keys for the first-meal-plan objective — stable handles the seeding + tests address. */
export const GENERATE_KEY = 'mealplan.generate';
export const FEEDBACK_KEY = 'mealplan.feedback';
export const CONFIRM_KEY = 'mealplan.confirm';

const req = true;

/**
 * The first-meal-plan objective: Sage generates the household's first week, elicits feedback, revises
 * by user-driven search-and-pick (the mealplan tools, called as often as needed — not tasks), and
 * gets a final confirmation. The revision loop is durable plan state, not tasks; only three tasks
 * bound the objective:
 * - `generate` (required emit): call mealplan__generate and present the plan.
 * - `feedback` (required fact-less elicit): "anything you'd change?" — "no/looks good" fills it.
 * - `confirm` (required fact-less elicit, gated after feedback): the final sign-off; filling it
 *   completes and pops the objective.
 * The two elicits carry a `fact` label (for the briefing) but no `factType`, so `tasks__update` fills
 * them with no fact write.
 */
export function firstMealPlanTaskSpecs(): TaskSpec[] {
  return [
    // generate LEADS (an emit that feedback follows) — the `after` on feedback marks it a leading emit,
    // so loadActive's trailing-emit gate doesn't hold it behind the elicits.
    { key: GENERATE_KEY, kind: 'emit', scope: 'household', required: req },
    { key: FEEDBACK_KEY, kind: 'elicit', fact: FEEDBACK_KEY, scope: 'household', required: req, after: [GENERATE_KEY] },
    { key: CONFIRM_KEY, kind: 'elicit', fact: CONFIRM_KEY, scope: 'household', required: req, after: [FEEDBACK_KEY] },
  ];
}

/** The tools resident in the first-meal-plan prompt: the four mealplan tools + fact read + task
 *  update + import (drop-a-recipe still works). `chat__send` is always present, so it is not listed. */
const FIRST_MEAL_PLAN_TOOLS = [
  'mealplan__generate',
  'mealplan__slot_options',
  'mealplan__add_recipe_to_slot',
  'mealplan__remove_recipe_from_slot',
  'facts__read',
  'tasks__update',
  'recipes__import',
];

/** The first-meal-plan objective definition, keyed by `objectives.definition`. Seeded suspended under
 *  onboarding, so onboarding's pop lands on it. */
export const firstMealPlanObjective = {
  id: 'first_meal_plan',
  instructions:
    "Goal: give this household their first week of meals and land it. Work the three tasks in order.\n" +
    '- generate: call mealplan__generate once, then present the week warmly — the mains, and a note on ' +
    'any sides. Do not list every macro; a couple of highlights. Fill the generate task via tasks__update ' +
    'once you have delivered it.\n' +
    '- feedback: ask if there is anything they would change. If they want a swap, use mealplan__slot_options ' +
    'with their criteria (an ingredient, a time cap), let them pick, and place it with ' +
    'mealplan__add_recipe_to_slot (drop one with remove_recipe_from_slot). They can ask for more options ' +
    '(call slot_options again, excluding what you already showed). When they are happy or say nothing to ' +
    'change, fill the feedback task.\n' +
    '- confirm: get a final "looks good" and fill the confirm task — that completes the plan.',
  tools: FIRST_MEAL_PLAN_TOOLS,
};
