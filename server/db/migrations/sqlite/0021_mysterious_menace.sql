CREATE TABLE `graphic_style_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`draft_revision` integer DEFAULT 1 NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graphic_style_sets_name_idx` ON `graphic_style_sets` (`name`);--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` ADD `style_set_id` text;--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` ADD `style_set_revision` integer;--> statement-breakpoint
CREATE INDEX `broadcast_graphic_templates_style_set_idx` ON `broadcast_graphic_templates` (`style_set_id`);