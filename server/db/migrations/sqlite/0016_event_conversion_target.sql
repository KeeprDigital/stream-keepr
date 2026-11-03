ALTER TABLE `events` ADD `conversion_metric` text DEFAULT 'topN' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `conversion_threshold` integer DEFAULT 8 NOT NULL;