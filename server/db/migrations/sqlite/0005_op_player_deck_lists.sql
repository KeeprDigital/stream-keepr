ALTER TABLE `archetypes` ADD `leader_card_number` text;--> statement-breakpoint
ALTER TABLE `archetypes` ADD `customised` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `archetypes_event_leader_idx` ON `archetypes` (`event_id`,`leader_card_number`) WHERE "archetypes"."leader_card_number" is not null;--> statement-breakpoint
ALTER TABLE `player_decks` ADD `leader_card_number` text;--> statement-breakpoint
ALTER TABLE `player_decks` ADD `hand_edited` integer DEFAULT false NOT NULL;