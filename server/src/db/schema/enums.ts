import { pgEnum } from 'drizzle-orm/pg-core';

export const sourceTypeEnum = pgEnum('source_type', [
  'instagram',
  'tiktok',
  'facebook',
  'pinterest',
  'youtube',
  'website',
  'photo',
]);
export type SourceType = (typeof sourceTypeEnum.enumValues)[number];

/**
 * Job lifecycle states. Failure detail lives in `import_jobs.error_code`, not in
 * extra enum values — so a job that finished but found no recipe is `failed` with
 * `error_code = 'NO_RECIPE'`, and the client branches on the code.
 */
export const importJobStatusEnum = pgEnum('import_job_status', [
  'queued',
  'running',
  'ready',
  'failed',
]);
export type ImportJobStatus = (typeof importJobStatusEnum.enumValues)[number];

// C2 onboarding enums. Display copy maps to a stable snake_case value in the
// mobile accumulator, so re-wording a label needs no migration — only add/remove
// of an option does. Multi-selects are stored as `enum[]`.
export const goalEnum = pgEnum('goal', [
  'eat_healthier',
  'save_money',
  'improve_cooking',
  'organize_recipes',
  'plan_meals',
  'meal_prepping',
  'try_new_cuisines',
]);

export const recipeSourceEnum = pgEnum('recipe_source', [
  'social_media',
  'recipe_websites',
  'printed_handwritten',
]);

export const weekdayEnum = pgEnum('weekday', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const whenCookEnum = pgEnum('when_cook', [
  'morning_plan_ahead',
  'lunchtime',
  'evening_ready',
  'weekly_schedule',
  'meal_prep',
]);

export const cookTimeEnum = pgEnum('cook_time', [
  'before_5pm',
  'from_5_to_6pm',
  'from_6_to_7pm',
  'from_7_to_8pm',
  'after_8pm',
]);

export const howHeardEnum = pgEnum('how_heard', [
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
]);

export const ageBandEnum = pgEnum('age_band', [
  'under_24',
  'from_25_to_34',
  'from_35_to_44',
  'from_45_to_54',
  'over_55',
]);

/** C5 nutrition provenance: schema.org-parsed vs. computed from the food catalog.
 * Null (no column value) = unknown — no parsed block and coverage below the floor. */
export const nutritionSourceEnum = pgEnum('nutrition_source', ['parsed', 'computed']);
export type NutritionSource = (typeof nutritionSourceEnum.enumValues)[number];

/** W2 grocery aisle. Store-walk order so the default grouped view reads top-to-bottom
 * like a shopping trip; `other` is the catch-all for anything the catalog can't place. */
export const groceryAisleEnum = pgEnum('grocery_aisle', [
  'produce',
  'meat_seafood',
  'dairy_eggs_fridge',
  'bakery',
  'pantry',
  'herbs_spices',
  'frozen',
  'beverages',
  'household',
  'other',
]);
export type GroceryAisle = (typeof groceryAisleEnum.enumValues)[number];

/** Machine-readable failure detail for a `failed` job (stored as text). */
export type ImportErrorCode =
  | 'NO_RECIPE'
  | 'MEDIA_UNAVAILABLE'
  | 'FETCH_FAILED'
  | 'EXTRACTION_FAILED'
  | 'TIMEOUT'
  | 'UNSUPPORTED';
