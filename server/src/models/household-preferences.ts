import { z } from 'zod';
import { WeeklyMealsSchema, TimeByMealSchema } from './user-preferences.js';

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const GROCERY_SHOPPING_DAYS = DAYS_OF_WEEK;
const EQUIPMENT_TYPES = ['oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'pressure_cooker', 'stand_mixer', 'blender', 'food_processor', 'grill', 'dutch_oven', 'deep_fryer', 'wok', 'sous_vide', 'smoker', 'ice_cream_maker', 'waffle_iron'] as const;

// Domain model for the household-scoped preferences (iMessage increment 2), 1:1 with a
// household. Mirrors the household-scoped subset of user_preferences; reuses WeeklyMeals /
// TimeByMeal. Ranking weights stay per-user and server-owned, so they are absent here.
export const HouseholdPreferencesSchema = z.object({
  householdId: z.string().uuid(),
  // IANA zone the TIMEZONE household fact persists (meal-reminders); null ⇒ DEFAULT_TZ.
  timezone: z.string().nullable(),
  groceryStores: z.array(z.string()).nullable(),
  groceryShoppingDay: z.enum(GROCERY_SHOPPING_DAYS).nullable(),
  weeklyBudgetCents: z.number().int().nonnegative().nullable(),
  weeklyMeals: WeeklyMealsSchema.nullable(),
  timeByMeal: TimeByMealSchema.nullable(),
  timeBudgetMinutes: z.number().int().positive().nullable(),
  cookDays: z.array(z.enum(DAYS_OF_WEEK)).nullable(),
  eatsLeftovers: z.boolean(),
  ownedEquipment: z.array(z.enum(EQUIPMENT_TYPES)).nullable(),
  equipmentReviewed: z.boolean(),
  householdAdults: z.number().int().min(1),
  householdKids: z.number().int().nonnegative(),
  updatedAt: z.date(),
});

export type HouseholdPreferences = z.infer<typeof HouseholdPreferencesSchema>;
