ALTER TABLE `recipes` ADD `meal_prep_fit` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `weight_meal_prep` integer DEFAULT 1 NOT NULL;