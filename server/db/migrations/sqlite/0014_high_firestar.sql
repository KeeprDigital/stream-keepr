CREATE TABLE `graphics_authoring_leases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_kind` text NOT NULL,
	`artifact_id` text NOT NULL,
	`event_id` integer,
	`holder_session_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graphics_authoring_leases_artifact_idx` ON `graphics_authoring_leases` (`artifact_kind`,`artifact_id`);--> statement-breakpoint
CREATE INDEX `graphics_authoring_leases_event_id_idx` ON `graphics_authoring_leases` (`event_id`);