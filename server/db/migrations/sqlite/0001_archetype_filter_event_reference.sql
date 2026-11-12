-- Hand-written: a Metagame or Most Played Cards Screen's Archetype filter is an
-- Event Reference by id, `archetypeId`, where it was the Archetype's name,
-- `archetypeFilter` (#1153, ADR-0038). A name exactly one Archetype of the
-- Screen's Event holds, ignoring case and surrounding spaces, becomes that
-- Archetype's id. Any other name is removed, so the Screen counts every
-- Archetype's cards: one no Archetype holds, or one several hold.
UPDATE `screens`
SET `mode_configs` = CASE
	WHEN (
		SELECT count(*) FROM `archetypes`
		WHERE `archetypes`.`event_id` = `screens`.`event_id`
			AND lower(trim(`archetypes`.`name`)) = lower(trim(json_extract(`screens`.`mode_configs`, '$.metagame.archetypeFilter')))
	) = 1
	THEN json_insert(
		json_remove(`mode_configs`, '$.metagame.archetypeFilter'),
		'$.metagame.archetypeId',
		(
			SELECT `archetypes`.`id` FROM `archetypes`
			WHERE `archetypes`.`event_id` = `screens`.`event_id`
				AND lower(trim(`archetypes`.`name`)) = lower(trim(json_extract(`screens`.`mode_configs`, '$.metagame.archetypeFilter')))
		)
	)
	ELSE json_remove(`mode_configs`, '$.metagame.archetypeFilter')
END
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$.metagame.archetypeFilter') IS NOT NULL ELSE 0 END;
--> statement-breakpoint
UPDATE `screens`
SET `mode_configs` = CASE
	WHEN (
		SELECT count(*) FROM `archetypes`
		WHERE `archetypes`.`event_id` = `screens`.`event_id`
			AND lower(trim(`archetypes`.`name`)) = lower(trim(json_extract(`screens`.`mode_configs`, '$."top-cards".archetypeFilter')))
	) = 1
	THEN json_insert(
		json_remove(`mode_configs`, '$."top-cards".archetypeFilter'),
		'$."top-cards".archetypeId',
		(
			SELECT `archetypes`.`id` FROM `archetypes`
			WHERE `archetypes`.`event_id` = `screens`.`event_id`
				AND lower(trim(`archetypes`.`name`)) = lower(trim(json_extract(`screens`.`mode_configs`, '$."top-cards".archetypeFilter')))
		)
	)
	ELSE json_remove(`mode_configs`, '$."top-cards".archetypeFilter')
END
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$."top-cards".archetypeFilter') IS NOT NULL ELSE 0 END;
