CREATE TABLE `live_state_command_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`aggregate_kind` text NOT NULL,
	`aggregate_id` integer NOT NULL,
	`command_id` text NOT NULL,
	`command_type` text NOT NULL,
	`content_key` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `live_state_command_receipts_event_id_idx` ON `live_state_command_receipts` (`event_id`);--> statement-breakpoint
CREATE INDEX `live_state_command_receipts_aggregate_idx` ON `live_state_command_receipts` (`aggregate_kind`,`aggregate_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_state_command_receipts_command_idx` ON `live_state_command_receipts` (`aggregate_kind`,`aggregate_id`,`command_id`);--> statement-breakpoint
DROP TABLE `feature_match_session_events`;