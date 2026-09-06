DROP INDEX `dynamic_cron_jobs_owner_uidx`;--> statement-breakpoint
ALTER TABLE `dynamic_cron_jobs` ADD `meal` text;--> statement-breakpoint
CREATE UNIQUE INDEX `dynamic_cron_jobs_owner_uidx` ON `dynamic_cron_jobs` (`owner_type`,`owner_id`,`job_type`,`meal`);--> statement-breakpoint
ALTER TABLE `household_preferences` ADD `timezone` text;