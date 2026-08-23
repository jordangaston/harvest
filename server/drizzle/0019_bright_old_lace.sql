ALTER TABLE `meal_plan_entries` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `meal_plan_entries` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `time_by_meal` text;