CREATE TABLE `animation_effect_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`selection` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `animation_effect_presets_name_idx` ON `animation_effect_presets` (`name`);--> statement-breakpoint
CREATE TABLE `archetype_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`archetype_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`archetype_id`) REFERENCES `archetypes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archetype_cards_unique_idx` ON `archetype_cards` (`archetype_id`,`card_id`);--> statement-breakpoint
CREATE INDEX `archetype_cards_archetype_idx` ON `archetype_cards` (`archetype_id`);--> statement-breakpoint
CREATE INDEX `archetype_cards_card_idx` ON `archetype_cards` (`card_id`);--> statement-breakpoint
CREATE TABLE `archetypes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`colors` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `archetypes_event_id_idx` ON `archetypes` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `archetypes_event_name_idx` ON `archetypes` (`event_id`,`name`);--> statement-breakpoint
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
CREATE TABLE `broadcast_graphic_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`graphic_asset_reference_version` text,
	`style_set_id` text,
	`style_set_revision` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `broadcast_graphic_templates_name_idx` ON `broadcast_graphic_templates` (`name`);--> statement-breakpoint
CREATE INDEX `broadcast_graphic_templates_style_set_idx` ON `broadcast_graphic_templates` (`style_set_id`);--> statement-breakpoint
CREATE TABLE `broadcast_graphics_live_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`screen_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_state` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_graphics_live_sessions_event_id_idx` ON `broadcast_graphics_live_sessions` (`event_id`);--> statement-breakpoint
CREATE INDEX `broadcast_graphics_live_sessions_screen_id_idx` ON `broadcast_graphics_live_sessions` (`screen_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_graphics_live_sessions_active_screen_idx` ON `broadcast_graphics_live_sessions` (`screen_id`) WHERE "broadcast_graphics_live_sessions"."status" = 'active';--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`game` text DEFAULT 'mtg' NOT NULL,
	`scryfall_id` text,
	`oracle_id` text,
	`card_type` text,
	`colors` text,
	`cmc` real,
	`mana_cost` text,
	`deck_counter_types` text DEFAULT '[]' NOT NULL,
	`deck_tokens` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_name_game_idx` ON `cards` (`name`,`game`);--> statement-breakpoint
CREATE INDEX `cards_game_idx` ON `cards` (`game`);--> statement-breakpoint
CREATE TABLE `event_card_name_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`input_name` text NOT NULL,
	`normalized_input_name` text NOT NULL,
	`input_set_code` text,
	`normalized_input_set_code` text DEFAULT '' NOT NULL,
	`resolved_card_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_card_name_overrides_event_idx` ON `event_card_name_overrides` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_card_name_overrides_card_idx` ON `event_card_name_overrides` (`resolved_card_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_card_name_overrides_event_input_idx` ON `event_card_name_overrides` (`event_id`,`normalized_input_name`,`normalized_input_set_code`);--> statement-breakpoint
CREATE TABLE `event_talents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`twitch_handle` text,
	`youtube_handle` text,
	`x_handle` text,
	`instagram_handle` text,
	`tiktok_handle` text,
	`bluesky_handle` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `talents_event_id_idx` ON `event_talents` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`game` text NOT NULL,
	`feature_match_orientation` text NOT NULL,
	`card_timeout` integer DEFAULT 0 NOT NULL,
	`num_feature_matches` integer DEFAULT 1 NOT NULL,
	`description` text,
	`holding_text` text,
	`commentator1_talent_id` integer,
	`commentator2_talent_id` integer,
	`melee_enabled` integer DEFAULT false NOT NULL,
	`points_system` text,
	`melee_event_id` text,
	`melee_client_id` text,
	`melee_client_secret` text,
	`initial_setup_completed_at` integer,
	`last_event_synced_at` integer,
	`last_players_synced_at` integer,
	`last_decklists_synced_at` integer,
	`last_sync_error` text,
	`melee_sync_lease_token` text,
	`melee_sync_lease_command` text,
	`melee_sync_lease_expires_at` integer,
	`display_record_separator` text DEFAULT '-' NOT NULL,
	`display_hide_zero_draws` integer DEFAULT true NOT NULL,
	`display_position_format` text DEFAULT 'ordinal' NOT NULL,
	`feature_match_default_best_of` integer DEFAULT 3 NOT NULL,
	`feature_match_default_starting_life` integer DEFAULT 20 NOT NULL,
	`feature_match_default_clock_type` text DEFAULT 'countdown' NOT NULL,
	`feature_match_default_clock_duration` integer DEFAULT 50 NOT NULL,
	`feature_match_default_count_up_after_countdown` integer DEFAULT false NOT NULL,
	`feature_match_default_turn_tracking_enabled` integer DEFAULT false NOT NULL,
	`feature_match_default_active_player_tracking_enabled` integer DEFAULT false NOT NULL,
	`feature_match_default_extra_turns_enabled` integer DEFAULT false NOT NULL,
	`feature_match_default_extra_turns` integer DEFAULT 5 NOT NULL,
	`feature_match_default_extra_turns_label` text DEFAULT 'Extra Turns' NOT NULL,
	`feature_match_default_mulligan_tracking_enabled` integer DEFAULT false NOT NULL,
	`standings_enabled` integer DEFAULT true NOT NULL,
	`broadcast_deck_lists_enabled` integer DEFAULT false NOT NULL,
	`lgs_enabled` integer DEFAULT false NOT NULL,
	`pronouns_enabled` integer DEFAULT true NOT NULL,
	`table_number_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`commentator1_talent_id`) REFERENCES `event_talents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`commentator2_talent_id`) REFERENCES `event_talents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `feature_match_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`round_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	`match_id` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `feature_match_slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feature_match_assignments_event_id_idx` ON `feature_match_assignments` (`event_id`);--> statement-breakpoint
CREATE INDEX `feature_match_assignments_round_idx` ON `feature_match_assignments` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_assignments_slot_unique_idx` ON `feature_match_assignments` (`round_id`,`slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_assignments_match_unique_idx` ON `feature_match_assignments` (`round_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `feature_match_layout_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`graphic_asset_reference_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feature_match_layout_templates_name_idx` ON `feature_match_layout_templates` (`name`);--> statement-breakpoint
CREATE TABLE `feature_match_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_snapshot` text NOT NULL,
	`current_state` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `feature_match_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feature_match_sessions_event_id_idx` ON `feature_match_sessions` (`event_id`);--> statement-breakpoint
CREATE INDEX `feature_match_sessions_slot_id_idx` ON `feature_match_sessions` (`slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_sessions_active_slot_idx` ON `feature_match_sessions` (`slot_id`) WHERE "feature_match_sessions"."status" = 'active';--> statement-breakpoint
CREATE TABLE `feature_match_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`match_id` integer,
	`external_id` text,
	`external_source` text,
	`table_number` integer,
	`round_name` text,
	`format_name` text,
	`player1_id` integer,
	`player2_id` integer,
	`player1_data` text,
	`player2_data` text,
	`best_of` integer DEFAULT 3 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`player_display_mode` text DEFAULT 'score' NOT NULL,
	`active_session_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`player1_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`player2_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`active_session_id`) REFERENCES `feature_match_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feature_match_slots_event_id_idx` ON `feature_match_slots` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_slots_external_unique_idx` ON `feature_match_slots` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_slots_match_unique_idx` ON `feature_match_slots` (`event_id`,`match_id`) WHERE "feature_match_slots"."match_id" is not null;--> statement-breakpoint
CREATE TABLE `graphic_style_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`draft_revision` integer DEFAULT 1 NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`published_at` integer,
	`operation_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_style_sets_name_idx` ON `graphic_style_sets` (`name`);--> statement-breakpoint
CREATE TABLE `graphics_authoring_leases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_kind` text NOT NULL,
	`artifact_id` text NOT NULL,
	`event_id` integer,
	`holder_session_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_authoring_leases_artifact_idx` ON `graphics_authoring_leases` (`artifact_kind`,`artifact_id`);--> statement-breakpoint
CREATE INDEX `graphics_authoring_leases_event_id_idx` ON `graphics_authoring_leases` (`event_id`);--> statement-breakpoint
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
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`round_id` integer NOT NULL,
	`external_id` text,
	`external_source` text,
	`table_number` integer,
	`player1_id` integer,
	`player2_id` integer,
	`player1_data` text,
	`player2_data` text,
	`has_result` integer DEFAULT false NOT NULL,
	`player1_game_wins` integer,
	`player2_game_wins` integer,
	`game_draws` integer,
	`is_bye` integer DEFAULT false NOT NULL,
	`result_string` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player1_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`player2_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `matches_event_id_idx` ON `matches` (`event_id`);--> statement-breakpoint
CREATE INDEX `matches_round_id_idx` ON `matches` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `matches_external_unique_idx` ON `matches` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE TABLE `phases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`external_id` text,
	`external_source` text,
	`format_external_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `phases_event_id_idx` ON `phases` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `phases_external_unique_idx` ON `phases` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE TABLE `player_deck_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`compartment` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `player_decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_deck_cards_deck_sort_idx` ON `player_deck_cards` (`deck_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `player_deck_cards_card_idx` ON `player_deck_cards` (`card_id`);--> statement-breakpoint
CREATE TABLE `player_deck_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`companion_card_id` integer,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `player_decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_deck_companions_deck_idx` ON `player_deck_companions` (`deck_id`);--> statement-breakpoint
CREATE INDEX `player_deck_companions_card_idx` ON `player_deck_companions` (`companion_card_id`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_deck_idx` ON `player_deck_unresolved_cards` (`deck_id`);--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_lookup_idx` ON `player_deck_unresolved_cards` (`normalized_original_name`,`normalized_set_code`,`entry_type`);--> statement-breakpoint
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
	`archetype_id` integer,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`archetype_id`) REFERENCES `archetypes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `player_decks_event_id_idx` ON `player_decks` (`event_id`);--> statement-breakpoint
CREATE INDEX `player_decks_player_sort_idx` ON `player_decks` (`player_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `player_decks_format_idx` ON `player_decks` (`event_id`,`format_external_id`);--> statement-breakpoint
CREATE INDEX `player_decks_archetype_idx` ON `player_decks` (`archetype_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_external_unique_idx` ON `player_decks` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_decks_primary_unique_idx` ON `player_decks` (`player_id`) WHERE "player_decks"."is_primary" = 1;--> statement-breakpoint
CREATE TABLE `player_list_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `player_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_list_members_unique` ON `player_list_members` (`list_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `player_list_members_list_id_idx` ON `player_list_members` (`list_id`);--> statement-breakpoint
CREATE INDEX `player_list_members_player_id_idx` ON `player_list_members` (`player_id`);--> statement-breakpoint
CREATE TABLE `player_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_lists_event_id_idx` ON `player_lists` (`event_id`);--> statement-breakpoint
CREATE TABLE `player_round_standings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`round_id` integer NOT NULL,
	`wins` integer,
	`losses` integer,
	`draws` integer,
	`position` integer,
	`points` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_round_standings_unique_idx` ON `player_round_standings` (`player_id`,`round_id`);--> statement-breakpoint
CREATE INDEX `player_round_standings_event_id_idx` ON `player_round_standings` (`event_id`);--> statement-breakpoint
CREATE INDEX `player_round_standings_round_id_idx` ON `player_round_standings` (`round_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`pronouns` text,
	`external_id` text,
	`external_source` text,
	`external_status` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`wins` integer,
	`losses` integer,
	`draws` integer,
	`position` integer,
	`points` integer,
	`archetype_id` integer,
	`lgs` text,
	`game_data` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`archetype_id`) REFERENCES `archetypes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `players_event_id_idx` ON `players` (`event_id`);--> statement-breakpoint
CREATE INDEX `players_event_active_idx` ON `players` (`event_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `players_external_unique_idx` ON `players` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`phase_id` integer NOT NULL,
	`external_id` text,
	`external_source` text,
	`name` text NOT NULL,
	`round_number` integer NOT NULL,
	`control_mode` text DEFAULT 'default' NOT NULL,
	`last_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`phase_id`) REFERENCES `phases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rounds_event_id_idx` ON `rounds` (`event_id`);--> statement-breakpoint
CREATE INDEX `rounds_phase_id_idx` ON `rounds` (`phase_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_external_unique_idx` ON `rounds` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE TABLE `screens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`current_mode` text DEFAULT 'background' NOT NULL,
	`mode_configs` text,
	`screen_config` text,
	`state_version` integer DEFAULT 0 NOT NULL,
	`graphic_asset_reference_version` text,
	`asset_capability_seed` text NOT NULL,
	`asset_capability_version` integer DEFAULT 1 NOT NULL,
	`asset_capability_digest` text NOT NULL,
	`active_card` text,
	`active_card_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `screens_event_id_idx` ON `screens` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `screens_slug_idx` ON `screens` (`event_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `screens_asset_capability_digest_idx` ON `screens` (`asset_capability_digest`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text,
	`banned` integer,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `graphic_asset_contents` (
	`digest` text PRIMARY KEY NOT NULL,
	`byte_length` integer NOT NULL,
	`canonical_mime` text NOT NULL,
	`availability` text DEFAULT 'available' NOT NULL,
	`unavailable_reason_code` text,
	`unavailable_since` integer,
	`reconciled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_asset_contents_availability_idx` ON `graphic_asset_contents` (`availability`);--> statement-breakpoint
CREATE INDEX `graphic_asset_contents_reconciled_idx` ON `graphic_asset_contents` (`reconciled_at`);--> statement-breakpoint
CREATE TABLE `graphic_asset_event_associations` (
	`asset_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`asset_id`, `event_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphic_asset_event_associations_event_idx` ON `graphic_asset_event_associations` (`event_id`);--> statement-breakpoint
CREATE TABLE `graphic_asset_origins` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`source_revision_number` integer NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphic_asset_origins_source_revision_idx` ON `graphic_asset_origins` (`source_asset_id`,`source_revision_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_origins_source_asset_idx` ON `graphic_asset_origins` (`source_asset_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_origins_asset_idx` ON `graphic_asset_origins` (`asset_id`);--> statement-breakpoint
CREATE TABLE `graphic_asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_slot` text NOT NULL,
	`event_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphic_asset_references_owner_slot_idx` ON `graphic_asset_references` (`owner_kind`,`owner_id`,`owner_slot`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_revision_idx` ON `graphic_asset_references` (`revision_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_asset_idx` ON `graphic_asset_references` (`asset_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_event_idx` ON `graphic_asset_references` (`event_id`);--> statement-breakpoint
CREATE TABLE `graphic_asset_revision_retention` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`unreferenced_since` integer NOT NULL,
	`prune_after` integer NOT NULL,
	`frozen_at` integer,
	`frozen_remaining_milliseconds` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphic_asset_revision_retention_prune_idx` ON `graphic_asset_revision_retention` (`prune_after`);--> statement-breakpoint
CREATE TABLE `graphic_asset_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`content_digest` text NOT NULL,
	`compatibility_profile` text NOT NULL,
	`technical_facts` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_digest`) REFERENCES `graphic_asset_contents`(`digest`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphic_asset_revisions_asset_number_idx` ON `graphic_asset_revisions` (`asset_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `graphic_asset_revisions_content_idx` ON `graphic_asset_revisions` (`content_digest`);--> statement-breakpoint
CREATE TABLE `graphic_asset_tombstones` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`purged_at` integer NOT NULL,
	`purge_reason` text NOT NULL,
	`revision_count` integer NOT NULL,
	`reference_count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graphic_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`lifecycle_state` text DEFAULT 'active' NOT NULL,
	`trash_prior_state` text,
	`trashed_at` integer,
	`trash_recoverable_until` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_assets_kind_state_idx` ON `graphic_assets` (`kind`,`lifecycle_state`);--> statement-breakpoint
CREATE INDEX `graphic_assets_name_idx` ON `graphic_assets` (`name`);--> statement-breakpoint
CREATE TABLE `graphics_asset_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`recorded_at` integer NOT NULL,
	`category` text NOT NULL,
	`actor` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`correlation_id` text NOT NULL,
	`detail` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_recorded_idx` ON `graphics_asset_evidence` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_expires_idx` ON `graphics_asset_evidence` (`expires_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_subject_idx` ON `graphics_asset_evidence` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_category_idx` ON `graphics_asset_evidence` (`category`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_actor_idx` ON `graphics_asset_evidence` (`actor`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_correlation_idx` ON `graphics_asset_evidence` (`correlation_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `graphics_canonical_write_candidates` (
	`operation_id` text NOT NULL,
	`digest` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`operation_id`, `digest`),
	FOREIGN KEY (`operation_id`) REFERENCES `graphics_ingestion_operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphics_canonical_write_candidates_digest_idx` ON `graphics_canonical_write_candidates` (`digest`);--> statement-breakpoint
CREATE TABLE `graphics_capacity_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`canonical_limit_bytes` integer DEFAULT 107374182400 NOT NULL,
	`staging_limit_bytes` integer DEFAULT 10737418240 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graphics_content_quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`byte_length` integer NOT NULL,
	`origin` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`deleting_since` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_content_quarantine_digest_idx` ON `graphics_content_quarantine` (`digest`);--> statement-breakpoint
CREATE INDEX `graphics_content_quarantine_delete_after_idx` ON `graphics_content_quarantine` (`delete_after`);--> statement-breakpoint
CREATE TABLE `graphics_derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_digest`) REFERENCES `graphic_asset_contents`(`digest`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_derivatives_source_kind_idx` ON `graphics_derivatives` (`source_revision_id`,`kind`);--> statement-breakpoint
CREATE INDEX `graphics_derivatives_content_idx` ON `graphics_derivatives` (`content_digest`);--> statement-breakpoint
CREATE TABLE `graphics_discrepancies` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`digest` text,
	`object_key` text,
	`derivative_id` text,
	`state` text DEFAULT 'open' NOT NULL,
	`reason_code` text NOT NULL,
	`isolated` integer DEFAULT false NOT NULL,
	`expected` text NOT NULL,
	`observed` text NOT NULL,
	`detected_at` integer NOT NULL,
	`last_checked_at` integer NOT NULL,
	`resolved_at` integer,
	`resolution` text,
	`working_copy_key` text,
	`working_copy_since` integer,
	`correlation_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_discrepancies_open_subject_idx` ON `graphics_discrepancies` (`kind`,`subject_key`) WHERE state = 'open';--> statement-breakpoint
CREATE INDEX `graphics_discrepancies_state_idx` ON `graphics_discrepancies` (`state`,`kind`);--> statement-breakpoint
CREATE INDEX `graphics_discrepancies_digest_idx` ON `graphics_discrepancies` (`digest`);--> statement-breakpoint
CREATE INDEX `graphics_discrepancies_working_copy_idx` ON `graphics_discrepancies` (`working_copy_since`);--> statement-breakpoint
CREATE TABLE `graphics_ingestion_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`source` text NOT NULL,
	`stage` text DEFAULT 'created' NOT NULL,
	`initiated_by` text NOT NULL,
	`proposed_name` text NOT NULL,
	`source_file_name` text,
	`declared_mime` text,
	`browser_decode_evidence` text,
	`duplicate_content_policy` text DEFAULT 'reuse' NOT NULL,
	`default_event_id` integer,
	`target_asset_id` text,
	`declared_byte_length` integer,
	`transferred_byte_length` integer DEFAULT 0 NOT NULL,
	`multipart_state` text,
	`package_preflight` text,
	`package_installation` text,
	`staging_reserved_byte_length` integer DEFAULT 0 NOT NULL,
	`staging_used_byte_length` integer DEFAULT 0 NOT NULL,
	`canonical_reserved_byte_length` integer DEFAULT 0 NOT NULL,
	`capacity_outcome` text,
	`report` text,
	`result` text,
	`failure` text,
	`transfer_completed_at` integer,
	`cancel_requested_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`default_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_ingestion_operations_author_idempotency_idx` ON `graphics_ingestion_operations` (`initiated_by`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `graphics_ingestion_operations_stage_idx` ON `graphics_ingestion_operations` (`stage`);--> statement-breakpoint
CREATE INDEX `graphics_ingestion_operations_event_idx` ON `graphics_ingestion_operations` (`default_event_id`);--> statement-breakpoint
CREATE TABLE `graphics_reconciliation_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`canonical_scan_cursor` text,
	`canonical_scan_started_at` integer,
	`last_sweep_correlation_id` text,
	`last_sweep_started_at` integer,
	`last_sweep_completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `installed_graphics_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`source_template_identity` text NOT NULL,
	`source_template_revision` integer,
	`installed_by_operation_id` text NOT NULL,
	`event_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_kind_idx` ON `installed_graphics_templates` (`kind`);--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_operation_idx` ON `installed_graphics_templates` (`installed_by_operation_id`);--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_source_idx` ON `installed_graphics_templates` (`source_template_identity`);--> statement-breakpoint

-- Hand-written below: drizzle-kit cannot express seed rows or triggers, so a
-- regenerated baseline omits them. Keep them when squashing again.

-- The installation's single capacity row; the Graphics Asset Library reads it
-- rather than creating it.
INSERT INTO `graphics_capacity_settings` (`id`) VALUES (1);--> statement-breakpoint

-- The reference proof executes inside the Screen INSERT/UPDATE statement. It is
-- therefore serialized with Broadcast Deck List deletion and Event disabling,
-- closing the gap between a pre-write reference check and the stateVersion write.
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
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;
