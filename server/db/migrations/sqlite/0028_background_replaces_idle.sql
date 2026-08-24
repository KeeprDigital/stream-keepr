PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_screens` (
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
INSERT INTO `__new_screens`("id", "event_id", "name", "slug", "current_mode", "mode_configs", "screen_config", "state_version", "graphic_asset_reference_version", "asset_capability_seed", "asset_capability_version", "asset_capability_digest", "active_card", "active_card_version", "created_at", "updated_at") SELECT "id", "event_id", "name", "slug", "current_mode", "mode_configs", "screen_config", "state_version", "graphic_asset_reference_version", "asset_capability_seed", "asset_capability_version", "asset_capability_digest", "active_card", "active_card_version", "created_at", "updated_at" FROM `screens`;--> statement-breakpoint
DROP TABLE `screens`;--> statement-breakpoint
ALTER TABLE `__new_screens` RENAME TO `screens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `screens_event_id_idx` ON `screens` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `screens_slug_idx` ON `screens` (`event_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `screens_asset_capability_digest_idx` ON `screens` (`asset_capability_digest`);--> statement-breakpoint
-- The Background Screen replaces the former Idle mode (#473): stored modes are
-- renamed, and the old Idle configuration resets rather than mapping onto a
-- Background Layer — the ADR-0014 reset precedent, accepted for the same small
-- install base. A fresh Background Screen reads its defaults (an empty layer
-- stack, black until configured), so dropping the `$.idle` key is the reset.
-- Data-only from here down; replay-safe on empty and data-bearing databases.
UPDATE `screens`
SET `current_mode` = 'background'
WHERE `current_mode` = 'idle';--> statement-breakpoint
UPDATE `screens`
SET `mode_configs` = json_remove(`mode_configs`, '$.idle')
WHERE json_type(`mode_configs`, '$.idle') IS NOT NULL;
