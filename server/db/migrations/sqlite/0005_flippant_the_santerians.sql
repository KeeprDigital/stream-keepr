CREATE TABLE `graphics_capacity_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`canonical_limit_bytes` integer DEFAULT 107374182400 NOT NULL,
	`staging_limit_bytes` integer DEFAULT 10737418240 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `graphics_capacity_settings` (`id`) VALUES (1);--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `staging_reserved_byte_length` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `staging_used_byte_length` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `canonical_reserved_byte_length` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `capacity_outcome` text;
