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

/** The tools resident in the first-meal-plan prompt: the mealplan tools + the four grocery tools
 *  (the plan produces the list, so groceries are ambient here) + fact read + task update + import
 *  (drop-a-recipe still works). Groceries are RESIDENT, not discovered (DESIGN Q-02 — measured, four
 *  cheap tools). `first_meal_plan` is the only everyday stack objective today (onboarding is still
 *  profiling; meal_reminder is a chat-only announce shell), so it is the one place they belong.
 *  `chat__send` is always present, so it is not listed. */
const FIRST_MEAL_PLAN_TOOLS = [
  'mealplan__generate',
  'mealplan__slot_options',
  'mealplan__add_recipe_to_slot',
  'mealplan__remove_recipe_from_slot',
  'mealplan__set_reminder_time',
  'mealplan__set_reminder_enabled',
  'grocery__view',
  'grocery__add',
  'grocery__remove',
  'grocery__check',
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
    '- generate: call mealplan__generate once, then present the week: a short warm intro (dinners and ' +
    'lunches, a highlight or two), then send `plan_url` (one chat__send, type "richlink") — the whole week ' +
    'lands as a single tappable card they can browse, dinners first. Never list every recipe in prose; the ' +
    'card is the menu. Re-share `plan_url` whenever they ask what is planned. Fill the generate task via ' +
    'tasks__update once the card is out. Their grocery list is now stocked from the plan too — mention it ' +
    'in a line ("your grocery list\'s ready too — say \'what do we need\' anytime"); use grocery__view/add/' +
    'remove/check whenever they ask about groceries.\n' +
    '- feedback: ask if there is anything they would change. If they want a swap, use mealplan__slot_options ' +
    'with their criteria (an ingredient, a time cap), share each option as its card (send its `url`), let ' +
    'them pick, and place it with mealplan__add_recipe_to_slot (drop one with remove_recipe_from_slot). ' +
    'They can ask for more options (call slot_options again, excluding what you already showed). When they ' +
    'are happy or say nothing to change, fill the feedback task.\n' +
    '- confirm: get a final "looks good" and fill the confirm task — that completes the plan.',
  tools: FIRST_MEAL_PLAN_TOOLS,
};
