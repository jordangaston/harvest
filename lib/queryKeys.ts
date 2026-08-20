/**
 * The single source of truth for TanStack Query cache keys.
 *
 * Convention: one entry per API resource. List keys are a bare tuple
 * (`["cookbooks"]`); item keys append the id (`["cookbook", id]`). A mutation
 * invalidates the narrowest key it changed — see `docs/client-caching.md`.
 */
export const queryKeys = {
  cookbooks: ["cookbooks"] as const,
  cookbook: (id: string) => ["cookbook", id] as const,
  recipes: ["recipes"] as const,
  recipe: (id: string) => ["recipe", id] as const,
  mealPlan: (weekStart: string) => ["mealPlan", weekStart] as const,
  groceries: ["groceries"] as const,
  commonIngredients: ["commonIngredients"] as const,
  me: ["me"] as const,
  onboardingFlags: ["onboardingFlags"] as const,
  deck: ["deck"] as const,
  preferences: ["preferences"] as const,
};
