CREATE TABLE `ingredient_distinctiveness` (
	`base_ingredient_id` text PRIMARY KEY NOT NULL,
	`document_frequency` integer NOT NULL,
	`idf` real NOT NULL,
	FOREIGN KEY (`base_ingredient_id`) REFERENCES `taste_ingredients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipe_taste_profiles` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`weights` text NOT NULL,
	`built_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
