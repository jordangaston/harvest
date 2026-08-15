import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * The import-path slice of the Harvest schema, re-targeted from Postgres
 * (`drizzle-orm/pg-core`) to the SQLite dialect (`drizzle-orm/sqlite-core`) that
 * libSQL/Turso and D1 share — the driver changed (D1 → libSQL), this schema did not.
 * The full migration map is in docs/sprint-serverless-spike/RECOMMENDATION.md;
 * this file demonstrates every non-trivial pg→SQLite mapping the pipeline needs:
 *
 *   uuid            → text + `$defaultFn(crypto.randomUUID)`  (SQLite has no gen_random_uuid)
 *   pg enum         → text + `{ enum: [...] }` union          (no native enum in SQLite)
 *   numeric         → text                                    (preserve precision, mirrors pg-numeric→string)
 *   boolean         → integer `{ mode: 'boolean' }`
 *   timestamptz     → integer `{ mode: 'timestamp' }` (epoch seconds)
 *   text[] (arrays) → text `{ mode: 'json' }`                 (see users.goals in the doc; not in this slice)
 */

const SOURCE_TYPES = ['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo'] as const;
const JOB_STATUS = ['queued', 'running', 'ready', 'failed'] as const;

/** UUID text primary key, generated in app code (no DB-side default on SQLite). */
const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const users = sqliteTable('users', {
  id: uuidPk(),
  phone: text('phone').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const recipes = sqliteTable(
  'recipes',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourceUrl: text('source_url'),
    servings: integer('servings'),
    servingsEstimated: integer('servings_estimated', { mode: 'boolean' }).notNull().default(false),
    totalMinutes: integer('total_minutes'),
    imageUrl: text('image_url'),
    confidence: text('confidence'), // pg numeric → text
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('recipes_user_idx').on(t.userId, t.createdAt)],
);

export const ingredients = sqliteTable('ingredients', {
  id: uuidPk(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  quantityText: text('quantity_text'),
  amount: text('amount'), // pg numeric → text
  unit: text('unit'),
  icon: text('icon'),
});

export const recipeSteps = sqliteTable('recipe_steps', {
  id: uuidPk(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
});

export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: JOB_STATUS }).notNull(),
    progress: integer('progress').notNull().default(0),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourceRef: text('source_ref').notNull(),
    recipeId: text('recipe_id').references(() => recipes.id),
    errorCode: text('error_code'),
    // A durable-recovery marker for the proof: how many times the faulted step
    // has entered. Persisted so a Workflow step retry sees the prior count
    // (see import-workflow.ts). Not a production column.
    faultAttempts: integer('fault_attempts').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('import_jobs_user_idx').on(t.userId, t.createdAt)],
);

export const importJobRecipes = sqliteTable(
  'import_job_recipes',
  {
    importJobId: text('import_job_id')
      .notNull()
      .references(() => importJobs.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.importJobId, t.recipeId] })],
);

export const schema = { users, recipes, ingredients, recipeSteps, importJobs, importJobRecipes };
export type Schema = typeof schema;

/** Kept so the generated DDL is stable if drizzle-kit ever needs a raw ref. */
export const _sql = sql;
