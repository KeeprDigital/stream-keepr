import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Head-to-Head settings groups its Mode Tokens may name (ADR-0071). */
export type HeadToHeadSettingsGroup = 'header' | 'player-details' | 'earlier-matches';

/** How the Head-to-Head Screen Mode looks: its Mode Tokens, by name within the mode. */
export const headToHeadModeTokens = {
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		settingsGroup: 'header',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		settingsGroup: 'header',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		settingsGroup: 'header',
		default: { token: 'divider' },
	},
	'name-typography': {
		type: 'typography',
		label: 'Player name type',
		settingsGroup: 'player-details',
		default: { token: 'heading' },
	},
	'label-typography': {
		type: 'typography',
		label: 'Versus, first meeting and list title type',
		settingsGroup: 'player-details',
		default: { token: 'heading' },
	},
	'surface': {
		type: 'color',
		label: 'Earlier Matches surface',
		settingsGroup: 'earlier-matches',
		default: { token: 'surface' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Player detail and row type',
		settingsGroup: 'player-details',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		settingsGroup: 'earlier-matches',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name, deck and winner text',
		settingsGroup: 'player-details',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Pronouns, stats, Round and label text',
		settingsGroup: 'player-details',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<HeadToHeadSettingsGroup>>>;
