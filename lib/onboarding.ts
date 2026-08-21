// The single in-memory onboarding draft. Every first-run screen records its answer
// here as the user advances (back-nav overwrites, nothing persists mid-flow); on
// completion the draft drains ONCE into two writes — POST /v1/users (goals + cook
// days, which stamps onboardingCompletedAt) and PUT /v1/preferences (the ranking
// model). Same read-once idiom as savedToast.ts.
import { DEFAULT_PREFERENCES, type Preferences } from "../components/swipe/mock.ts";
import type { ApiPreferences } from "./api/preferences.ts";
import { clientToApi } from "./api/preferences-map.ts";

// Screens map their DISPLAY labels to the server's snake_case enums here, so no
// screen ever hardcodes a wire value.
const norm = (label: string): string => label.trim().replace(/[‘’]/g, "'");
const makeMap = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries).map(([label, value]) => [norm(label), value]));

const GOALS = makeMap({
  "Healthy meals": "eat_healthier",
  "Kid friendly meals": "kid_friendly",
  "Quick meals": "quick_meals",
  "Saving money": "save_money",
  "Trying new recipes": "try_new_cuisines",
  "Meal prepping": "meal_prepping",
});

const enums = (map: Map<string, string>, labels: string[]): string[] =>
  labels.map((l) => map.get(norm(l))).filter((v): v is string => v !== undefined);

/** The `POST /v1/users` payload — the two answers the users record owns. */
export type UserPayload = { goals: string[]; cook_days_count: number | null };

type Draft = { goals: string[]; cookDaysCount: number | null; prefs: Partial<Preferences> };
const empty = (): Draft => ({ goals: [], cookDaysCount: null, prefs: {} });
let draft: Draft = empty();

/** Merge a slice of preference answers into the draft (called per screen). */
export function setPreferences(patch: Partial<Preferences>): void {
  draft.prefs = { ...draft.prefs, ...patch };
}
/** Goals — screens pass display labels; stored as server enums. */
export function setGoals(labels: string[]): void {
  draft.goals = enums(GOALS, labels);
}
/** Cook days — how many days a week the user cooks (1–7). */
export function setCookDaysCount(count: number): void {
  draft.cookDaysCount = count;
}

/** Snapshot of the collected preference answers, atop the model defaults. */
export function getPreferencesDraft(): Preferences {
  return { ...DEFAULT_PREFERENCES, ...draft.prefs };
}

/** The `POST /v1/users` body — goals + how many days a week the user cooks. */
export function buildUserPayload(): UserPayload {
  return { goals: draft.goals, cook_days_count: draft.cookDaysCount };
}

/** The `PUT /v1/preferences` body — the full ranking model mapped to the wire DTO. */
export function buildPreferences(): ApiPreferences {
  return clientToApi(getPreferencesDraft());
}

/** Clears the draft (call after both completion writes succeed). */
export function resetOnboarding(): void {
  draft = empty();
}
