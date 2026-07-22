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
CREATE TABLE `feature_match_session_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`command_id` text NOT NULL,
	`origin_connection_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `feature_match_slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `feature_match_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feature_match_session_events_event_id_idx` ON `feature_match_session_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `feature_match_session_events_slot_id_idx` ON `feature_match_session_events` (`slot_id`);--> statement-breakpoint
CREATE INDEX `feature_match_session_events_session_id_idx` ON `feature_match_session_events` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_session_events_sequence_idx` ON `feature_match_session_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_session_events_command_idx` ON `feature_match_session_events` (`session_id`,`command_id`);--> statement-breakpoint
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
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `phases_event_id_idx` ON `phases` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `phases_external_unique_idx` ON `phases` (`event_id`,`external_id`,`external_source`);--> statement-breakpoint
CREATE TABLE `player_deck_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`phase_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`compartment` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_deck_cards_player_phase_idx` ON `player_deck_cards` (`player_id`,`phase_id`);--> statement-breakpoint
CREATE INDEX `player_deck_cards_card_idx` ON `player_deck_cards` (`card_id`);--> statement-breakpoint
CREATE TABLE `player_deck_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`phase_id` integer NOT NULL,
	`companion_card_id` integer,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_deck_companions_player_phase_idx` ON `player_deck_companions` (`player_id`,`phase_id`);--> statement-breakpoint
CREATE INDEX `player_deck_companions_card_idx` ON `player_deck_companions` (`companion_card_id`);--> statement-breakpoint
CREATE TABLE `player_deck_unresolved_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`phase_id` integer NOT NULL,
	`phase_name` text,
	`deck_name` text NOT NULL,
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
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_event_idx` ON `player_deck_unresolved_cards` (`event_id`);--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_player_phase_idx` ON `player_deck_unresolved_cards` (`player_id`,`phase_id`);--> statement-breakpoint
CREATE INDEX `player_deck_unresolved_cards_lookup_idx` ON `player_deck_unresolved_cards` (`event_id`,`normalized_original_name`,`normalized_set_code`);--> statement-breakpoint
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
	`current_mode` text DEFAULT 'idle' NOT NULL,
	`mode_configs` text,
	`screen_config` text,
	`state_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `screens_event_id_idx` ON `screens` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `screens_slug_idx` ON `screens` (`event_id`,`slug`);