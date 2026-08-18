CREATE TABLE `recipe_swipes` (
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`direction` text NOT NULL,
	`reason` text,
	`score` real NOT NULL,
	`weights` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_swipes_user_idx` ON `recipe_swipes` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `cookbooks` ADD `system_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cookbooks_system_slug_uidx` ON `cookbooks` (`user_id`,`system_slug`);