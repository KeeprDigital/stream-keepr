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
ALTER TABLE `graphics_ingestion_operations` ADD `package_preflight` text;