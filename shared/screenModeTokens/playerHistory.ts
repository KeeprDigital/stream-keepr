import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Player History Screen Mode looks: its Mode Tokens, by name within the mode. */
export const playerHistoryModeTokens = {
	'surface': {
		type: 'color',
		label: 'Table surface',
		default: { token: 'surface' },
	},
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		default: { token: 'divider' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row and record type',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Opponent and game score text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Record, Round, table and deck text',
		default: { token: 'text-secondary' },
	},
	'outcome-typography': {
		type: 'typography',
		label: 'Outcome badge type',
		default: { token: 'heading' },
	},
	'win': {
		type: 'color',
		label: 'Win or bye outcome',
		default: { token: 'positive' },
	},
	'loss': {
		type: 'color',
		label: 'Loss outcome',
		default: { token: 'negative' },
	},
	'draw': {
		type: 'color',
		label: 'Draw outcome',
		default: { token: 'caution' },
	},
	'pending': {
		type: 'color',
		label: 'Pending outcome',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
