CREATE TABLE `cuisines` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`parent_slug` text,
	FOREIGN KEY (`parent_slug`) REFERENCES `cuisines`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `taste_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`section` text NOT NULL,
	`food_group` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fdc_foods` ADD `food_code` integer;--> statement-breakpoint
ALTER TABLE `fdc_foods` ADD `wweia_category_code` integer;--> statement-breakpoint
ALTER TABLE `fdc_foods` ADD `base_ingredient_id` text REFERENCES taste_ingredients(id);--> statement-breakpoint
ALTER TABLE `ingredients` ADD `fdc_id` integer REFERENCES fdc_foods(fdc_id);--> statement-breakpoint
ALTER TABLE `ingredients` ADD `match_quality` text;--> statement-breakpoint
CREATE INDEX `ingredients_fdc_idx` ON `ingredients` (`fdc_id`);