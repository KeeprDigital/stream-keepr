import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';
import type { topCardsModeConfigContract } from '../screenModeConfigs/topCards';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type TopCardsSettingsGroup = ScreenSettingsGroupOf<typeof topCardsModeConfigContract>;

/**
 * How the Most Played Cards Screen Mode looks: its Mode Tokens, by name within
 * the mode. Its badge colours, card size, gap and badge size were once mode
 * config, now former fields.
 */
export const topCardsModeTokens = {
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
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<TopCardsSettingsGroup>>>;

/**
 * The Mode Tokens Most Played Cards once declared: its type, shared chrome, placeholder
 * surface and badge shadow, which only repeated the Foundation Tokens its display now
 * reads directly.
 */
export const topCardsFormerModeTokens = [
	'title-typography',
	'title-text',
	'name-typography',
	'name-text',
	'card-placeholder-surface',
	'badge-typography',
	'badge-shadow',
	'page-indicator-text',
] as const;
