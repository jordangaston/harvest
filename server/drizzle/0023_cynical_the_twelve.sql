CREATE TABLE `thread_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`type` text NOT NULL,
	`sender_user_id` text,
	`body` text,
	`message_guid` text NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thread_messages_thread_id_idx` ON `thread_messages` (`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_messages_message_guid_uidx` ON `thread_messages` (`message_guid`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_guid` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`household_id` text,
	`last_processed_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_chat_guid_unique` ON `threads` (`chat_guid`);--> statement-breakpoint
ALTER TABLE `users` ADD `imessage_handle` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_imessage_handle_uidx` ON `users` (`imessage_handle`);