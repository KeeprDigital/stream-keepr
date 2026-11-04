import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Player History settings groups its Mode Tokens may name (ADR-0071). */
export type PlayerHistorySettingsGroup = 'header' | 'table' | 'outcome-badge';

/** How the Player History Screen Mode looks: its Mode Tokens, by name within the mode. */
export const playerHistoryModeTokens = {
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
		label: 'Row and record type',
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
		label: 'Opponent and game score text',
		settingsGroup: 'table',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Record, Round, table and deck text',
		settingsGroup: 'table',
		default: { token: 'text-secondary' },
	},
	'outcome-typography': {
		type: 'typography',
		label: 'Outcome badge type',
		settingsGroup: 'outcome-badge',
		default: { token: 'heading' },
	},
	'outcome-win': {
		type: 'color',
		label: 'Win or bye outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'positive' },
	},
	'outcome-loss': {
		type: 'color',
		label: 'Loss outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'negative' },
	},
	'outcome-draw': {
		type: 'color',
		label: 'Draw outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'caution' },
	},
	'outcome-pending': {
		type: 'color',
		label: 'Pending outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<PlayerHistorySettingsGroup>>>;
