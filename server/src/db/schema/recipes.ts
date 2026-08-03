import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sourceTypeEnum } from './enums.js';

// Canonical recipes: a recipe is a shared entity (many users can save the same
// one), so ownership lives in `saved_recipes`, not here.
export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  sourceUrl: text('source_url'),
  servings: integer('servings'),
  totalMinutes: integer('total_minutes'),
  imageUrl: text('image_url'),
  confidence: numeric('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
