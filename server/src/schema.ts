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
export const MAJOR_ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nut', 'peanut', 'wheat', 'soybean', 'sesame'] as const;
export const ALLERGEN_PRESENCE = ['contains', 'may_contain'] as const;
// TS-signal: the categorization facets. `value` is a controlled-vocabulary string
// validated in app code (VOCAB), not at the DB layer — like `fdc_foods.category`.
const FACETS = ['cuisine', 'meal_type', 'dish_type', 'primary_ingredient'] as const;
// Diet-signal (WI-DS-1): the per-diet verdict. `diet_id` is a DietRule id (app-side
// config, not a DB enum) so a new diet needs no migration — like `recipe_categories.value`.
export const DIET_VERDICTS = ['compatible', 'incompatible', 'unknown'] as const;
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
export const DIFFICULTY_BANDS = ['beginner', 'intermediate', 'advanced'] as const;
// Ranking preferences (WI-RANK-1): severity gates allergen filter-vs-soft; strictness
// gates diet filter-vs-penalty; the affinity facets are the 3-value subset of FACETS
// that user food prefs mirror; sentiment is the like/dislike direction.
export const ALLERGEN_SEVERITIES = ['severe', 'moderate', 'mild'] as const;
export const DIET_STRICTNESS = ['strict', 'flexible'] as const;
export const AFFINITY_FACETS = ['cuisine', 'dish_type', 'primary_ingredient'] as const;
export const SENTIMENTS = ['like', 'dislike'] as const;
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
// W2 meal-plan slot + grocery aisle (pgEnum → text{enum}).
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const GROCERY_AISLES = [
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
] as const;

/** A gram-weight portion on an FNDDS food (`foodPortions` → description + grams). */
export interface FdcPortion {
  description: string;
  gramWeight: number;
}

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
    name: text('name'),
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
    nrfScore: text('nrf_score'), // raw NRF nutrient-density number (pg numeric → text); null when unscored
    // Difficulty signal (WI-DIFF-1): the continuous 0–100 rollup (numeric → text, like
    // nrfScore) and its derived band. Null until scored at ingest (WI-DIFF-3).
    difficultyScore: text('difficulty_score'),
    difficultyBand: text('difficulty_band', { enum: DIFFICULTY_BANDS }),
    allergens: text('allergens', { mode: 'json' }).$type<{ contains: string[]; mayContain: string[] }>(),
    allergensComplete: integer('allergens_complete', { mode: 'boolean' }).notNull().default(false),
    // Cost signal (WI-CS-1): absolute USD cents per serving + the fraction of gram-weight
    // priced (numeric-as-text). Both null until `costStep` scores at ingest (WI-CS-2).
    costPerServingCents: integer('cost_per_serving_cents'),
    costCoverage: text('cost_coverage'),
    createdAt: createdAt(),
  },
  (t) => [
    index('recipes_user_idx').on(t.userId, t.createdAt),
    index('recipes_difficulty_band_idx').on(t.difficultyBand),
  ],
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
  // Difficulty signal (WI-DIFF-1): the atomic per-step technique weight (1–5). Null
  // until scored at ingest (WI-DIFF-3).
  difficulty: integer('difficulty'),
  // Difficulty detection (WI-DIFF-5): the detected canonical technique names for this
  // step (JSON-mode text array). The atom the derived `difficulty` weight is computed
  // from, persisted so re-weighting the table never re-calls the LLM. Null when none.
  techniques: text('techniques', { mode: 'json' }).$type<string[]>(),
});

// TS-signal (WI-TS-1): the recipe's taste facets — one row per (recipe, facet,
// value). A normalized child table, not JSON columns, so ranking can filter by
// value via `recipe_categories_value_idx`. Composite PK dedups + makes replay
// persists idempotent (with onConflictDoNothing). Mirrors the other join tables.
export const recipeCategories = sqliteTable(
  'recipe_categories',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    facet: text('facet', { enum: FACETS }).notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.facet, t.value] }),
    index('recipe_categories_value_idx').on(t.facet, t.value),
  ],
);

// Diet-signal (WI-DS-1): one row per (recipe, configured diet) — the compatibility
// verdict plus the blocker that disqualified it. A normalized child table (like
// `recipe_categories`), so the "recipes that fit diet X" query is an indexed lookup.
// Composite PK dedups + makes replay persists idempotent (with onConflictDoNothing).
// A recipe with no row for a diet reads as undetermined, never "fits". `diet_id` is a
// free-string DietRule id validated in app config, not a DB enum.
export const recipeDiets = sqliteTable(
  'recipe_diets',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    dietId: text('diet_id').notNull(),
    verdict: text('verdict', { enum: DIET_VERDICTS }).notNull(),
    // Blocker (only for `incompatible`): the offending ingredient/macro and the class
    // (a FoodClass, `hidden`, or `macro`) that disqualified the recipe.
    blockerKind: text('blocker_kind', { enum: ['ingredient', 'macro'] as const }),
    blockerValue: text('blocker_value'),
    blockerClass: text('blocker_class'),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.dietId] }),
    index('recipe_diets_lookup_idx').on(t.dietId, t.verdict),
  ],
);

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

// W2 meal-plan: one recipe assigned to a (date, meal) slot of a user's plan. A
// "plan" is just this user's rows in a date range — no week/plan container. Both
// FKs cascade. `date` is an absolute calendar date (pg `date` → 'YYYY-MM-DD' text).
export const mealPlanEntries = sqliteTable(
  'meal_plan_entries',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    meal: text('meal', { enum: MEAL_SLOTS }).notNull(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('meal_plan_entries_user_date_idx').on(t.userId, t.date)],
);

// W2 grocery list: one flat, per-user list. `amount`+`unit` carry a structured
// quantity; `quantity_text` holds a freeform amount when there's no numeric amount.
// `aisle`/`icon` are denormalized from the catalog at add time. `source_recipe_id`
// (null = manual) is `set null` so deleting a recipe keeps its items.
export const groceryItems = sqliteTable(
  'grocery_items',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amount: text('amount'), // pg numeric → text
    unit: text('unit'),
    quantityText: text('quantity_text'),
    aisle: text('aisle', { enum: GROCERY_AISLES }).notNull(),
    icon: text('icon').notNull().default('default'),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    sourceRecipeId: text('source_recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('grocery_items_user_idx').on(t.userId)],
);

// Nutrition estimation (WI-1): the seeded USDA FNDDS (Survey) catalog. `fdc_foods`
// is one row per survey food; `portions` is the JSON gram-weight table. `fdc_id` is
// an INTEGER PRIMARY KEY (aliases rowid) so the FTS5 external-content mirror over
// `description_normalized` can join on it. Full nutrient panel lives in the sibling
// `fdc_food_nutrient` (one row per nutrient number), so later features read at full
// granularity with no re-seed.
export const fdcFoods = sqliteTable(
  'fdc_foods',
  {
    fdcId: integer('fdc_id').primaryKey(),
    description: text('description').notNull(),
    descriptionNormalized: text('description_normalized').notNull(),
    category: text('category'),
    portions: text('portions', { mode: 'json' }).$type<FdcPortion[]>(),
  },
  (t) => [index('fdc_foods_norm_idx').on(t.descriptionNormalized)],
);

export const fdcFoodNutrient = sqliteTable(
  'fdc_food_nutrient',
  {
    fdcId: integer('fdc_id')
      .notNull()
      .references(() => fdcFoods.fdcId),
    nutrientNumber: text('nutrient_number').notNull(),
    amountPer100g: text('amount_per_100g').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fdcId, t.nutrientNumber] })],
);

export const fdcFoodAllergen = sqliteTable(
  'fdc_food_allergen',
  {
    fdcId: integer('fdc_id')
      .notNull()
      .references(() => fdcFoods.fdcId),
    allergen: text('allergen', { enum: MAJOR_ALLERGENS }).notNull(),
    presence: text('presence', { enum: ALLERGEN_PRESENCE }).notNull(),
    species: text('species'),
  },
  (t) => [primaryKey({ columns: [t.fdcId, t.allergen] }), index('fdc_food_allergen_fdc_idx').on(t.fdcId)],
);

// Cost signal (WI-CS-1): one row per priced FNDDS food, keyed to `fdc_id`, derived
// offline from USDA ERS Purchase to Plate National Average Prices (PP-NAP). Mirrors
// `fdc_food_allergen`. Stores the RAW 2017–18 PP-NAP fields at lowest granularity
// (numeric-as-text, no CPI, no cents rounding) so re-inflation or a newer cycle
// rebuilds without re-sourcing. CPI aging + cents rounding happen at read time.
export const fdcFoodPrice = sqliteTable('fdc_food_price', {
  fdcId: integer('fdc_id')
    .primaryKey()
    .references(() => fdcFoods.fdcId),
  foodCode: text('food_code').notNull(),
  pricePer100g: text('price_per_100g').notNull(),
  method: text('method'),
  sourceCycle: text('source_cycle').notNull(),
});

// Ranking preferences (WI-RANK-1): the per-user targets/weights (1:1 with users) plus
// three child tables the ranker reads — allergens (severity gates the filter), diets
// (strictness gates the filter), and food prefs (mirror `recipe_categories` so affinity
// is a direct join). All cascade on user delete. Weights are 0–3, enforced in the Zod
// model at the read boundary, not by a DB check.
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  skillLevel: text('skill_level', { enum: DIFFICULTY_BANDS }).notNull().default('beginner'),
  budgetCentsPerServing: integer('budget_cents_per_serving'),
  timeBudgetMinutes: integer('time_budget_minutes'),
  weightCost: integer('weight_cost').notNull().default(1),
  weightDifficulty: integer('weight_difficulty').notNull().default(1),
  weightNutrition: integer('weight_nutrition').notNull().default(1),
  weightAffinity: integer('weight_affinity').notNull().default(1),
  weightTime: integer('weight_time').notNull().default(1),
  weightPopularity: integer('weight_popularity').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const userAllergens = sqliteTable(
  'user_allergens',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    allergen: text('allergen', { enum: MAJOR_ALLERGENS }).notNull(),
    severity: text('severity', { enum: ALLERGEN_SEVERITIES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.allergen] })],
);

export const userDiets = sqliteTable(
  'user_diets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dietId: text('diet_id').notNull(),
    strictness: text('strictness', { enum: DIET_STRICTNESS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dietId] })],
);

export const userFoodPrefs = sqliteTable(
  'user_food_prefs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    facet: text('facet', { enum: AFFINITY_FACETS }).notNull(),
    value: text('value').notNull(),
    sentiment: text('sentiment', { enum: SENTIMENTS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.facet, t.value] })],
);

export const schema = {
  users,
  recipes,
  ingredients,
  recipeSteps,
  recipeCategories,
  recipeDiets,
  importJobs,
  importJobRecipes,
  cookbooks,
  cookbookRecipes,
  mealPlanEntries,
  groceryItems,
  fdcFoods,
  fdcFoodNutrient,
  fdcFoodAllergen,
  fdcFoodPrice,
  userPreferences,
  userAllergens,
  userDiets,
  userFoodPrefs,
};
export type Schema = typeof schema;

export type NewUser = typeof users.$inferInsert;
export type NewRecipe = typeof recipes.$inferInsert;
export type NewImportJob = typeof importJobs.$inferInsert;

/** Source-type union, shared with the domain models. */
export type SourceType = (typeof SOURCE_TYPES)[number];
/** Categorization facet union, shared with the domain models. */
export type Facet = (typeof FACETS)[number];
/** Meal-plan slot + grocery aisle unions, shared with the domain models. */
export type MealSlot = (typeof MEAL_SLOTS)[number];
export type GroceryAisle = (typeof GROCERY_AISLES)[number];
/** Difficulty band union (WI-DIFF-1), shared with the domain models. */
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];
