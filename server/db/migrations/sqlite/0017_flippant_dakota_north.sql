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
CREATE TABLE `graphics_reconciliation_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`canonical_scan_cursor` text,
	`canonical_scan_started_at` integer,
	`last_sweep_correlation_id` text,
	`last_sweep_started_at` integer,
	`last_sweep_completed_at` integer
);
--> statement-breakpoint
ALTER TABLE `graphic_asset_contents` ADD `reconciled_at` integer;--> statement-breakpoint
CREATE INDEX `graphic_asset_contents_reconciled_idx` ON `graphic_asset_contents` (`reconciled_at`);