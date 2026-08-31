CREATE TABLE `imessage_import` (
	`job_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`target_external_id` text,
	`notified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imessage_import_job_id_unique` ON `imessage_import` (`job_id`);