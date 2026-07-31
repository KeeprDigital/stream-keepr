PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_graphics_asset_evidence` (
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
INSERT INTO `__new_graphics_asset_evidence`("id", "recorded_at", "category", "actor", "subject_kind", "subject_id", "outcome", "reason", "correlation_id", "detail", "expires_at") SELECT "id", "recorded_at", "category", "actor", "subject_kind", "subject_id", "outcome", "reason", "correlation_id", "detail", "expires_at" FROM `graphics_asset_evidence`;--> statement-breakpoint
DROP TABLE `graphics_asset_evidence`;--> statement-breakpoint
ALTER TABLE `__new_graphics_asset_evidence` RENAME TO `graphics_asset_evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_recorded_idx` ON `graphics_asset_evidence` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_expires_idx` ON `graphics_asset_evidence` (`expires_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_subject_idx` ON `graphics_asset_evidence` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_category_idx` ON `graphics_asset_evidence` (`category`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_actor_idx` ON `graphics_asset_evidence` (`actor`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `graphics_asset_evidence_correlation_idx` ON `graphics_asset_evidence` (`correlation_id`,`recorded_at`);--> statement-breakpoint
-- Release the expiries carried over from the previous anchor. They were
-- computed as one year after each entry was written, but the guarantee is one
-- year after the subject's final purge or terminal operation cleanup, so those
-- values would destroy the history of assets that are still live and would
-- expire a Trashed asset's early Evidence before the purge it explains. No
-- expiry is invented for these rows in exchange: the scheduled sweep stamps
-- each subject once it records a terminal cleanup, exactly as it does for
-- Evidence written from here on. Retaining for longer is the safe direction.
UPDATE `graphics_asset_evidence` SET `expires_at` = NULL;