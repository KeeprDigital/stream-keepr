import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Most Played Cards settings groups its Mode Tokens may name (ADR-0072). */
export type TopCardsSettingsGroup = 'header' | 'ranking-and-pages' | 'layout' | 'card-badges' | 'rank-badge' | 'stat-badge' | 'points-badge';

/**
 * How the Most Played Cards Screen Mode looks: its Mode Tokens, by name within
 * the mode. Its badge colours, card size, gap and badge size were once mode
 * config, now former fields.
 */
export const topCardsModeTokens = {
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
	'name-typography': {
		type: 'typography',
		label: 'Card name type',
		settingsGroup: 'layout',
		default: { token: 'body' },
	},
	'name-text': {
		type: 'color',
		label: 'Card name text',
		settingsGroup: 'layout',
		default: { token: 'text-primary' },
	},
	'card-placeholder-surface': {
		type: 'color',
		label: 'Card without an image',
		settingsGroup: 'layout',
		default: { token: 'surface-raised' },
	},
	'badge-typography': {
		type: 'typography',
		label: 'Badge type',
		settingsGroup: 'card-badges',
		default: { token: 'heading' },
	},
	'badge-shadow': {
		type: 'color',
		label: 'Badge shadow',
		settingsGroup: 'card-badges',
		default: { token: 'shadow' },
	},
	'rank-badge-surface': {
		type: 'color',
		label: 'Rank badge background',
		settingsGroup: 'rank-badge',
		default: { token: 'accent' },
	},
	'rank-badge-text': {
		type: 'color',
		label: 'Rank badge text',
		settingsGroup: 'rank-badge',
		default: { token: 'text-primary' },
	},
	'stat-badge-surface': {
		type: 'color',
		label: 'Stat badge background',
		settingsGroup: 'stat-badge',
		default: { token: 'text-primary' },
	},
	'stat-badge-text': {
		type: 'color',
		label: 'Stat badge text',
		settingsGroup: 'stat-badge',
		default: { token: 'text-inverse' },
	},
	'points-badge-surface': {
		type: 'color',
		label: 'Point badge background',
		settingsGroup: 'points-badge',
		default: { token: 'accent' },
	},
	'points-badge-text': {
		type: 'color',
		label: 'Point badge text',
		settingsGroup: 'points-badge',
		default: { token: 'text-primary' },
	},
	'page-indicator-text': {
		type: 'color',
		label: 'Page indicator text',
		settingsGroup: 'ranking-and-pages',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<TopCardsSettingsGroup>>>;
