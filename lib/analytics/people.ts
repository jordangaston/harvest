import type { Props } from "./backend";

/**
 * The onboarding accumulator shape (see `lib/onboarding.ts`). Values are already the server's
 * snake_case enum strings, so they pass straight through to Mixpanel people-properties.
 */
export type OnboardingPayload = {
  goals?: string[];
  cook_days?: string[];
};

/**
 * Maps the collected onboarding answers to Mixpanel people-properties, adding `signup_at`.
 * `signupAt` is passed in (not read from the clock) so the mapping is pure and unit-testable.
 * Undefined answers are omitted.
 */
export function toPeopleProperties(onboarding: OnboardingPayload, signupAt: string): Props {
  const props: Props = { signup_at: signupAt };
  for (const [key, value] of Object.entries(onboarding)) {
    if (value !== undefined) props[key] = value;
  }
  return props;
}
