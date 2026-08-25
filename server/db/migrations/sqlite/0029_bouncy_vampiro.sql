CREATE TABLE `broadcast_deck_list_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`compartment` text NOT NULL,
	`quantity` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`canonical_name` text NOT NULL,
	`scryfall_id` text NOT NULL,
	`oracle_id` text,
	`set_code` text NOT NULL,
	`collector_number` text,
	`card_type` text,
	`colors` text,
	`mana_cost` text,
	`mana_value` real,
	`deck_counter_types` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `broadcast_deck_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_deck_list_entries_list_id_idx` ON `broadcast_deck_list_entries` (`list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_deck_list_entries_order_idx` ON `broadcast_deck_list_entries` (`list_id`,`compartment`,`sort_order`);--> statement-breakpoint
CREATE TABLE `broadcast_deck_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`source_text` text NOT NULL,
	`archetype_label` text,
	`colors` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`operation_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_deck_lists_event_id_idx` ON `broadcast_deck_lists` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_deck_lists_event_name_idx` ON `broadcast_deck_lists` (`event_id`,`normalized_name`);--> statement-breakpoint
ALTER TABLE `events` ADD `broadcast_deck_lists_enabled` integer DEFAULT false NOT NULL;