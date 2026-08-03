import { pgEnum } from 'drizzle-orm/pg-core';

export const sourceTypeEnum = pgEnum('source_type', [
  'instagram',
  'tiktok',
  'facebook',
  'pinterest',
  'website',
  'photo',
]);
export type SourceType = (typeof sourceTypeEnum.enumValues)[number];

/**
 * Job lifecycle states. Failure detail lives in `import_jobs.error_code`, not in
 * extra enum values — so a job that finished but found no recipe is `failed` with
 * `error_code = 'NO_RECIPE'`, and the client branches on the code.
 */
export const importJobStatusEnum = pgEnum('import_job_status', [
  'queued',
  'running',
  'ready',
  'failed',
]);
export type ImportJobStatus = (typeof importJobStatusEnum.enumValues)[number];

/** Machine-readable failure detail for a `failed` job (stored as text). */
export type ImportErrorCode =
  | 'NO_RECIPE'
  | 'MEDIA_UNAVAILABLE'
  | 'FETCH_FAILED'
  | 'EXTRACTION_FAILED'
  | 'TIMEOUT'
  | 'UNSUPPORTED';
