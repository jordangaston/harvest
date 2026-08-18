CREATE TABLE `fdc_food_price` (
	`fdc_id` integer PRIMARY KEY NOT NULL,
	`food_code` text NOT NULL,
	`price_per_100g` text NOT NULL,
	`method` text,
	`source_cycle` text NOT NULL,
	FOREIGN KEY (`fdc_id`) REFERENCES `fdc_foods`(`fdc_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `recipes` ADD `cost_per_serving_cents` integer;--> statement-breakpoint
ALTER TABLE `recipes` ADD `cost_coverage` text;