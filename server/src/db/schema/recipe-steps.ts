import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer } from 'drizzle-orm/pg-core';
import { recipes } from './recipes.js';

export const recipeSteps = pgTable('recipe_steps', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
});

export type RecipeStep = typeof recipeSteps.$inferSelect;
export type NewRecipeStep = typeof recipeSteps.$inferInsert;
