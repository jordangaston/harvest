ALTER TABLE `users` ADD `device_key` text;--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "phone" TO "phone" text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_device_key_uidx` ON `users` (`device_key`);