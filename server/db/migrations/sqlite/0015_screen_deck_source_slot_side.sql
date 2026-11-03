-- Hand-written: the Screen Deck-source guards also prove a Feature Match Slot side
-- Deck Source names a Slot of the Screen's Event (#876, ADR-0057). A Slot delete
-- clears the Deck Sources naming it in the same batch, ahead of the delete.
DROP TRIGGER IF EXISTS `screens_deck_source_insert_guard`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `screens_deck_source_update_guard`;--> statement-breakpoint
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
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'featureMatchSlot'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.slotId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `feature_match_slots`
		WHERE `feature_match_slots`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.slotId')
			AND `feature_match_slots`.`event_id` = NEW.`event_id`
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
) OR (
	json_extract(NEW.`mode_configs`, '$.deck.deckSource.type') = 'featureMatchSlot'
	AND json_type(NEW.`mode_configs`, '$.deck.deckSource.slotId') = 'integer'
	AND NOT EXISTS (
		SELECT 1 FROM `feature_match_slots`
		WHERE `feature_match_slots`.`id` = json_extract(NEW.`mode_configs`, '$.deck.deckSource.slotId')
			AND `feature_match_slots`.`event_id` = NEW.`event_id`
	)
)
BEGIN
	SELECT RAISE(ABORT, 'SCREEN_DECK_SOURCE_CONFLICT');
END;
