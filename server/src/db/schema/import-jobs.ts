import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { sourceTypeEnum, importJobStatusEnum } from './enums.js';
import { users } from './users.js';
import { recipes } from './recipes.js';

export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: importJobStatusEnum('status').notNull(),
    progress: integer('progress').notNull().default(0),
    sourceType: sourceTypeEnum('source_type').notNull(),
    // The normalized thing being imported: a source URL (social/website) or the
    // object-storage key of an uploaded photo.
    sourceRef: text('source_ref').notNull(),
    recipeId: uuid('recipe_id').references(() => recipes.id),
    // Failure detail when status = 'failed' (see ImportErrorCode).
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('import_jobs_user_idx').on(table.userId, table.createdAt.desc())],
);

export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
