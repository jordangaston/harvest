import { z } from 'zod';

// Domain model for an import job. Repositories parse rows into this at the
// boundary. Failure detail lives in `errorCode` (e.g. NO_RECIPE), never an extra
// status value — a finished-but-empty import is `failed` + NO_RECIPE.
export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  progress: z.number().int(),
  sourceType: z.enum(['instagram', 'tiktok', 'facebook', 'pinterest', 'youtube', 'website', 'photo']),
  sourceRef: z.string(),
  recipeId: z.string().uuid().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ImportJob = z.infer<typeof ImportJobSchema>;
export type ImportJobStatus = ImportJob['status'];

/** The public job shape returned to clients: only these fields, never `user_id`,
 * `source_ref`, or any internal column. snake_case; null fields omitted.
 * `recipe_id` is the primary recipe; `recipe_ids` is the full ordered set a
 * slideshow import produced. */
export interface PublicJob {
  id: string;
  status: ImportJobStatus;
  progress: number;
  source_type: ImportJob['sourceType'];
  error_code?: string;
  recipe_id?: string;
  recipe_ids?: string[];
}

/**
 * Maps a job to its public shape, dropping internal columns and omitting null
 * error/recipe fields.
 * @param job - The domain job.
 * @param recipeIds - The recipes the import produced, in order (empty until ready).
 * @returns The client-safe projection.
 */
export function toPublicJob(job: ImportJob, recipeIds: string[] = []): PublicJob {
  const publicJob: PublicJob = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    source_type: job.sourceType,
  };
  if (job.errorCode) publicJob.error_code = job.errorCode;
  if (job.recipeId) publicJob.recipe_id = job.recipeId;
  if (recipeIds.length > 0) publicJob.recipe_ids = recipeIds;
  return publicJob;
}
