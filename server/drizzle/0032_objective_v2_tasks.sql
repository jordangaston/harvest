DROP TABLE `slots`;--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`kind` text NOT NULL,
	`fact` text,
	`fact_type` text,
	`scope` text NOT NULL,
	`member_user_id` text,
	`required` integer NOT NULL,
	`status` text DEFAULT 'unasked' NOT NULL,
	`solo` integer DEFAULT false NOT NULL,
	`after_task_ids` text DEFAULT '[]' NOT NULL,
	`follow_ups_sent` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_objective_fact_member_uidx` ON `tasks` (`objective_id`,`fact`,`member_user_id`);--> statement-breakpoint
CREATE INDEX `tasks_objective_status_idx` ON `tasks` (`objective_id`,`status`);
