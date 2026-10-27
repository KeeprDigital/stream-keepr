ALTER TABLE `events` ADD `melee_live_results_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_next_check_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_backoff_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_last_checked_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_last_change_at` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_error` text;--> statement-breakpoint
ALTER TABLE `events` ADD `melee_live_results_stop_reason` text;