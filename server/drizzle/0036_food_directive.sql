-- WI-1: evolve user_food_prefs into a scoped directive
-- {dimension, value, scope, direction, strength, target?, unit?}. SQLite can't rename a column,
-- widen an enum, or change a PK in place, so recreate the table and backfill every legacy row:
--   dimension ← facet; scope ← 'recipe'; strength ← 'soft';
--   direction ← 'less' when sentiment='dislike' OR target<0, else 'more'.
CREATE TABLE `__new_user_food_prefs` (
	`user_id` text NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`scope` text DEFAULT 'recipe' NOT NULL,
	`direction` text NOT NULL,
	`strength` text DEFAULT 'soft' NOT NULL,
	`target` real,
	`unit` text,
	`reason` text,
	PRIMARY KEY(`user_id`, `dimension`, `value`, `scope`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_food_prefs` (`user_id`, `dimension`, `value`, `scope`, `direction`, `strength`, `target`, `reason`)
SELECT
	`user_id`,
	`facet`,
	`value`,
	'recipe',
	CASE WHEN `sentiment` = 'dislike' OR `target` < 0 THEN 'less' ELSE 'more' END,
	'soft',
	`target`,
	`reason`
FROM `user_food_prefs`;
--> statement-breakpoint
DROP TABLE `user_food_prefs`;
--> statement-breakpoint
ALTER TABLE `__new_user_food_prefs` RENAME TO `user_food_prefs`;
