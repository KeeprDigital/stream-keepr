CREATE TABLE `feature_match_deck_list_mtg_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_list_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`quantity` integer NOT NULL,
	`canonical_name` text NOT NULL,
	`scryfall_id` text NOT NULL,
	`set_code` text NOT NULL,
	`collector_number` text,
	`card_type` text,
	`colors` text,
	`mana_cost` text,
	`mana_value` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_list_id`) REFERENCES `feature_match_deck_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_deck_list_mtg_entries_order_idx` ON `feature_match_deck_list_mtg_entries` (`deck_list_id`,`sort_order`);