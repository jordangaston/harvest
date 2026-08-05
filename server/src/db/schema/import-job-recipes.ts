import { pgTable, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';
import { importJobs } from './import-jobs.js';
import { recipes } from './recipes.js';

// Join table: the recipe(s) an import produced, in slide order. One import
// yields many recipes (a slideshow carousel holds several), so ownership of the
// job→recipe list lives here, not in `import_jobs.recipe_id` (which keeps only
// the primary recipe for a single-recipe import).
export const importJobRecipes = pgTable(
  'import_job_recipes',
  {
    importJobId: uuid('import_job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.importJobId, table.recipeId] })],
);

export type ImportJobRecipe = typeof importJobRecipes.$inferSelect;
export type NewImportJobRecipe = typeof importJobRecipes.$inferInsert;
