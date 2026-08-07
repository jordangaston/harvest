import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sourceTypeEnum, nutritionSourceEnum } from './enums.js';
import { users } from './users.js';

// Canonical recipes. A recipe has exactly one creator (`user_id`, who holds edit
// rights); shared *saving* is the `cookbook_recipes` join, not an owner column here.
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    sourceType: sourceTypeEnum('source_type').notNull(),
    sourceUrl: text('source_url'),
    servings: integer('servings'),
    // C4: true when `servings` is our estimate (schema.org omitted the yield).
    servingsEstimated: boolean('servings_estimated').notNull().default(false),
    totalMinutes: integer('total_minutes'),
    imageUrl: text('image_url'),
    confidence: numeric('confidence'),
    // C5 Nutrition-Facts label core, per serving (pg numeric → string in the model).
    calories: numeric('calories'),
    gramsOfFat: numeric('grams_of_fat'),
    gramsOfSaturatedFat: numeric('grams_of_saturated_fat'),
    gramsOfCarbohydrate: numeric('grams_of_carbohydrate'),
    gramsOfFiber: numeric('grams_of_fiber'),
    gramsOfSugar: numeric('grams_of_sugar'),
    gramsOfProtein: numeric('grams_of_protein'),
    milligramsOfSodium: numeric('milligrams_of_sodium'),
    nutritionSource: nutritionSourceEnum('nutrition_source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('recipes_user_idx').on(table.userId, table.createdAt.desc())],
);

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
