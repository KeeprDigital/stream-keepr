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
CREATE TABLE `graphic_asset_tombstones` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`purged_at` integer NOT NULL,
	`purge_reason` text NOT NULL,
	`revision_count` integer NOT NULL,
	`reference_count` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
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
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_recorded_idx` ON `graphics_asset_evidence` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_expires_idx` ON `graphics_asset_evidence` (`expires_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_subject_idx` ON `graphics_asset_evidence` (`subject_kind`,`subject_id`);--> statement-breakpoint
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
ALTER TABLE `graphics_ingestion_operations` ADD `transfer_completed_at` integer;--> statement-breakpoint
-- Backfill the transfer-completed fact for operations that were already past
-- their transfer when this column arrived. Without it they would read as
-- incomplete transfers and expire after 24 hours instead of the seven days
-- their staged input was promised, which shortens a retention guarantee.
-- Ambiguous rows are resolved generously: retaining input for longer is always
-- the safe direction.
UPDATE `graphics_ingestion_operations`
SET `transfer_completed_at` = `updated_at`
WHERE `transfer_completed_at` IS NULL
	AND (
		`stage` IN (
			'hashing', 'validating', 'generating-derivatives',
			'awaiting-confirmation', 'publishing'
		)
		OR (
			`stage` = 'failed'
			AND `declared_byte_length` > 0
			AND `transferred_byte_length` >= `declared_byte_length`
		)
	);