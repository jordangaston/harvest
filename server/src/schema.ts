import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * The Harvest schema, ported from Postgres (`drizzle-orm/pg-core`) to the SQLite
 * dialect (`drizzle-orm/sqlite-core`) libSQL/Turso speaks. The DESIGN type map:
 *
 *   uuid default gen_random_uuid() → text + `$defaultFn(crypto.randomUUID)`
 *   pgEnum                         → text `{ enum: [...] }`
 *   numeric                        → text            (preserve precision, matches numeric→string models)
 *   boolean                        → integer `{ mode: 'boolean' }`
 *   timestamptz                    → integer `{ mode: 'timestamp' }` (epoch → Date)
 *   enum[] (onboarding arrays)     → text `{ mode: 'json' }`
 */

// ── Enum value tuples (pgEnum → text { enum }) ──────────────────────────────
const SOURCE_TYPES = ['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo'] as const;
const JOB_STATUS = ['queued', 'running', 'ready', 'failed'] as const;
const NUTRITION_SOURCE = ['parsed', 'computed'] as const;
const GOALS = [
  'eat_healthier',
  'save_money',
  'improve_cooking',
  'organize_recipes',
  'plan_meals',
  'meal_prepping',
  'try_new_cuisines',
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

/** UUID text primary key, generated in app code (SQLite has no gen_random_uuid). */
const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** timestamptz → epoch-int column defaulting to now (SQLite has no now()). */
const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable(
  'users',
  {
    id: uuidPk(),
    phone: text('phone').notNull(),
    jwtPrivateKey: text('jwt_private_key').notNull(),
    jwtPublicKey: text('jwt_public_key').notNull(),
    accessTokenNonce: integer('access_token_nonce').notNull().default(0),
    refreshTokenNonce: integer('refresh_token_nonce').notNull().default(0),
    // C2 onboarding. Multi-selects (pg enum[]) become JSON-mode text arrays; the
    // single-selects are plain enum-text columns. All nullable — a user may skip a screen.
    goals: text('goals', { mode: 'json' }).$type<(typeof GOALS)[number][]>(),
    recipeSources: text('recipe_sources', { mode: 'json' }).$type<(typeof RECIPE_SOURCES)[number][]>(),
    cookDays: text('cook_days', { mode: 'json' }).$type<(typeof WEEKDAYS)[number][]>(),
    whenCook: text('when_cook', { enum: WHEN_COOK }),
    cookTime: text('cook_time', { enum: COOK_TIME }),
    howHeard: text('how_heard', { enum: HOW_HEARD }),
    age: text('age', { enum: AGE_BANDS }),
    onboardingCompletedAt: integer('onboarding_completed_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_phone_uidx').on(t.phone)],
);

export const recipes = sqliteTable(
  'recipes',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourceUrl: text('source_url'),
    servings: integer('servings'),
    servingsEstimated: integer('servings_estimated', { mode: 'boolean' }).notNull().default(false),
    totalMinutes: integer('total_minutes'),
    imageUrl: text('image_url'),
    confidence: text('confidence'), // pg numeric → text
    // C5 Nutrition-Facts label core, per serving (pg numeric → text).
    calories: text('calories'),
    gramsOfFat: text('grams_of_fat'),
    gramsOfSaturatedFat: text('grams_of_saturated_fat'),
    gramsOfCarbohydrate: text('grams_of_carbohydrate'),
    gramsOfFiber: text('grams_of_fiber'),
    gramsOfSugar: text('grams_of_sugar'),
    gramsOfProtein: text('grams_of_protein'),
    milligramsOfSodium: text('milligrams_of_sodium'),
    nutritionSource: text('nutrition_source', { enum: NUTRITION_SOURCE }),
    createdAt: createdAt(),
  },
  (t) => [index('recipes_user_idx').on(t.userId, t.createdAt)],
);

export const ingredients = sqliteTable('ingredients', {
  id: uuidPk(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  quantityText: text('quantity_text'),
  amount: text('amount'), // pg numeric → text
  unit: text('unit'),
  icon: text('icon'),
});

export const recipeSteps = sqliteTable('recipe_steps', {
  id: uuidPk(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
});

export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: JOB_STATUS }).notNull(),
    progress: integer('progress').notNull().default(0),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourceRef: text('source_ref').notNull(),
    recipeId: text('recipe_id').references(() => recipes.id),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('import_jobs_user_idx').on(t.userId, t.createdAt)],
);

export const importJobRecipes = sqliteTable(
  'import_job_recipes',
  {
    importJobId: text('import_job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.importJobId, t.recipeId] })],
);

export const cookbooks = sqliteTable(
  'cookbooks',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cookbooks_user_name_uidx').on(t.userId, t.name),
    index('cookbooks_user_idx').on(t.userId, t.createdAt),
  ],
);

export const cookbookRecipes = sqliteTable(
  'cookbook_recipes',
  {
    id: uuidPk(),
    cookbookId: text('cookbook_id')
      .notNull()
      .references(() => cookbooks.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cookbook_recipes_uidx').on(t.cookbookId, t.recipeId),
    index('cookbook_recipes_cookbook_idx').on(t.cookbookId, t.createdAt),
  ],
);

export const schema = {
  users,
  recipes,
  ingredients,
  recipeSteps,
  importJobs,
  importJobRecipes,
  cookbooks,
  cookbookRecipes,
};
export type Schema = typeof schema;

export type NewUser = typeof users.$inferInsert;
export type NewRecipe = typeof recipes.$inferInsert;
export type NewImportJob = typeof importJobs.$inferInsert;

/** Source-type union, shared with the domain models. */
export type SourceType = (typeof SOURCE_TYPES)[number];
