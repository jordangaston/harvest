PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
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
	`nrf_score` text,
	`difficulty_score` text,
	`difficulty_band` text,
	`allergens` text,
	`allergens_complete` integer DEFAULT false NOT NULL,
	`cost_per_serving_cents` integer,
	`cost_coverage` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_recipes`("id", "user_id", "title", "source_type", "source_url", "servings", "servings_estimated", "total_minutes", "image_url", "confidence", "calories", "grams_of_fat", "grams_of_saturated_fat", "grams_of_carbohydrate", "grams_of_fiber", "grams_of_sugar", "grams_of_protein", "milligrams_of_sodium", "nutrition_source", "nrf_score", "difficulty_score", "difficulty_band", "allergens", "allergens_complete", "cost_per_serving_cents", "cost_coverage", "created_at") SELECT "id", "user_id", "title", "source_type", "source_url", "servings", "servings_estimated", "total_minutes", "image_url", "confidence", "calories", "grams_of_fat", "grams_of_saturated_fat", "grams_of_carbohydrate", "grams_of_fiber", "grams_of_sugar", "grams_of_protein", "milligrams_of_sodium", "nutrition_source", "nrf_score", "difficulty_score", "difficulty_band", "allergens", "allergens_complete", "cost_per_serving_cents", "cost_coverage", "created_at" FROM `recipes`;--> statement-breakpoint
DROP TABLE `recipes`;--> statement-breakpoint
ALTER TABLE `__new_recipes` RENAME TO `recipes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `recipes_user_idx` ON `recipes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recipes_difficulty_band_idx` ON `recipes` (`difficulty_band`);