import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Top Cut Bracket Screen Mode looks: its Mode Tokens, by name within the mode. */
export const topCutModeTokens = {
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
	'column-name-typography': {
		type: 'typography',
		label: 'Round name type',
		default: { token: 'heading' },
	},
	'column-name-text': {
		type: 'color',
		label: 'Round name text',
		default: { token: 'text-secondary' },
	},
	'entrant-typography': {
		type: 'typography',
		label: 'Entrant type',
		default: { token: 'body' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name and score text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Seed, Archetype and eliminated text',
		default: { token: 'text-secondary' },
	},
	'position-surface': {
		type: 'color',
		label: 'Bracket Position surface',
		default: { token: 'surface-raised' },
	},
	'position-border': {
		type: 'color',
		label: 'Bracket Position border',
		default: { token: 'divider' },
	},
	'pending-position-border': {
		type: 'color',
		label: 'Pending Bracket Position border',
		default: { token: 'divider' },
	},
	'entrant-divider': {
		type: 'color',
		label: 'Entrant divider',
		default: { token: 'divider' },
	},
	'winner-surface': {
		type: 'color',
		label: 'Winner surface',
		default: { token: 'accent' },
	},
	'connector': {
		type: 'color',
		label: 'Bracket connector',
		default: { token: 'divider' },
	},
	'champion-typography': {
		type: 'typography',
		label: 'Champion type',
		default: { token: 'heading' },
	},
	'champion-border': {
		type: 'color',
		label: 'Champion border',
		default: { token: 'accent' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
