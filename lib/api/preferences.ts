import { apiFetch } from "./client";

/** A taste preference on the wire — `facet` names the corpus the value came from (WI-1). */
export interface ApiTastePref { facet: "cuisine" | "dish_type" | "ingredient"; value: string }

/** The wire shape of the preference model (snake_case), mirroring the server's `GET/PUT /v1/preferences`. */
export interface ApiPreferences {
  skill_level: "beginner" | "intermediate" | "advanced";
  weekly_budget_cents: number | null;
  time_budget_minutes: number | null;
  weekly_meals: { breakfast: number; lunch: number; dinner: number; snack: number; kids: number };
  likes: ApiTastePref[];
  dislikes: ApiTastePref[];
  allergens: { allergen: string; severity: "severe" | "moderate" | "mild" }[];
  diets: { diet: string; strictness: "strict" | "flexible" }[];
  owned_equipment: string[];
  grocery_stores: string[];
  household_adults: number;
  household_kids: number;
  eats_leftovers: boolean;
}

/** The caller's full preference model (cold-start defaults if never saved). */
export async function getPreferences(): Promise<ApiPreferences> {
  const { preferences } = await apiFetch<{ preferences: ApiPreferences }>("/v1/preferences");
  return preferences;
}

/** Upserts the user-editable subset; returns the persisted model. Weights stay server-owned. */
export async function updatePreferences(body: ApiPreferences): Promise<ApiPreferences> {
  const { preferences } = await apiFetch<{ preferences: ApiPreferences }>("/v1/preferences", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return preferences;
}
