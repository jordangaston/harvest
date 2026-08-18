ALTER TABLE `recipe_steps` ADD `difficulty` integer;--> statement-breakpoint
ALTER TABLE `recipes` ADD `difficulty_score` text;--> statement-breakpoint
ALTER TABLE `recipes` ADD `difficulty_band` text;--> statement-breakpoint
CREATE INDEX `recipes_difficulty_band_idx` ON `recipes` (`difficulty_band`);