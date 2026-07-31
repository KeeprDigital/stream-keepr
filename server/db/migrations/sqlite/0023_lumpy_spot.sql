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
CREATE INDEX `feature_match_layout_templates_name_idx` ON `feature_match_layout_templates` (`name`);