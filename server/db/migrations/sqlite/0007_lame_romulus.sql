ALTER TABLE `players` ADD `external_status` integer;--> statement-breakpoint
ALTER TABLE `players` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `last_seen_at` integer;--> statement-breakpoint
CREATE INDEX `players_event_active_idx` ON `players` (`event_id`,`is_active`);