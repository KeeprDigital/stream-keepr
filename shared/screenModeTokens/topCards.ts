import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/**
 * How the Most Played Cards Screen Mode looks: its Mode Tokens, by name within
 * the mode. Its badge colours, card size, gap and badge size were once mode
 * config, now former fields.
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
	// No Foundation Token is a shadow, so it holds the one it shipped with.
	'badge-shadow': {
		type: 'color',
		label: 'Badge shadow',
		default: 'rgba(0, 0, 0, 0.1)',
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
	'card-width': {
		type: 'dimension',
		label: 'Card width',
		// The former medium card size. A grid whose cards fill their columns ignores it.
		default: 160,
		bounds: { min: 48, max: 480 },
	},
	'card-gap': {
		type: 'dimension',
		label: 'Card gap',
		default: 12,
		bounds: { min: 0, max: 100 },
	},
	'badge-size': {
		type: 'dimension',
		label: 'Badge text size',
		// The former medium badge; each badge sizes itself around its text.
		default: 14,
		bounds: { min: 8, max: 48 },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
