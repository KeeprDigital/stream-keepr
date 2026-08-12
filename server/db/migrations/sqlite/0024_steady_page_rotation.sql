-- The metagame mode's auto-page toggle is renamed to the canonical
-- `autoPageEnabled` used by the other paginated Screen Modes. Stored
-- mode-config blobs are re-validated strictly on every later write, so a
-- leftover `autoPaging` key would fail every future metagame config patch.
-- Data-only; replay-safe on empty and data-bearing databases alike.
UPDATE `screens`
SET `mode_configs` = json_remove(
	json_set(
		`mode_configs`,
		'$.metagame.autoPageEnabled',
		json(CASE WHEN json_extract(`mode_configs`, '$.metagame.autoPaging') THEN 'true' ELSE 'false' END)
	),
	'$.metagame.autoPaging'
)
WHERE json_extract(`mode_configs`, '$.metagame.autoPaging') IS NOT NULL;
