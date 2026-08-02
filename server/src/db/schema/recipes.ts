import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { sourceTypeEnum } from './enums.js';
import { users } from './users.js';

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
    totalMinutes: integer('total_minutes'),
    imageUrl: text('image_url'),
    confidence: numeric('confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('recipes_user_idx').on(table.userId, table.createdAt.desc())],
);

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
