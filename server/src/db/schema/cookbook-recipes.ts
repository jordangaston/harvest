import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { cookbooks } from './cookbooks.js';
import { recipes } from './recipes.js';

// Which (canonical) recipe sits in which cookbook — the save mechanism. A recipe
// can belong to many cookbooks; the unique (cookbook_id, recipe_id) keeps a re-add
// idempotent. This is saving/organization; the recipe's creator is `recipes.user_id`.
export const cookbookRecipes = pgTable(
  'cookbook_recipes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cookbookId: uuid('cookbook_id')
      .notNull()
      .references(() => cookbooks.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cookbook_recipes_uidx').on(table.cookbookId, table.recipeId),
    index('cookbook_recipes_cookbook_idx').on(table.cookbookId, table.createdAt.desc()),
  ],
);

export type CookbookRecipe = typeof cookbookRecipes.$inferSelect;
export type NewCookbookRecipe = typeof cookbookRecipes.$inferInsert;
