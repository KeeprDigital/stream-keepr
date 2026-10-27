import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Standings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const standingsModeTokens = {
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
		label: 'Name and points text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Position, record and deck text',
		default: { token: 'text-secondary' },
	},
	'rise': {
		type: 'color',
		label: 'Position Change climb',
		default: { token: 'positive' },
	},
	'fall': {
		type: 'color',
		label: 'Position Change drop',
		default: { token: 'negative' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
