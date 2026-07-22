-- This migration replaces the legacy player/phase deck projection with a
-- first-class player_decks parent. Preserve every legacy row while creating
-- one synthetic Melee deck per distinct player/phase pair.
PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
ALTER TABLE `player_deck_cards` RENAME TO `__legacy_player_deck_cards`;--> statement-breakpoint
ALTER TABLE `player_deck_companions` RENAME TO `__legacy_player_deck_companions`;--> statement-breakpoint
ALTER TABLE `player_deck_unresolved_cards` RENAME TO `__legacy_player_deck_unresolved_cards`;--> statement-breakpoint
DROP INDEX `player_deck_cards_player_phase_idx`;--> statement-breakpoint
DROP INDEX `player_deck_cards_card_idx`;--> statement-breakpoint
DROP INDEX `player_deck_companions_player_phase_idx`;--> statement-breakpoint
DROP INDEX `player_deck_companions_card_idx`;--> statement-breakpoint
DROP INDEX `player_deck_unresolved_cards_event_idx`;--> statement-breakpoint
DROP INDEX `player_deck_unresolved_cards_player_phase_idx`;--> statement-breakpoint
DROP INDEX `player_deck_unresolved_cards_lookup_idx`;--> statement-breakpoint
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
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `player_decks_event_id_idx` ON `player_decks` (`event_id`);--> statement-breakpoint
CREATE INDEX `player_decks_player_sort_idx` ON `player_decks` (`player_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `player_decks_format_idx` ON `player_decks` (`event_id`,`format_external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_external_unique_idx` ON `player_decks` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_primary_unique_idx` ON `player_decks` (`player_id`) WHERE "player_decks"."is_primary" = 1;--> statement-breakpoint
WITH `legacy_deck_keys` AS (
	SELECT `player_id`, `phase_id` FROM `__legacy_player_deck_cards`
	UNION
	SELECT `player_id`, `phase_id` FROM `__legacy_player_deck_companions`
	UNION
	SELECT `player_id`, `phase_id` FROM `__legacy_player_deck_unresolved_cards`
),
`legacy_decks` AS (
	SELECT
		`players`.`event_id` AS `event_id`,
		`legacy_deck_keys`.`player_id` AS `player_id`,
		`legacy_deck_keys`.`phase_id` AS `phase_id`,
		COALESCE(
			(
				SELECT MAX(`deck_name`)
				FROM `__legacy_player_deck_unresolved_cards` AS `unresolved`
				WHERE `unresolved`.`player_id` = `legacy_deck_keys`.`player_id`
					AND `unresolved`.`phase_id` = `legacy_deck_keys`.`phase_id`
			),
			`phases`.`name`,
			'Imported deck'
		) AS `name`,
		COALESCE(`phases`.`format_external_id`, '') AS `format_external_id`,
		ROW_NUMBER() OVER (
			PARTITION BY `legacy_deck_keys`.`player_id`
			ORDER BY `legacy_deck_keys`.`phase_id`
		) - 1 AS `sort_order`
	FROM `legacy_deck_keys`
	INNER JOIN `players` ON `players`.`id` = `legacy_deck_keys`.`player_id`
	LEFT JOIN `phases` ON `phases`.`id` = `legacy_deck_keys`.`phase_id`
)
INSERT INTO `player_decks` (
	`event_id`,
	`player_id`,
	`external_id`,
	`external_source`,
	`format_external_id`,
	`name`,
	`colors`,
	`sort_order`,
	`is_primary`
)
SELECT
	`event_id`,
	`player_id`,
	'legacy:' || `player_id` || ':' || `phase_id`,
	'melee',
	`format_external_id`,
	`name`,
	'',
	`sort_order`,
	CASE WHEN `sort_order` = 0 THEN 1 ELSE 0 END
FROM `legacy_decks`;--> statement-breakpoint
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
SELECT
	`legacy`.`id`,
	`decks`.`id`,
	`legacy`.`card_id`,
	`legacy`.`quantity`,
	`legacy`.`compartment`,
	`legacy`.`sort_order`
FROM `__legacy_player_deck_cards` AS `legacy`
INNER JOIN `player_decks` AS `decks`
	ON `decks`.`player_id` = `legacy`.`player_id`
		AND `decks`.`external_id` = 'legacy:' || `legacy`.`player_id` || ':' || `legacy`.`phase_id`
		AND `decks`.`external_source` = 'melee';--> statement-breakpoint
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
SELECT
	`legacy`.`id`,
	`decks`.`id`,
	`legacy`.`companion_card_id`,
	`legacy`.`source`,
	`legacy`.`created_at`,
	`legacy`.`updated_at`
FROM `__legacy_player_deck_companions` AS `legacy`
INNER JOIN `player_decks` AS `decks`
	ON `decks`.`player_id` = `legacy`.`player_id`
		AND `decks`.`external_id` = 'legacy:' || `legacy`.`player_id` || ':' || `legacy`.`phase_id`
		AND `decks`.`external_source` = 'melee';--> statement-breakpoint
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
	`legacy`.`id`,
	`decks`.`id`,
	`legacy`.`entry_type`,
	`legacy`.`original_name`,
	`legacy`.`normalized_original_name`,
	`legacy`.`set_code`,
	`legacy`.`normalized_set_code`,
	`legacy`.`quantity`,
	`legacy`.`compartment`,
	`legacy`.`sort_order`,
	`legacy`.`card_type`,
	`legacy`.`created_at`,
	`legacy`.`updated_at`
FROM `__legacy_player_deck_unresolved_cards` AS `legacy`
INNER JOIN `player_decks` AS `decks`
	ON `decks`.`player_id` = `legacy`.`player_id`
		AND `decks`.`external_id` = 'legacy:' || `legacy`.`player_id` || ':' || `legacy`.`phase_id`
		AND `decks`.`external_source` = 'melee';--> statement-breakpoint
DROP TABLE `__legacy_player_deck_unresolved_cards`;--> statement-breakpoint
DROP TABLE `__legacy_player_deck_companions`;--> statement-breakpoint
DROP TABLE `__legacy_player_deck_cards`;--> statement-breakpoint
PRAGMA defer_foreign_keys = OFF;
