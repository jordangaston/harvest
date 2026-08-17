CREATE TABLE `fdc_food_allergen` (
	`fdc_id` integer NOT NULL,
	`allergen` text NOT NULL,
	`presence` text NOT NULL,
	`species` text,
	PRIMARY KEY(`fdc_id`, `allergen`),
	FOREIGN KEY (`fdc_id`) REFERENCES `fdc_foods`(`fdc_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fdc_food_allergen_fdc_idx` ON `fdc_food_allergen` (`fdc_id`);--> statement-breakpoint
ALTER TABLE `recipes` ADD `allergens` text;--> statement-breakpoint
ALTER TABLE `recipes` ADD `allergens_complete` integer DEFAULT false NOT NULL;