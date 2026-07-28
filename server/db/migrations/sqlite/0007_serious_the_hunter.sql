ALTER TABLE `screens` ADD `asset_capability_seed` text NOT NULL;--> statement-breakpoint
ALTER TABLE `screens` ADD `asset_capability_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `screens` ADD `asset_capability_digest` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `screens_asset_capability_digest_idx` ON `screens` (`asset_capability_digest`);