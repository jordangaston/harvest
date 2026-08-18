CREATE TABLE `user_allergens` (
	`user_id` text NOT NULL,
	`allergen` text NOT NULL,
	`severity` text NOT NULL,
	PRIMARY KEY(`user_id`, `allergen`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_diets` (
	`user_id` text NOT NULL,
	`diet_id` text NOT NULL,
	`strictness` text NOT NULL,
	PRIMARY KEY(`user_id`, `diet_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_food_prefs` (
	`user_id` text NOT NULL,
	`facet` text NOT NULL,
	`value` text NOT NULL,
	`sentiment` text NOT NULL,
	PRIMARY KEY(`user_id`, `facet`, `value`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`skill_level` text DEFAULT 'beginner' NOT NULL,
	`budget_cents_per_serving` integer,
	`time_budget_minutes` integer,
	`weight_cost` integer DEFAULT 1 NOT NULL,
	`weight_difficulty` integer DEFAULT 1 NOT NULL,
	`weight_nutrition` integer DEFAULT 1 NOT NULL,
	`weight_affinity` integer DEFAULT 1 NOT NULL,
	`weight_time` integer DEFAULT 1 NOT NULL,
	`weight_popularity` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
