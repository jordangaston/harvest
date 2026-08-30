CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_user_id_unique` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `household_preferences` (
	`household_id` text PRIMARY KEY NOT NULL,
	`grocery_stores` text,
	`grocery_shopping_day` text,
	`weekly_budget_cents` integer,
	`weekly_meals` text,
	`time_by_meal` text,
	`time_budget_minutes` integer,
	`cook_days_count` integer,
	`eats_leftovers` integer DEFAULT true NOT NULL,
	`owned_equipment` text,
	`equipment_reviewed` integer DEFAULT false NOT NULL,
	`household_adults` integer DEFAULT 2 NOT NULL,
	`household_kids` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`definition` text NOT NULL,
	`status` text NOT NULL,
	`stack_position` integer NOT NULL,
	`context` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `objectives_thread_idx` ON `objectives` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `objectives_one_active_per_thread` ON `objectives` (`thread_id`) WHERE `status` = 'active';--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`objective_id` text NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`member_user_id` text,
	`required` integer NOT NULL,
	`status` text DEFAULT 'unasked' NOT NULL,
	`value` text,
	`follow_ups_sent` integer DEFAULT 0 NOT NULL,
	`follow_up_timer_id` text,
	FOREIGN KEY (`objective_id`) REFERENCES `objectives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slots_objective_key_member_uidx` ON `slots` (`objective_id`,`key`,`member_user_id`);--> statement-breakpoint
CREATE INDEX `slots_objective_status_idx` ON `slots` (`objective_id`,`status`);