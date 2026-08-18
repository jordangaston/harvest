CREATE TABLE `recipe_diets` (
	`recipe_id` text NOT NULL,
	`diet_id` text NOT NULL,
	`verdict` text NOT NULL,
	`blocker_kind` text,
	`blocker_value` text,
	`blocker_class` text,
	PRIMARY KEY(`recipe_id`, `diet_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_diets_lookup_idx` ON `recipe_diets` (`diet_id`,`verdict`);