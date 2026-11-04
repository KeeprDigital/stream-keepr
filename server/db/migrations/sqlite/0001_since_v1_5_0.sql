-- Hand-written: every schema change made after v1.5.0, which shipped with only
-- `0000_baseline` applied. These were 21 unreleased migrations, squashed
-- before release (#953, ADR-0071) by concatenating them verbatim in their original
-- order, so a v1.5.0 database's rows take every backfill and rewrite exactly as
-- the separate files gave them. Each section keeps its original name.

-- Section: auth_rate_limit
CREATE TABLE `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rateLimit_key_unique` ON `rateLimit` (`key`);
--> statement-breakpoint

-- Section: feature_match_notes_enabled
ALTER TABLE `events` ADD `feature_match_notes_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Hand-written: Events that existed before the toggle already use Feature Match Notes.
UPDATE `events` SET `feature_match_notes_enabled` = true;
--> statement-breakpoint

-- Section: top_cut_screen_mode_key
-- Hand-written: the Top Cut Bracket Screen Mode key `topCut` is now `top-cut` (#773, ADR-0043).
-- A Screen stores the key as its current mode, as a key of its mode configurations,
-- and as the root of the owner slots its Top Cut Bracket Background Layers index under.
UPDATE `screens` SET `current_mode` = 'top-cut' WHERE `current_mode` = 'topCut';
--> statement-breakpoint
-- json_insert leaves a `top-cut` config already there, as a Screen write keeps the current key's.
UPDATE `screens`
SET `mode_configs` = json_insert(
	json_remove(`mode_configs`, '$.topCut'),
	'$."top-cut"',
	json(`mode_configs` -> '$.topCut')
)
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$.topCut') IS NOT NULL ELSE 0 END;
--> statement-breakpoint
UPDATE `graphic_asset_references`
SET `owner_slot` = 'top-cut.' || substr(`owner_slot`, 8)
WHERE `owner_kind` = 'screen' AND substr(`owner_slot`, 1, 7) = 'topCut.';
--> statement-breakpoint

-- Section: player_manually_edited_fields
ALTER TABLE `players` ADD `manually_edited_fields` text;
--> statement-breakpoint

-- Section: melee_owned_match_results
-- Hand-written: a Match's result is Melee's alone (ADR-0047).
-- A manual Match carries no result: an operator could once enter one, and it is cleared.
UPDATE `matches`
SET `has_result` = 0, `player1_game_wins` = NULL, `player2_game_wins` = NULL, `game_draws` = NULL, `is_bye` = 0
WHERE `external_source` IS NOT 'melee';
--> statement-breakpoint
-- An unreported Match or a bye holds no Game Score.
UPDATE `matches`
SET `player1_game_wins` = NULL, `player2_game_wins` = NULL, `game_draws` = NULL
WHERE `has_result` = 0 OR `is_bye` = 1;
--> statement-breakpoint
-- Melee left a side's game wins, and the game draws, null where there were none.
UPDATE `matches`
SET `player1_game_wins` = coalesce(`player1_game_wins`, 0),
	`player2_game_wins` = coalesce(`player2_game_wins`, 0),
	`game_draws` = coalesce(`game_draws`, 0)
WHERE `has_result` = 1 AND `is_bye` = 0;
--> statement-breakpoint
-- Generated: Melee's result text is no longer kept; a Match's Game Score says it.
ALTER TABLE `matches` DROP COLUMN `result_string`;
--> statement-breakpoint

-- Section: event_untimed_label
ALTER TABLE `events` ADD `feature_match_default_untimed_label` text DEFAULT '' NOT NULL;
--> statement-breakpoint

-- Section: themes
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tokens` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `themes_name_idx` ON `themes` (`name`);--> statement-breakpoint
ALTER TABLE `events` ADD `theme_id` text REFERENCES themes(id) ON DELETE restrict;
--> statement-breakpoint

-- Section: event_canvas
ALTER TABLE `events` ADD `canvas_width` integer DEFAULT 1920 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `canvas_height` integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
-- Hand-written: a Screen has no canvas of its own; every Screen uses its Event Canvas (#821, ADR-0051).
UPDATE `screens`
SET `screen_config` = json_remove(`screen_config`, '$.width', '$.height')
WHERE CASE WHEN json_valid(`screen_config`) THEN json_type(`screen_config`, '$.width') IS NOT NULL OR json_type(`screen_config`, '$.height') IS NOT NULL ELSE 0 END;
--> statement-breakpoint

-- Section: screen_theme_overrides
ALTER TABLE `screens` ADD `theme_overrides` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint

-- Section: theme_graphic_asset_references
ALTER TABLE `themes` ADD `graphic_asset_reference_version` text;
--> statement-breakpoint

-- Section: drop_screen_config
-- A Screen holds no look of its own: it takes its Event's Theme (#826, ADR-0051).
-- Its background, text colours, padding, alignment and colour mode are dropped, not migrated.
ALTER TABLE `screens` DROP COLUMN `screen_config`;
--> statement-breakpoint

-- Section: remove_graphic_style_sets
DROP TABLE `animation_effect_presets`;--> statement-breakpoint
DROP TABLE `graphic_style_sets`;--> statement-breakpoint
DROP INDEX `broadcast_graphic_templates_style_set_idx`;--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` DROP COLUMN `style_set_id`;--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` DROP COLUMN `style_set_revision`;
--> statement-breakpoint

-- Section: melee_live_results
ALTER TABLE `events` ADD `melee_live_results_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_next_check_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_backoff_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_last_checked_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_last_change_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_error` text;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_stop_reason` text;
--> statement-breakpoint

-- Section: feature_match_deck_lists
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
--> statement-breakpoint

-- Section: screen_deck_source_slot_side
-- Hand-written: the Screen Deck-source guards also prove a Feature Match Slot side
-- Deck Source names a Slot of the Screen's Event (#876, ADR-0057). A Slot delete
-- clears the Deck Sources naming it in the same batch, ahead of the delete.
DROP TRIGGER IF EXISTS `screens_deck_source_insert_guard`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `screens_deck_source_update_guard`;--> statement-breakpoint
CREATE TRIGGER `screens_deck_source_insert_guard`
BEFORE INSERT ON `screens`
WHEN (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'player'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.playerId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `players`
		WHERE `players`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.playerId')
			AND `players`.`event_id` = NEW.`event_id`
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'broadcast'
	AND NOT EXISTS (
		SELECT 1
		FROM `broadcast_deck_lists`
		INNER JOIN `events` ON `events`.`id` = `broadcast_deck_lists`.`event_id`
		WHERE `broadcast_deck_lists`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.broadcastDeckListId')
			AND `broadcast_deck_lists`.`event_id` = NEW.`event_id`
			AND `events`.`broadcast_deck_lists_enabled` = 1
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'featureMatchSlot'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.slotId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `feature_match_slots`
		WHERE `feature_match_slots`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.slotId')
			AND `feature_match_slots`.`event_id` = NEW.`event_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;--> statement-breakpoint

CREATE TRIGGER `screens_deck_source_update_guard`
BEFORE UPDATE OF `mode_configs`, `event_id` ON `screens`
WHEN (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'player'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.playerId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `players`
		WHERE `players`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.playerId')
			AND `players`.`event_id` = NEW.`event_id`
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'broadcast'
	AND NOT EXISTS (
		SELECT 1
		FROM `broadcast_deck_lists`
		INNER JOIN `events` ON `events`.`id` = `broadcast_deck_lists`.`event_id`
		WHERE `broadcast_deck_lists`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.broadcastDeckListId')
			AND `broadcast_deck_lists`.`event_id` = NEW.`event_id`
			AND `events`.`broadcast_deck_lists_enabled` = 1
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'featureMatchSlot'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.slotId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `feature_match_slots`
		WHERE `feature_match_slots`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.slotId')
			AND `feature_match_slots`.`event_id` = NEW.`event_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;
--> statement-breakpoint

-- Section: event_conversion_target
ALTER TABLE `events` ADD `conversion_metric` text DEFAULT 'topN' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `conversion_threshold` integer DEFAULT 8 NOT NULL;
--> statement-breakpoint

-- Section: archetype_chart_series
ALTER TABLE `archetypes` ADD `chart_series` integer;
--> statement-breakpoint

-- Section: talent_photo
ALTER TABLE `event_talents` ADD `photo` text;--> statement-breakpoint
ALTER TABLE `event_talents` ADD `graphic_asset_reference_version` text;
--> statement-breakpoint

-- Section: installed_template_removal
ALTER TABLE `installed_graphics_templates` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `installed_graphics_templates` ADD `removed_by` text;
--> statement-breakpoint

-- Section: round_timing
ALTER TABLE `rounds` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `rounds` ADD `duration_minutes` integer;
--> statement-breakpoint

-- Section: talent_role
ALTER TABLE `event_talents` ADD `role` text;
