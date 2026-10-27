import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Pairings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const pairingsModeTokens = {
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
		label: 'Row type',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Player name text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Table number, versus and bye text',
		default: { token: 'text-secondary' },
	},
	'result-typography': {
		type: 'typography',
		label: 'Result badge type',
		default: { token: 'heading' },
	},
	'result-reported': {
		type: 'color',
		label: 'Reported result',
		default: { token: 'positive' },
	},
	'result-pending': {
		type: 'color',
		label: 'Pending result',
		default: { token: 'text-secondary' },
	},
	'result-bye': {
		type: 'color',
		label: 'Bye result',
		default: { token: 'caution' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
