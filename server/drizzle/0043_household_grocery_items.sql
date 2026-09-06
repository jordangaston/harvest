-- groceries-chef WI-01: move grocery_items from user scope to HOUSEHOLD scope.
-- Hand-written (drizzle-kit's SQLite generator can't order an add→backfill→drop, and it
-- prompts for the user_id/household_id rename). 3 steps per DESIGN § Deployment; steps 1-2
-- are additive and re-runnable before step 3.

-- Step 1 — add the new columns, both nullable so existing rows survive.
ALTER TABLE `grocery_items` ADD `household_id` text REFERENCES households(id);--> statement-breakpoint
ALTER TABLE `grocery_items` ADD `added_by_user_id` text REFERENCES users(id);--> statement-breakpoint

-- Step 2 — backfill from the current owner. household_members.user_id is unique
-- (one household per user, v1), so the mapping is deterministic.
UPDATE `grocery_items`
SET `household_id` = (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = grocery_items.user_id),
    `added_by_user_id` = `user_id`;--> statement-breakpoint
-- Rows whose owner has no household (web-onboarding user, no membership) can't map — delete
-- them (a per-user list that can't become a household list is defunct under the new model).
DELETE FROM `grocery_items` WHERE `household_id` IS NULL;--> statement-breakpoint

-- Step 3 — backwards-INCOMPATIBLE: household_id not-null, drop user_id, re-key the index.
-- SQLite has no DROP COLUMN + add-NOT-NULL in place, so rebuild the table (the standard
-- 12-step recreate) and copy the surviving rows.
DROP INDEX `grocery_items_user_idx`;--> statement-breakpoint
CREATE TABLE `__new_grocery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`added_by_user_id` text,
	`name` text NOT NULL,
	`amount` text,
	`unit` text,
	`quantity_text` text,
	`aisle` text NOT NULL,
	`icon` text DEFAULT 'default' NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`source_recipe_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_grocery_items` (`id`, `household_id`, `added_by_user_id`, `name`, `amount`, `unit`, `quantity_text`, `aisle`, `icon`, `checked`, `source_recipe_id`, `position`, `created_at`)
SELECT `id`, `household_id`, `added_by_user_id`, `name`, `amount`, `unit`, `quantity_text`, `aisle`, `icon`, `checked`, `source_recipe_id`, `position`, `created_at` FROM `grocery_items`;--> statement-breakpoint
DROP TABLE `grocery_items`;--> statement-breakpoint
ALTER TABLE `__new_grocery_items` RENAME TO `grocery_items`;--> statement-breakpoint
CREATE INDEX `grocery_items_household_idx` ON `grocery_items` (`household_id`);
