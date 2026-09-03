ALTER TABLE `thread_messages` ADD `trigger_id` text;--> statement-breakpoint
CREATE INDEX `thread_messages_trigger_idx` ON `thread_messages` (`thread_id`,`trigger_id`);