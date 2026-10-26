-- Hand-written: a Match's result is Melee's alone (ADR-0047).
-- A manual Match carries no result: an operator could once enter one, and it is cleared.
UPDATE `matches`
SET `has_result` = 0, `player1_game_wins` = NULL, `player2_game_wins` = NULL, `game_draws` = NULL, `is_bye` = 0
WHERE `external_source` IS NOT 'melee';
--> statement-breakpoint
-- An unreported Match or a bye holds no Game Score.
UPDATE `matches`
SET `player1_game_wins` = NULL, `player2_game_wins` = NULL, `game_draws` = NULL
WHERE `has_result` = 0 OR `is_bye` = 1;
--> statement-breakpoint
-- Melee left a side's game wins, and the game draws, null where there were none.
UPDATE `matches`
SET `player1_game_wins` = coalesce(`player1_game_wins`, 0),
	`player2_game_wins` = coalesce(`player2_game_wins`, 0),
	`game_draws` = coalesce(`game_draws`, 0)
WHERE `has_result` = 1 AND `is_bye` = 0;
--> statement-breakpoint
-- Generated: Melee's result text is no longer kept; a Match's Game Score says it.
ALTER TABLE `matches` DROP COLUMN `result_string`;
