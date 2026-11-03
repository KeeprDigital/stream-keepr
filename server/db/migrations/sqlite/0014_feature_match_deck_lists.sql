CREATE TABLE `feature_match_deck_list_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_list_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`quantity` integer NOT NULL,
	`card_number` text NOT NULL,
	`name` text,
	`category` text,
	`colors` text,
	`cost` integer,
	`power` integer,
	`counter` integer,
	`image_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_list_id`) REFERENCES `feature_match_deck_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_deck_list_entries_order_idx` ON `feature_match_deck_list_entries` (`deck_list_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `feature_match_deck_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	`source_text` text NOT NULL,
	`mainboard_count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `feature_match_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feature_match_deck_lists_event_id_idx` ON `feature_match_deck_lists` (`event_id`);--> statement-breakpoint
CREATE INDEX `feature_match_deck_lists_slot_id_idx` ON `feature_match_deck_lists` (`slot_id`);