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
  "Eat healthier": "eat_healthier",
  "Save money": "save_money",
  "Improve cooking skills": "improve_cooking",
  "Organize recipes": "organize_recipes",
  "Plan out meals": "plan_meals",
  "Meal prepping": "meal_prepping",
  "Try new cuisines": "try_new_cuisines",
  "Kid-friendly meals": "kid_friendly",
});

// The day picker emits the wire enums directly ("mon"…); this map validates/passes them through.
const COOK_DAYS = makeMap({ mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" });

const enums = (map: Map<string, string>, labels: string[]): string[] =>
  labels.map((l) => map.get(norm(l))).filter((v): v is string => v !== undefined);

/** The `POST /v1/users` payload — the two answers the users record owns. */
export type UserPayload = { goals: string[]; cook_days: string[] };

type Draft = { goals: string[]; cookDays: string[]; prefs: Partial<Preferences> };
const empty = (): Draft => ({ goals: [], cookDays: [], prefs: {} });
let draft: Draft = empty();

/** Merge a slice of preference answers into the draft (called per screen). */
export function setPreferences(patch: Partial<Preferences>): void {
  draft.prefs = { ...draft.prefs, ...patch };
}
/** Goals — screens pass display labels; stored as server enums. */
export function setGoals(labels: string[]): void {
  draft.goals = enums(GOALS, labels);
}
/** Cook days — weekday chip values ("mon"…) pass straight through the map. */
export function setCookDays(values: string[]): void {
  draft.cookDays = enums(COOK_DAYS, values);
}

/** Snapshot of the collected preference answers, atop the model defaults. */
export function getPreferencesDraft(): Preferences {
  return { ...DEFAULT_PREFERENCES, ...draft.prefs };
}

/** The `POST /v1/users` body — goals + cook days (server enums). */
export function buildUserPayload(): UserPayload {
  return { goals: draft.goals, cook_days: draft.cookDays };
}

/** The `PUT /v1/preferences` body — the full ranking model mapped to the wire DTO. */
export function buildPreferences(): ApiPreferences {
  return clientToApi(getPreferencesDraft());
}

/** Clears the draft (call after both completion writes succeed). */
export function resetOnboarding(): void {
  draft = empty();
}
