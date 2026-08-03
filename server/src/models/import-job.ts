import { z } from 'zod';

// Domain model for an import job. Repositories parse rows into this at the
// boundary. Failure detail lives in `errorCode` (e.g. NO_RECIPE), never an
// extra status value — a finished-but-empty import is `failed` + NO_RECIPE.
export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  progress: z.number().int(),
  sourceType: z.enum(['instagram', 'tiktok', 'facebook', 'pinterest', 'website', 'photo']),
  sourceRef: z.string(),
  recipeId: z.string().uuid().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ImportJob = z.infer<typeof ImportJobSchema>;
export type ImportJobStatus = ImportJob['status'];

/** The public job shape returned to clients (AC-9): only these fields, never
 * `user_id`, `source_ref`, or any internal column. snake_case; null fields omitted. */
export interface PublicJob {
  id: string;
  status: ImportJobStatus;
  progress: number;
  source_type: ImportJob['sourceType'];
  error_code?: string;
  recipe_id?: string;
}

/** Maps a job row to its public shape, dropping every internal/null field. */
export function toPublicJob(job: ImportJob): PublicJob {
  const publicJob: PublicJob = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    source_type: job.sourceType,
  };
  if (job.errorCode) publicJob.error_code = job.errorCode;
  if (job.recipeId) publicJob.recipe_id = job.recipeId;
  return publicJob;
}
