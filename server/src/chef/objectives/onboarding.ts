import type { ObjectiveDefinition } from './types.js';

/**
 * The onboarding objective: guide a household through its cooking profile. L1 states the
 * goal + completion; L2 is condition-gated guidance injected only when its condition holds
 * (design §L2). Resident tools are the two profile writers + catalog grounding; every other
 * eligible tool stays reachable via search.
 */
export const onboardingObjective: ObjectiveDefinition = {
  id: 'onboarding',
  instructions:
    'Goal: learn this household\'s cooking profile — names, grocery stores, budget, cook days, ' +
    'allergies, diets, tastes, and skill — writing each answer through with a command tool. ' +
    'Done when every required slot is filled or defaulted.',
  tools: ['save_household_profile', 'save_member_profile', 'search_catalog'],
  guidance: [
    {
      when: 'a member named an allergen without a severity or confirmation',
      then: 'ask for the severity and confirm it back before you save it — an unconfirmed allergen is never written.',
    },
    {
      when: 'the household is describing tastes',
      then: 'drill into cuisines, dish types, and disliked ingredients; ground each value with search_catalog before saving.',
    },
  ],
};
