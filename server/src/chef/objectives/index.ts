import { onboardingObjective } from './onboarding.js';
import { firstMealPlanObjective } from './first-meal-plan.js';
import { reminderObjective } from './meal-reminder.js';
import { steadyStateObjective } from './steady-state.js';
import type { ObjectiveDefinition } from './types.js';

/** Every objective definition, keyed by the `objectives.definition` string. `meal_reminder` and
 *  `steady_state` are turn shells (no stack rows of them exist) — see `meal-reminder.ts` /
 *  `steady-state.ts`. */
const DEFINITIONS: Record<string, ObjectiveDefinition> = {
  [onboardingObjective.id]: onboardingObjective,
  [firstMealPlanObjective.id]: firstMealPlanObjective,
  [reminderObjective.id]: reminderObjective,
  [steadyStateObjective.id]: steadyStateObjective,
};

/** The definition for an objective row's `definition` string, or undefined if unregistered. */
export function objectiveDefinition(definition: string): ObjectiveDefinition | undefined {
  return DEFINITIONS[definition];
}

export type { ObjectiveDefinition } from './types.js';
export { householdTaskSpecs, memberTaskSpecs, ONBOARDING_CLOSE, taskGuidance } from './onboarding.js';
export { firstMealPlanObjective, firstMealPlanTaskSpecs } from './first-meal-plan.js';
