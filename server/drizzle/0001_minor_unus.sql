CREATE TABLE `fdc_food_nutrient` (
	`fdc_id` integer NOT NULL,
	`nutrient_number` text NOT NULL,
	`amount_per_100g` text NOT NULL,
	PRIMARY KEY(`fdc_id`, `nutrient_number`),
	FOREIGN KEY (`fdc_id`) REFERENCES `fdc_foods`(`fdc_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fdc_foods` (
	`fdc_id` integer PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`description_normalized` text NOT NULL,
	`category` text,
	`portions` text
);
--> statement-breakpoint
CREATE INDEX `fdc_foods_norm_idx` ON `fdc_foods` (`description_normalized`);