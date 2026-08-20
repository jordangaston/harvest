import { z } from 'zod';

// Onboarding enum value tuples (were pgEnum; now inline, mirroring schema.ts).
const GOALS = [
  'eat_healthier',
  'save_money',
  'improve_cooking',
  'organize_recipes',
  'plan_meals',
  'meal_prepping',
  'try_new_cuisines',
  'kid_friendly',
  'quick_meals',
] as const;
const RECIPE_SOURCES = ['social_media', 'recipe_websites', 'printed_handwritten'] as const;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WHEN_COOK = ['morning_plan_ahead', 'lunchtime', 'evening_ready', 'weekly_schedule', 'meal_prep'] as const;
const COOK_TIME = ['before_5pm', 'from_5_to_6pm', 'from_6_to_7pm', 'from_7_to_8pm', 'after_8pm'] as const;
const HOW_HEARD = [
  'tiktok',
  'google_search',
  'youtube',
  'instagram',
  'pinterest',
  'email_newsletter',
  'app_store_search',
  'facebook',
  'friend',
  'other',
] as const;
const AGE_BANDS = ['under_24', 'from_25_to_34', 'from_35_to_44', 'from_45_to_54', 'over_55'] as const;

/** C2 onboarding payload: typed enum values (multi-selects are arrays). Every
 * field is optional — a user may skip a screen. */
export const OnboardingSchema = z.object({
  goals: z.array(z.enum(GOALS)).optional(),
  recipe_sources: z.array(z.enum(RECIPE_SOURCES)).optional(),
  cook_days: z.array(z.enum(WEEKDAYS)).optional(),
  when_cook: z.enum(WHEN_COOK).optional(),
  cook_time: z.enum(COOK_TIME).optional(),
  how_heard: z.enum(HOW_HEARD).optional(),
  age: z.enum(AGE_BANDS).optional(),
});

export type Onboarding = z.infer<typeof OnboardingSchema>;

// Domain model. Repositories parse rows into this at the boundary. The onboarding
// arrays come back from JSON-mode columns as real arrays; timestamps come back as
// Dates via drizzle `mode: 'timestamp'`.
export const UserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  jwtPrivateKey: z.string(),
  jwtPublicKey: z.string(),
  accessTokenNonce: z.number().int(),
  refreshTokenNonce: z.number().int(),
  goals: z.array(z.enum(GOALS)).nullable(),
  recipeSources: z.array(z.enum(RECIPE_SOURCES)).nullable(),
  cookDays: z.array(z.enum(WEEKDAYS)).nullable(),
  whenCook: z.enum(WHEN_COOK).nullable(),
  cookTime: z.enum(COOK_TIME).nullable(),
  howHeard: z.enum(HOW_HEARD).nullable(),
  age: z.enum(AGE_BANDS).nullable(),
  onboardingCompletedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

/**
 * Projects a user to the API-safe shape — never key material or nonces.
 * @param user - The domain user.
 * @returns The id, phone, name (null until the user provides one), and the
 *   derived `finished_onboarding` gate (Q-02: `onboardingCompletedAt` presence).
 */
export function toPublicUser(user: User): { id: string; phone: string; name: string | null; finished_onboarding: boolean } {
  return { id: user.id, phone: user.phone, name: user.name, finished_onboarding: user.onboardingCompletedAt != null };
}
