ALTER TABLE `events` ADD `melee_sync_lease_token` text;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_sync_lease_command` text;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_sync_lease_expires_at` integer;