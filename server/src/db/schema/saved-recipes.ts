import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { recipes } from './recipes.js';

// Join table: which user saved which (canonical) recipe. This is the cookbook.
export const savedRecipes = pgTable(
  'saved_recipes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saved_recipes_user_recipe_uidx').on(table.userId, table.recipeId),
    index('saved_recipes_user_idx').on(table.userId, table.createdAt.desc()),
  ],
);

export type SavedRecipe = typeof savedRecipes.$inferSelect;
export type NewSavedRecipe = typeof savedRecipes.$inferInsert;
