import { sql } from 'drizzle-orm';
import { pgTable, uuid, date, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { mealSlotEnum } from './enums.js';
import { users } from './users.js';
import { recipes } from './recipes.js';

// One recipe assigned to a (date, meal) slot of a user's meal plan. A "meal plan"
// is just this user's rows in a date range — there is no week/plan container. A
// slot holds many recipes, ordered by `position`. Both FKs cascade: deleting a
// recipe removes it from every plan, and deleting a user clears their plan.
export const mealPlanEntries = pgTable(
  'meal_plan_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    meal: mealSlotEnum('meal').notNull(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('meal_plan_entries_user_date_idx').on(table.userId, table.date)],
);

export type MealPlanEntry = typeof mealPlanEntries.$inferSelect;
export type NewMealPlanEntry = typeof mealPlanEntries.$inferInsert;
