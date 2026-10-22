-- Hand-written: the Top Cut Bracket Screen Mode key `topCut` is now `top-cut` (#773, ADR-0043).
-- A Screen stores the key as its current mode, as a key of its mode configurations,
-- and as the root of the owner slots its Top Cut Bracket Background Layers index under.
UPDATE `screens` SET `current_mode` = 'top-cut' WHERE `current_mode` = 'topCut';
--> statement-breakpoint
UPDATE `screens`
SET `mode_configs` = json_set(
	json_remove(`mode_configs`, '$.topCut'),
	'$."top-cut"',
	json(json_extract(`mode_configs`, '$.topCut'))
)
WHERE CASE WHEN json_valid(`mode_configs`) THEN json_type(`mode_configs`, '$.topCut') IS NOT NULL ELSE 0 END;
--> statement-breakpoint
UPDATE `graphic_asset_references`
SET `owner_slot` = 'top-cut.' || substr(`owner_slot`, 8)
WHERE `owner_kind` = 'screen' AND substr(`owner_slot`, 1, 7) = 'topCut.';
