ALTER TABLE `graphic_assets` ADD `trash_prior_state` text;--> statement-breakpoint
ALTER TABLE `graphic_assets` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `graphic_assets` ADD `trash_recoverable_until` integer;