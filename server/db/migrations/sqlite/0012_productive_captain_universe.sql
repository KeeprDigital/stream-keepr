CREATE TABLE `broadcast_graphics_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`screen_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_state` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `broadcast_graphics_sessions_event_id_idx` ON `broadcast_graphics_sessions` (`event_id`);--> statement-breakpoint
CREATE INDEX `broadcast_graphics_sessions_screen_id_idx` ON `broadcast_graphics_sessions` (`screen_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `broadcast_graphics_sessions_active_screen_idx` ON `broadcast_graphics_sessions` (`screen_id`) WHERE "broadcast_graphics_sessions"."status" = 'active';