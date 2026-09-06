import { FACTORY_IDS } from '../tools/registry.js';

/**
 * The steady-state shell (chef-steady-state WI-01). NOT a stack objective — no `objectives` row of
 * this definition is ever created and it has no tasks. It is the turn shell for a thread whose
 * objectives are all terminal: the household planned their week and is done until they want something.
 * A steady-state turn answers conversationally with the FULL tool set (every registered factory,
 * `canRun`-gated as usual) and no objective to nudge — same shell-definition mechanism as
 * `meal-reminder.ts`.
 */
export const steadyStateObjective = {
  id: 'steady_state',
  instructions:
    "The household has finished setting up and planning their week — there's no active goal to drive, " +
    'just help with whatever they ask. Answer normally: read what\'s new, use whatever tools fit (browse ' +
    'or edit the plan, groceries, facts, import a recipe), and reply. No agenda, no nudging — if there\'s ' +
    'nothing to do, a short warm reply is enough.',
  tools: FACTORY_IDS,
};
