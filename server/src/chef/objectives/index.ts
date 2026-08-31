import { onboardingObjective } from './onboarding.js';
import type { ObjectiveDefinition } from './types.js';

/** Every objective definition, keyed by the `objectives.definition` string. */
const DEFINITIONS: Record<string, ObjectiveDefinition> = {
  [onboardingObjective.id]: onboardingObjective,
};

/** The definition for an objective row's `definition` string, or undefined if unregistered. */
export function objectiveDefinition(definition: string): ObjectiveDefinition | undefined {
  return DEFINITIONS[definition];
}

export type { ObjectiveDefinition, DefinitionSlot } from './types.js';
export { householdSlotSpecs, memberSlotSpecs, ONBOARDING_CLOSE } from './onboarding.js';
