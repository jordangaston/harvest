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

export const importJobStatusEnum = pgEnum('import_job_status', [
  'queued',
  'running',
  'ready',
  'no_recipe',
  'failed',
]);
export type ImportJobStatus = (typeof importJobStatusEnum.enumValues)[number];
