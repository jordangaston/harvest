CREATE TABLE `dynamic_cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`input` text NOT NULL,
	`cron_expression` text DEFAULT '*/5 * * * *' NOT NULL,
	`next_run_at` integer NOT NULL,
	`is_paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dynamic_cron_jobs_owner_uidx` ON `dynamic_cron_jobs` (`owner_type`,`owner_id`,`job_type`);--> statement-breakpoint
CREATE INDEX `dynamic_cron_jobs_due_idx` ON `dynamic_cron_jobs` (`is_paused`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `nudged_at` integer;