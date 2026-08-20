// The first-launch routing decision, extracted so it's unit-testable (Test Case 2).
// A user with an authed session who has finished onboarding goes straight to the deck;
// everyone else (no session, or session but onboarding unfinished) enters onboarding.

export const DECK_ROUTE = "/(app)/discover" as const;
export const ONBOARDING_ROUTE = "/(onboarding)/welcome" as const;

export type GateRoute = typeof DECK_ROUTE | typeof ONBOARDING_ROUTE;

/** Where first launch routes, given whether a session exists and the user's onboarding state. */
export function gateRoute(hasSession: boolean, finishedOnboarding: boolean | undefined): GateRoute {
  return hasSession && finishedOnboarding === true ? DECK_ROUTE : ONBOARDING_ROUTE;
}
