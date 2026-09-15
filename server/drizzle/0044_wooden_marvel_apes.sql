CREATE TABLE `poll_stream_cursor` (
	`id` integer PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`poll_message_guid` text NOT NULL,
	`voter` text NOT NULL,
	`voter_user_id` text,
	`option_identifier` text NOT NULL,
	`selected` integer NOT NULL,
	`sequence` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`voter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_votes_guid_voter_option_uidx` ON `poll_votes` (`poll_message_guid`,`voter`,`option_identifier`);--> statement-breakpoint
CREATE INDEX `poll_votes_guid_idx` ON `poll_votes` (`poll_message_guid`);
