CREATE TABLE `cookbook_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`cookbook_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cookbook_id`) REFERENCES `cookbooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookbook_recipes_uidx` ON `cookbook_recipes` (`cookbook_id`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `cookbook_recipes_cookbook_idx` ON `cookbook_recipes` (`cookbook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cookbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cookbooks_user_name_uidx` ON `cookbooks` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `cookbooks_user_idx` ON `cookbooks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_job_recipes` (
	`import_job_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`import_job_id`, `recipe_id`),
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`recipe_id` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_jobs_user_idx` ON `import_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`quantity_text` text,
	`amount` text,
	`unit` text,
	`icon` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`servings` integer,
	`servings_estimated` integer DEFAULT false NOT NULL,
	`total_minutes` integer,
	`image_url` text,
	`confidence` text,
	`calories` text,
	`grams_of_fat` text,
	`grams_of_saturated_fat` text,
	`grams_of_carbohydrate` text,
	`grams_of_fiber` text,
	`grams_of_sugar` text,
	`grams_of_protein` text,
	`milligrams_of_sodium` text,
	`nutrition_source` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipes_user_idx` ON `recipes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`jwt_private_key` text NOT NULL,
	`jwt_public_key` text NOT NULL,
	`access_token_nonce` integer DEFAULT 0 NOT NULL,
	`refresh_token_nonce` integer DEFAULT 0 NOT NULL,
	`goals` text,
	`recipe_sources` text,
	`cook_days` text,
	`when_cook` text,
	`cook_time` text,
	`how_heard` text,
	`age` text,
	`onboarding_completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_uidx` ON `users` (`phone`);