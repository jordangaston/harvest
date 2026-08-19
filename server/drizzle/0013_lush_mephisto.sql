CREATE TABLE `recipe_equipment` (
	`recipe_id` text NOT NULL,
	`equipment` text NOT NULL,
	`essentiality` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `equipment`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_equipment_lookup_idx` ON `recipe_equipment` (`equipment`);--> statement-breakpoint
CREATE TABLE `user_equipment` (
	`user_id` text NOT NULL,
	`equipment` text NOT NULL,
	PRIMARY KEY(`user_id`, `equipment`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `recipe_steps` ADD `equipment` text;--> statement-breakpoint
ALTER TABLE `recipes` ADD `equipment_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `equipment_reviewed` integer DEFAULT false NOT NULL;