CREATE TABLE `graphic_asset_contents` (
	`digest` text PRIMARY KEY NOT NULL,
	`byte_length` integer NOT NULL,
	`canonical_mime` text NOT NULL,
	`availability` text DEFAULT 'available' NOT NULL,
	`unavailable_reason_code` text,
	`unavailable_since` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_asset_contents_availability_idx` ON `graphic_asset_contents` (`availability`);--> statement-breakpoint
CREATE TABLE `graphic_asset_event_associations` (
	`asset_id` text NOT NULL,
	`event_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`asset_id`, `event_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graphic_asset_event_associations_event_idx` ON `graphic_asset_event_associations` (`event_id`);--> statement-breakpoint
CREATE TABLE `graphic_asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_slot` text NOT NULL,
	`event_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphic_asset_references_owner_slot_idx` ON `graphic_asset_references` (`owner_kind`,`owner_id`,`owner_slot`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_revision_idx` ON `graphic_asset_references` (`revision_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_asset_idx` ON `graphic_asset_references` (`asset_id`);--> statement-breakpoint
CREATE INDEX `graphic_asset_references_event_idx` ON `graphic_asset_references` (`event_id`);--> statement-breakpoint
CREATE TABLE `graphic_asset_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`content_digest` text NOT NULL,
	`compatibility_profile` text NOT NULL,
	`technical_facts` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_digest`) REFERENCES `graphic_asset_contents`(`digest`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphic_asset_revisions_asset_number_idx` ON `graphic_asset_revisions` (`asset_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `graphic_asset_revisions_content_idx` ON `graphic_asset_revisions` (`content_digest`);--> statement-breakpoint
CREATE TABLE `graphic_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`lifecycle_state` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_assets_kind_state_idx` ON `graphic_assets` (`kind`,`lifecycle_state`);--> statement-breakpoint
CREATE INDEX `graphic_assets_name_idx` ON `graphic_assets` (`name`);--> statement-breakpoint
CREATE TABLE `graphics_derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision_id` text NOT NULL,
	`kind` text NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_revision_id`) REFERENCES `graphic_asset_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_digest`) REFERENCES `graphic_asset_contents`(`digest`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_derivatives_source_kind_idx` ON `graphics_derivatives` (`source_revision_id`,`kind`);--> statement-breakpoint
CREATE INDEX `graphics_derivatives_content_idx` ON `graphics_derivatives` (`content_digest`);--> statement-breakpoint
CREATE TABLE `graphics_ingestion_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`source` text NOT NULL,
	`stage` text DEFAULT 'created' NOT NULL,
	`initiated_by` text NOT NULL,
	`default_event_id` integer,
	`target_asset_id` text,
	`declared_byte_length` integer,
	`transferred_byte_length` integer DEFAULT 0 NOT NULL,
	`report` text,
	`result` text,
	`failure` text,
	`cancel_requested_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`default_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_asset_id`) REFERENCES `graphic_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_ingestion_operations_idempotency_idx` ON `graphics_ingestion_operations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `graphics_ingestion_operations_stage_idx` ON `graphics_ingestion_operations` (`stage`);--> statement-breakpoint
CREATE INDEX `graphics_ingestion_operations_event_idx` ON `graphics_ingestion_operations` (`default_event_id`);