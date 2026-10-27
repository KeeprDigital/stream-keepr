ALTER TABLE `events` ADD `canvas_width` integer DEFAULT 1920 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `canvas_height` integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
-- Hand-written: a Screen has no canvas of its own; every Screen uses its Event Canvas (#821, ADR-0051).
UPDATE `screens`
SET `screen_config` = json_remove(`screen_config`, '$.width', '$.height')
WHERE CASE WHEN json_valid(`screen_config`) THEN json_type(`screen_config`, '$.width') IS NOT NULL OR json_type(`screen_config`, '$.height') IS NOT NULL ELSE 0 END;
