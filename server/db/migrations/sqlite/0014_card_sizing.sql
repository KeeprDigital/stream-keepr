-- Hand-written: `dynamicCardSize` is now `cardSizing` (ADR-0053). A stored `true`
-- filled its columns and reads as Fit; `false` reads as Fixed. json_insert leaves a
-- `cardSizing` already there, as a write since the deploy would have set it.
UPDATE `screens`
SET `mode_configs` = json_remove(
	json_insert(
		`mode_configs`,
		'$."top-cards".cardSizing',
		CASE json_type(`mode_configs`, '$."top-cards".dynamicCardSize') WHEN 'true' THEN 'fit' ELSE 'fixed' END
	),
	'$."top-cards".dynamicCardSize'
)
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$."top-cards".dynamicCardSize') IN ('true', 'false') ELSE 0 END;
--> statement-breakpoint
UPDATE `screens`
SET `mode_configs` = json_remove(
	json_insert(
		`mode_configs`,
		'$.deck.mainboard.cardSizing',
		CASE json_type(`mode_configs`, '$.deck.mainboard.dynamicCardSize') WHEN 'true' THEN 'fit' ELSE 'fixed' END
	),
	'$.deck.mainboard.dynamicCardSize'
)
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$.deck.mainboard.dynamicCardSize') IN ('true', 'false') ELSE 0 END;
--> statement-breakpoint
UPDATE `screens`
SET `mode_configs` = json_remove(
	json_insert(
		`mode_configs`,
		'$.deck.sideboard.cardSizing',
		CASE json_type(`mode_configs`, '$.deck.sideboard.dynamicCardSize') WHEN 'true' THEN 'fit' ELSE 'fixed' END
	),
	'$.deck.sideboard.dynamicCardSize'
)
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$.deck.sideboard.dynamicCardSize') IN ('true', 'false') ELSE 0 END;
--> statement-breakpoint
-- Only a sideboard beside the mainboard stacks now; a stacked mainboard becomes a grid.
UPDATE `screens`
SET `mode_configs` = json_set(`mode_configs`, '$.deck.mainboard.view', 'grid')
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_extract(`mode_configs`, '$.deck.mainboard.view') = 'stack' ELSE 0 END;
