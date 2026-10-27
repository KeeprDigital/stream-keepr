import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/**
 * How the Most Played Cards Screen Mode looks: its Mode Tokens, by name within
 * the mode. Its badge colours were once mode config, now former fields.
 */
export const topCardsModeTokens = {
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
	'name-typography': {
		type: 'typography',
		label: 'Card name type',
		default: { token: 'body' },
	},
	'name-text': {
		type: 'color',
		label: 'Card name text',
		default: { token: 'text-primary' },
	},
	'card-placeholder-surface': {
		type: 'color',
		label: 'Card without an image',
		default: { token: 'surface-raised' },
	},
	'badge-typography': {
		type: 'typography',
		label: 'Badge type',
		default: { token: 'heading' },
	},
	'rank-badge-surface': {
		type: 'color',
		label: 'Rank badge background',
		default: { token: 'accent' },
	},
	'rank-badge-text': {
		type: 'color',
		label: 'Rank badge text',
		default: { token: 'text-primary' },
	},
	'stat-badge-surface': {
		type: 'color',
		label: 'Stat badge background',
		default: { token: 'text-primary' },
	},
	'stat-badge-text': {
		type: 'color',
		label: 'Stat badge text',
		default: { token: 'text-inverse' },
	},
	'page-indicator-text': {
		type: 'color',
		label: 'Page indicator text',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
