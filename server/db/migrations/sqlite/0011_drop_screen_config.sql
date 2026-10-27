-- A Screen holds no look of its own: it takes its Event's Theme (#826, ADR-0051).
-- Its background, text colours, padding, alignment and colour mode are dropped, not migrated.
ALTER TABLE `screens` DROP COLUMN `screen_config`;
