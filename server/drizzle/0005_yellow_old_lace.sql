CREATE TABLE `recipe_categories` (
	`recipe_id` text NOT NULL,
	`facet` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `facet`, `value`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_categories_value_idx` ON `recipe_categories` (`facet`,`value`);