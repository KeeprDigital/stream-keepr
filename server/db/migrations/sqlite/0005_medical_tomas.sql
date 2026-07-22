ALTER TABLE `player_decks` ADD `archetype_id` integer REFERENCES archetypes(id);--> statement-breakpoint
ALTER TABLE `player_decks` ADD `reviewed_at` integer;--> statement-breakpoint
CREATE INDEX `player_decks_archetype_idx` ON `player_decks` (`archetype_id`);