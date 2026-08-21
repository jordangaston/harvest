ALTER TABLE `user_preferences` ADD `time_by_meal` text;--> statement-breakpoint
-- Backfill: existing scalar time_budget_minutes → equal per-meal budgets {t,t,t}.
-- json_object emits the same JSON-string shape drizzle's `mode: 'json'` reads back.
UPDATE `user_preferences`
SET `time_by_meal` = json_object('breakfast', `time_budget_minutes`, 'lunch', `time_budget_minutes`, 'dinner', `time_budget_minutes`)
WHERE `time_budget_minutes` IS NOT NULL AND `time_by_meal` IS NULL;