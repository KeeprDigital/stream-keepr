-- Hand-written: a Feature Match Slot side's Leader references the card
-- catalogue by number instead of holding an inline snapshot (ADR-0074). Each
-- number the catalogue lacks gets a row from the latest side snapshot naming
-- it; no lookup runs, and a row already there (say, from a pasted entry) stays.
INSERT INTO `cards` (`name`, `game`, `card_number`, `category`, `colors`, `image_url`)
SELECT `name`, 'op', `number`, 'leader', `colors`, `image_url`
FROM (
	SELECT
		json_extract(`side`.`data`, '$.gameData.leader.number') AS `number`,
		json_extract(`side`.`data`, '$.gameData.leader.name') AS `name`,
		CASE WHEN json_type(`side`.`data`, '$.gameData.leader.colors') = 'array'
			THEN json_extract(`side`.`data`, '$.gameData.leader.colors')
			ELSE '[]'
		END AS `colors`,
		json_extract(`side`.`data`, '$.gameData.leader.imageUrl') AS `image_url`,
		row_number() OVER (
			PARTITION BY json_extract(`side`.`data`, '$.gameData.leader.number')
			ORDER BY `side`.`updated_at` DESC, `side`.`id` DESC
		) AS `recency`
	FROM (
		SELECT `id`, `updated_at`, `player1_data` AS `data` FROM `feature_match_slots`
		UNION ALL
		SELECT `id`, `updated_at`, `player2_data` AS `data` FROM `feature_match_slots`
	) AS `side`
	WHERE json_extract(`side`.`data`, '$.gameData.type') = 'op'
		AND json_type(`side`.`data`, '$.gameData.leader.number') = 'text'
		AND json_type(`side`.`data`, '$.gameData.leader.name') = 'text'
		AND json_type(`side`.`data`, '$.gameData.leader.imageUrl') = 'text'
)
WHERE `recency` = 1
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE `feature_match_slots`
SET `player1_data` = json_set(`player1_data`, '$.gameData.leader', CASE
	WHEN json_type(`player1_data`, '$.gameData.leader.number') = 'text'
		THEN json_object('number', json_extract(`player1_data`, '$.gameData.leader.number'))
	ELSE NULL
END)
WHERE json_type(`player1_data`, '$.gameData.leader') = 'object';--> statement-breakpoint
UPDATE `feature_match_slots`
SET `player2_data` = json_set(`player2_data`, '$.gameData.leader', CASE
	WHEN json_type(`player2_data`, '$.gameData.leader.number') = 'text'
		THEN json_object('number', json_extract(`player2_data`, '$.gameData.leader.number'))
	ELSE NULL
END)
WHERE json_type(`player2_data`, '$.gameData.leader') = 'object';
