import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric } from 'drizzle-orm/pg-core';
import { recipes } from './recipes.js';

export const ingredients = pgTable('ingredients', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  quantityText: text('quantity_text'),
  amount: numeric('amount'),
  unit: text('unit'),
});

export type Ingredient = typeof ingredients.$inferSelect;
export type NewIngredient = typeof ingredients.$inferInsert;
