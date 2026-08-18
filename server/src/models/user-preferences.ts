import { z } from 'zod';

// Ranking enum value tuples, re-declared here (repo convention: the model validates
// independently of the Drizzle table). The 0–3 weight range is enforced in this
// schema at the read boundary, not by a DB check constraint.
const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MAJOR_ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nut', 'peanut', 'wheat', 'soybean', 'sesame'] as const;
const ALLERGEN_SEVERITIES = ['severe', 'moderate', 'mild'] as const;
const DIET_STRICTNESS = ['strict', 'flexible'] as const;
const AFFINITY_FACETS = ['cuisine', 'dish_type', 'primary_ingredient'] as const;
const SENTIMENTS = ['like', 'dislike'] as const;

const weight = () => z.number().int().min(0).max(3);

/** The fully-resolved per-user ranking preferences, with the child tables folded in. */
export const UserPreferencesSchema = z.object({
  userId: z.string(),
  skillLevel: z.enum(SKILL_LEVELS),
  budgetCentsPerServing: z.number().int().positive().nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  weights: z.object({
    cost: weight(),
    difficulty: weight(),
    nutrition: weight(),
    affinity: weight(),
    time: weight(),
    popularity: weight(),
  }),
  allergens: z.array(z.object({ allergen: z.enum(MAJOR_ALLERGENS), severity: z.enum(ALLERGEN_SEVERITIES) })),
  diets: z.array(z.object({ dietId: z.string(), strictness: z.enum(DIET_STRICTNESS) })),
  foodPrefs: z.array(z.object({ facet: z.enum(AFFINITY_FACETS), value: z.string(), sentiment: z.enum(SENTIMENTS) })),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
