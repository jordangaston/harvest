import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// A named cookbook owned by one user. The recipes it holds live in
// `cookbook_recipes`; ownership of the (shared, canonical) recipes stays in
// `saved_recipes`. The unique (user_id, name) index enforces per-user name
// uniqueness — a re-used name surfaces as a 409, not a duplicate row.
export const cookbooks = pgTable(
  'cookbooks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cookbooks_user_name_uidx').on(table.userId, table.name),
    index('cookbooks_user_idx').on(table.userId, table.createdAt.desc()),
  ],
);

export type Cookbook = typeof cookbooks.$inferSelect;
export type NewCookbook = typeof cookbooks.$inferInsert;
