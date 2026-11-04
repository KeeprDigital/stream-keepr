import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Pairings settings groups its Mode Tokens may name (ADR-0072). */
export type PairingsSettingsGroup = 'header' | 'table' | 'result-badge';

/** How the Pairings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const pairingsModeTokens = {
	'surface': {
		type: 'color',
		label: 'Table surface',
		settingsGroup: 'table',
		default: { token: 'surface' },
	},
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
	'row-typography': {
		type: 'typography',
		label: 'Row type',
		settingsGroup: 'table',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		settingsGroup: 'table',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Player name text',
		settingsGroup: 'table',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Table number, versus and bye text',
		settingsGroup: 'table',
		default: { token: 'text-secondary' },
	},
	'result-typography': {
		type: 'typography',
		label: 'Result badge type',
		settingsGroup: 'result-badge',
		default: { token: 'heading' },
	},
	'result-reported': {
		type: 'color',
		label: 'Reported result',
		settingsGroup: 'result-badge',
		default: { token: 'positive' },
	},
	'result-pending': {
		type: 'color',
		label: 'Pending result',
		settingsGroup: 'result-badge',
		default: { token: 'text-secondary' },
	},
	'result-bye': {
		type: 'color',
		label: 'Bye result',
		settingsGroup: 'result-badge',
		default: { token: 'caution' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<PairingsSettingsGroup>>>;
