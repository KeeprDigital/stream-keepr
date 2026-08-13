-- A Match may occupy at most one Feature Match Slot. A database that predates
-- this index may already hold duplicates, because concurrent promotions of one
-- Match to two Slots could both commit, so the duplicates are cleared before
-- the index that forbids them is created — otherwise this migration fails on
-- exactly the databases the defect reached.
--
-- The lowest Slot id keeps the Match; every other Slot holding it is emptied to
-- the same shape a promotion's own duplicate-clearing produces. The emptied
-- Slots keep their active Session, whose snapshot then reads as stale until the
-- Slot is promoted again — the same state a cleared Slot is left in by any
-- promotion, and recoverable by re-promoting.
UPDATE `feature_match_slots`
SET `match_id` = null,
	`external_id` = null,
	`external_source` = null,
	`table_number` = null,
	`round_name` = null,
	`format_name` = null,
	`player1_id` = null,
	`player2_id` = null,
	`player1_data` = null,
	`player2_data` = null
WHERE `match_id` is not null
	AND `id` <> (
		SELECT min(`duplicate`.`id`)
		FROM `feature_match_slots` AS `duplicate`
		WHERE `duplicate`.`event_id` = `feature_match_slots`.`event_id`
			AND `duplicate`.`match_id` = `feature_match_slots`.`match_id`
	);--> statement-breakpoint
CREATE UNIQUE INDEX `feature_match_slots_match_unique_idx` ON `feature_match_slots` (`event_id`,`match_id`) WHERE "feature_match_slots"."match_id" is not null;
