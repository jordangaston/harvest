DROP INDEX "cookbook_recipes_uidx";--> statement-breakpoint
DROP INDEX "cookbook_recipes_cookbook_idx";--> statement-breakpoint
DROP INDEX "cookbooks_user_name_uidx";--> statement-breakpoint
DROP INDEX "cookbooks_system_slug_uidx";--> statement-breakpoint
DROP INDEX "cookbooks_user_idx";--> statement-breakpoint
DROP INDEX "fdc_food_allergen_fdc_idx";--> statement-breakpoint
DROP INDEX "fdc_foods_norm_idx";--> statement-breakpoint
DROP INDEX "grocery_items_user_idx";--> statement-breakpoint
DROP INDEX "household_members_user_id_unique";--> statement-breakpoint
DROP INDEX "imessage_import_job_id_unique";--> statement-breakpoint
DROP INDEX "import_jobs_user_idx";--> statement-breakpoint
DROP INDEX "ingredients_fdc_idx";--> statement-breakpoint
DROP INDEX "meal_plan_entries_user_date_idx";--> statement-breakpoint
DROP INDEX "objectives_thread_idx";--> statement-breakpoint
DROP INDEX "recipe_categories_value_idx";--> statement-breakpoint
DROP INDEX "recipe_diets_lookup_idx";--> statement-breakpoint
DROP INDEX "recipe_equipment_lookup_idx";--> statement-breakpoint
DROP INDEX "recipe_swipes_user_idx";--> statement-breakpoint
DROP INDEX "recipes_user_idx";--> statement-breakpoint
DROP INDEX "recipes_difficulty_band_idx";--> statement-breakpoint
DROP INDEX "slots_objective_key_member_uidx";--> statement-breakpoint
DROP INDEX "slots_objective_status_idx";--> statement-breakpoint
DROP INDEX "thread_messages_thread_id_idx";--> statement-breakpoint
DROP INDEX "thread_messages_message_guid_uidx";--> statement-breakpoint
DROP INDEX "threads_chat_guid_unique";--> statement-breakpoint
DROP INDEX "users_phone_uidx";--> statement-breakpoint
DROP INDEX "users_device_key_uidx";--> statement-breakpoint
DROP INDEX "users_imessage_handle_uidx";--> statement-breakpoint
ALTER TABLE `user_food_prefs` ALTER COLUMN "sentiment" TO "sentiment" text;--> statement-breakpoint
CREATE UNIQUE INDEX `cookbook_recipes_uidx` ON `cookbook_recipes` (`cookbook_id`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `cookbook_recipes_cookbook_idx` ON `cookbook_recipes` (`cookbook_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cookbooks_user_name_uidx` ON `cookbooks` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `cookbooks_system_slug_uidx` ON `cookbooks` (`user_id`,`system_slug`);--> statement-breakpoint
CREATE INDEX `cookbooks_user_idx` ON `cookbooks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `fdc_food_allergen_fdc_idx` ON `fdc_food_allergen` (`fdc_id`);--> statement-breakpoint
CREATE INDEX `fdc_foods_norm_idx` ON `fdc_foods` (`description_normalized`);--> statement-breakpoint
CREATE INDEX `grocery_items_user_idx` ON `grocery_items` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_user_id_unique` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `imessage_import_job_id_unique` ON `imessage_import` (`job_id`);--> statement-breakpoint
CREATE INDEX `import_jobs_user_idx` ON `import_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ingredients_fdc_idx` ON `ingredients` (`fdc_id`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_user_date_idx` ON `meal_plan_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `objectives_thread_idx` ON `objectives` (`thread_id`);--> statement-breakpoint
CREATE INDEX `recipe_categories_value_idx` ON `recipe_categories` (`facet`,`value`);--> statement-breakpoint
CREATE INDEX `recipe_diets_lookup_idx` ON `recipe_diets` (`diet_id`,`verdict`);--> statement-breakpoint
CREATE INDEX `recipe_equipment_lookup_idx` ON `recipe_equipment` (`equipment`);--> statement-breakpoint
CREATE INDEX `recipe_swipes_user_idx` ON `recipe_swipes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recipes_user_idx` ON `recipes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recipes_difficulty_band_idx` ON `recipes` (`difficulty_band`);--> statement-breakpoint
CREATE UNIQUE INDEX `slots_objective_key_member_uidx` ON `slots` (`objective_id`,`key`,`member_user_id`);--> statement-breakpoint
CREATE INDEX `slots_objective_status_idx` ON `slots` (`objective_id`,`status`);--> statement-breakpoint
CREATE INDEX `thread_messages_thread_id_idx` ON `thread_messages` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_messages_message_guid_uidx` ON `thread_messages` (`message_guid`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_chat_guid_unique` ON `threads` (`chat_guid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_uidx` ON `users` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_device_key_uidx` ON `users` (`device_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_imessage_handle_uidx` ON `users` (`imessage_handle`);--> statement-breakpoint
ALTER TABLE `user_food_prefs` ADD `target` real;--> statement-breakpoint
ALTER TABLE `user_food_prefs` ADD `reason` text;