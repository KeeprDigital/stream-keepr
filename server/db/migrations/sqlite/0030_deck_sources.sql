-- Persist every legacy Deck binding in the canonical discriminated shape while
-- preserving the rest of the Screen's stored mode configuration byte-for-byte
-- at the JSON-value level.
UPDATE `screens`
SET `mode_configs` = json_remove(
	json_set(
		`mode_configs`,
		'$.deck.deckSource',
		json_object(
			'type', 'player',
			'playerId', json_extract(`mode_configs`, '$.deck.playerId')
		)
	),
	'$.deck.playerId'
)
WHERE json_type(`mode_configs`, '$.deck.playerId') IS NOT NULL;--> statement-breakpoint

-- The reference proof executes inside the Screen INSERT/UPDATE statement. It is
-- therefore serialized with Broadcast Deck List deletion and Event disabling,
-- closing the gap between a pre-write reference check and the stateVersion write.
CREATE TRIGGER `screens_deck_source_insert_guard`
BEFORE INSERT ON `screens`
WHEN (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'player'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.playerId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `players`
		WHERE `players`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.playerId')
			AND `players`.`event_id` = NEW.`event_id`
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'broadcast'
	AND NOT EXISTS (
		SELECT 1
		FROM `broadcast_deck_lists`
		INNER JOIN `events` ON `events`.`id` = `broadcast_deck_lists`.`event_id`
		WHERE `broadcast_deck_lists`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.broadcastDeckListId')
			AND `broadcast_deck_lists`.`event_id` = NEW.`event_id`
			AND `events`.`broadcast_deck_lists_enabled` = 1
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;--> statement-breakpoint

CREATE TRIGGER `screens_deck_source_update_guard`
BEFORE UPDATE OF `mode_configs`, `event_id` ON `screens`
WHEN (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'player'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.playerId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `players`
		WHERE `players`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.playerId')
			AND `players`.`event_id` = NEW.`event_id`
	)
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'broadcast'
	AND NOT EXISTS (
		SELECT 1
		FROM `broadcast_deck_lists`
		INNER JOIN `events` ON `events`.`id` = `broadcast_deck_lists`.`event_id`
		WHERE `broadcast_deck_lists`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.broadcastDeckListId')
			AND `broadcast_deck_lists`.`event_id` = NEW.`event_id`
			AND `events`.`broadcast_deck_lists_enabled` = 1
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;
