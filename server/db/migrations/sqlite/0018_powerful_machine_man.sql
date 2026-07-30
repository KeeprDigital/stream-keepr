CREATE TABLE `installed_graphics_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`revision_number` integer DEFAULT 1 NOT NULL,
	`document` text NOT NULL,
	`source_template_identity` text NOT NULL,
	`installed_by_operation_id` text NOT NULL,
	`event_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`installed_by_operation_id`) REFERENCES `graphics_ingestion_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_kind_idx` ON `installed_graphics_templates` (`kind`);--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_operation_idx` ON `installed_graphics_templates` (`installed_by_operation_id`);--> statement-breakpoint
CREATE INDEX `installed_graphics_templates_source_idx` ON `installed_graphics_templates` (`source_template_identity`);--> statement-breakpoint
ALTER TABLE `graphics_ingestion_operations` ADD `package_installation` text;