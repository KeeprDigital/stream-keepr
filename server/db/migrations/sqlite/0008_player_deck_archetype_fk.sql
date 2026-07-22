-- Migration 0005 added this reference with SQLite's default NO ACTION. Rebuild
-- the parent table so deleting an archetype matches the Drizzle schema. Child
-- rows are copied to FK-free backup tables first because D1's deferred foreign
-- keys do not suppress ON DELETE CASCADE actions during a parent-table rebuild.
PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
CREATE TABLE `__backup_player_deck_cards` AS SELECT * FROM `player_deck_cards`;--> statement-breakpoint
CREATE TABLE `__backup_player_deck_companions` AS SELECT * FROM `player_deck_companions`;--> statement-breakpoint
CREATE TABLE `__backup_player_deck_unresolved_cards` AS SELECT * FROM `player_deck_unresolved_cards`;--> statement-breakpoint
DROP TABLE `player_deck_unresolved_cards`;--> statement-breakpoint
DROP TABLE `player_deck_companions`;--> statement-breakpoint
DROP TABLE `player_deck_cards`;--> statement-breakpoint
ALTER TABLE `player_decks` RENAME TO `__old_player_decks`;--> statement-breakpoint
CREATE TABLE `player_decks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`external_source` text NOT NULL,
	`format_external_id` text NOT NULL,
	`name` text NOT NULL,
	`colors` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archetype_id` integer,
	`reviewed_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`archetype_id`) REFERENCES `archetypes`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `player_decks` (
	`id`,
	`event_id`,
	`player_id`,
	`external_id`,
	`external_source`,
	`format_external_id`,
	`name`,
	`colors`,
	`sort_order`,
	`is_primary`,
	`created_at`,
	`updated_at`,
	`archetype_id`,
	`reviewed_at`
)
SELECT
	`id`,
	`event_id`,
	`player_id`,
	`external_id`,
	`external_source`,
	`format_external_id`,
	`name`,
	`colors`,
	`sort_order`,
	`is_primary`,
	`created_at`,
	`updated_at`,
	`archetype_id`,
	`reviewed_at`
FROM `__old_player_decks`;--> statement-breakpoint
DROP TABLE `__old_player_decks`;--> statement-breakpoint
CREATE INDEX `player_decks_event_id_idx` ON `player_decks` (`event_id`);--> statement-breakpoint
CREATE INDEX `player_decks_player_sort_idx` ON `player_decks` (`player_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `player_decks_format_idx` ON `player_decks` (`event_id`,`format_external_id`);--> statement-breakpoint
CREATE INDEX `player_decks_archetype_idx` ON `player_decks` (`archetype_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_external_unique_idx` ON `player_decks` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_primary_unique_idx` ON `player_decks` (`player_id`) WHERE "player_decks"."is_primary" = 1;--> statement-breakpoint
CREATE TABLE `player_deck_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`compartment` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `player_decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `player_deck_cards_deck_sort_idx` ON `player_deck_cards` (`deck_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `player_deck_cards_card_idx` ON `player_deck_cards` (`card_id`);--> statement-breakpoint
INSERT INTO `player_deck_cards` (`id`, `deck_id`, `card_id`, `quantity`, `compartment`, `sort_order`)
SELECT `id`, `deck_id`, `card_id`, `quantity`, `compartment`, `sort_order`
FROM `__backup_player_deck_cards`;--> statement-breakpoint
CREATE TABLE `player_deck_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`companion_card_id` integer,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `player_decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE UNIQUE INDEX `player_deck_companions_deck_idx` ON `player_deck_companions` (`deck_id`);--> statement-breakpoint
CREATE INDEX `player_deck_companions_card_idx` ON `player_deck_companions` (`companion_card_id`);--> statement-breakpoint
INSERT INTO `player_deck_companions` (`id`, `deck_id`, `companion_card_id`, `source`, `created_at`, `updated_at`)
SELECT `id`, `deck_id`, `companion_card_id`, `source`, `created_at`, `updated_at`
FROM `__backup_player_deck_companions`;--> statement-breakpoint
CREATE TABLE `player_deck_unresolved_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`entry_type` text NOT NULL,
	`original_name` text NOT NULL,
	`normalized_original_name` text NOT NULL,
	`set_code` text,
	`normalized_set_code` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`compartment` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`card_type` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `player_decks`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_deck_idx` ON `player_deck_unresolved_cards` (`deck_id`);--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_lookup_idx` ON `player_deck_unresolved_cards` (`normalized_original_name`,`normalized_set_code`,`entry_type`);--> statement-breakpoint
INSERT INTO `player_deck_unresolved_cards` (
	`id`,
	`deck_id`,
	`entry_type`,
	`original_name`,
	`normalized_original_name`,
	`set_code`,
	`normalized_set_code`,
	`quantity`,
	`compartment`,
	`sort_order`,
	`card_type`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`deck_id`,
	`entry_type`,
	`original_name`,
	`normalized_original_name`,
	`set_code`,
	`normalized_set_code`,
	`quantity`,
	`compartment`,
	`sort_order`,
	`card_type`,
	`created_at`,
	`updated_at`
FROM `__backup_player_deck_unresolved_cards`;--> statement-breakpoint
DROP TABLE `__backup_player_deck_unresolved_cards`;--> statement-breakpoint
DROP TABLE `__backup_player_deck_companions`;--> statement-breakpoint
DROP TABLE `__backup_player_deck_cards`;--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
