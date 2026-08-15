import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { groceryAisleEnum } from './enums.js';
import { users } from './users.js';
import { recipes } from './recipes.js';

// W2 grocery list: one flat, per-user list. `amount`+`unit` carry a structured
// quantity; `quantity_text` holds a freeform amount ("a pinch") when there is no
// numeric amount. `aisle`/`icon` are denormalized from the catalog at add time so
// grouping/sort is a plain read. `source_recipe_id` (null = added manually) powers
// the "by recipe" sort; it's `set null` so deleting a recipe keeps its items.
export const groceryItems = pgTable(
  'grocery_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    amount: numeric('amount'),
    unit: text('unit'),
    quantityText: text('quantity_text'),
    aisle: groceryAisleEnum('aisle').notNull(),
    icon: text('icon').notNull().default('default'),
    checked: boolean('checked').notNull().default(false),
    sourceRecipeId: uuid('source_recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('grocery_items_user_idx').on(table.userId)],
);

export type GroceryItemRow = typeof groceryItems.$inferSelect;
export type NewGroceryItemRow = typeof groceryItems.$inferInsert;
