ALTER TABLE `user_preferences` ADD `grocery_stores` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `household_adults` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `household_kids` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `eats_leftovers` integer DEFAULT true NOT NULL;