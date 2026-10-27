DROP TABLE `animation_effect_presets`;--> statement-breakpoint
DROP TABLE `graphic_style_sets`;--> statement-breakpoint
DROP INDEX `broadcast_graphic_templates_style_set_idx`;--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` DROP COLUMN `style_set_id`;--> statement-breakpoint
ALTER TABLE `broadcast_graphic_templates` DROP COLUMN `style_set_revision`;