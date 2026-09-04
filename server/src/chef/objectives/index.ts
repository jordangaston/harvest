import { onboardingObjective } from './onboarding.js';
import { firstMealPlanObjective } from './first-meal-plan.js';
import type { ObjectiveDefinition } from './types.js';

/** Every objective definition, keyed by the `objectives.definition` string. */
const DEFINITIONS: Record<string, ObjectiveDefinition> = {
  [onboardingObjective.id]: onboardingObjective,
  [firstMealPlanObjective.id]: firstMealPlanObjective,
};

/** The definition for an objective row's `definition` string, or undefined if unregistered. */
export function objectiveDefinition(definition: string): ObjectiveDefinition | undefined {
  return DEFINITIONS[definition];
}

export type { ObjectiveDefinition } from './types.js';
export { householdTaskSpecs, memberTaskSpecs, ONBOARDING_CLOSE, taskGuidance } from './onboarding.js';
export { firstMealPlanObjective, firstMealPlanTaskSpecs } from './first-meal-plan.js';
