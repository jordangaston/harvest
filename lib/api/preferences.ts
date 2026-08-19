import { apiFetch } from "./client";

/** The wire shape of the preference model (snake_case), mirroring the server's `GET/PUT /v1/preferences`. */
export interface ApiPreferences {
  skill_level: "beginner" | "intermediate" | "advanced";
  weekly_budget_cents: number | null;
  time_budget_minutes: number | null;
  weekly_meals: { breakfast: number; lunch: number; dinner: number; snack: number; kids: number };
  liked_cuisines: string[];
  disliked_ingredients: string[];
  allergens: { allergen: string; severity: "severe" | "moderate" | "mild" }[];
  diets: { diet: string; strictness: "strict" | "flexible" }[];
  owned_equipment: string[];
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
