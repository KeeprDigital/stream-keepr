DROP INDEX `cards_name_game_idx`;--> statement-breakpoint
ALTER TABLE `cards` ADD `card_number` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `category` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `cost` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `power` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `counter` integer;--> statement-breakpoint
ALTER TABLE `cards` ADD `image_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_op_number_idx` ON `cards` (`card_number`) WHERE "cards"."game" = 'op';--> statement-breakpoint
CREATE UNIQUE INDEX `cards_name_game_idx` ON `cards` (`name`,`game`) WHERE "cards"."game" = 'mtg';--> statement-breakpoint
-- Hand-written: the catalogue's One Piece rows come from the card snapshots
-- pasted entries hold, each number from its latest snapshot (ADR-0074). No
-- lookup runs; a number-only entry gets no row and is looked up on its next paste.
INSERT INTO `cards` (`name`, `game`, `card_number`, `category`, `colors`, `cost`, `power`, `counter`, `image_url`)
SELECT `entry`.`name`, 'op', `entry`.`card_number`, `entry`.`category`, `entry`.`colors`, `entry`.`cost`, `entry`.`power`, `entry`.`counter`, `entry`.`image_url`
FROM `feature_match_deck_list_entries` AS `entry`
WHERE `entry`.`id` = (
	SELECT max(`latest`.`id`)
	FROM `feature_match_deck_list_entries` AS `latest`
	WHERE `latest`.`card_number` = `entry`.`card_number`
		AND `latest`.`name` IS NOT NULL
		AND `latest`.`category` IS NOT NULL
		AND `latest`.`image_url` IS NOT NULL
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `name`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `category`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `colors`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `cost`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `power`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `counter`;--> statement-breakpoint
ALTER TABLE `feature_match_deck_list_entries` DROP COLUMN `image_url`;