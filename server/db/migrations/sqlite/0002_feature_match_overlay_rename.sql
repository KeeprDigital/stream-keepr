UPDATE `screens`
SET `current_mode` = 'feature-match-overlay'
WHERE `current_mode` = 'broadcast-layout';--> statement-breakpoint

UPDATE `screens`
SET `mode_configs` = replace(
	replace(`mode_configs`, '"broadcast-layout"', '"feature-match-overlay"'),
	'"broadcast-bar"',
	'"overlay-bar"'
)
WHERE `mode_configs` IS NOT NULL
	AND (
		instr(`mode_configs`, '"broadcast-layout"') > 0
		OR instr(`mode_configs`, '"broadcast-bar"') > 0
	);
