import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';
import type { deckModeConfigContract } from '../screenModeConfigs/deck';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type DeckSettingsGroup = ScreenSettingsGroupOf<typeof deckModeConfigContract>;

/**
 * How the Deck List Screen Mode looks: its Mode Tokens, by name within the mode.
 * The Mainboard and Sideboard each have their own card width and grid gap,
 * with the same defaults; only the sideboard stacks (ADR-0054), so only it has a
 * stack reveal, and a small sideboard stack can sit beside a medium grid.
 */
export const deckModeTokens = {
	'quantity-badge-text': {
		type: 'color',
		label: 'Quantity badge text',
		settingsGroup: 'quantity-badge',
		default: { token: 'text-primary' },
	},
	'quantity-badge-surface': {
		type: 'color',
		label: 'Quantity badge background',
		settingsGroup: 'quantity-badge',
		default: { token: 'accent' },
	},
	'points-badge-text': {
		type: 'color',
		label: 'Point badge text',
		settingsGroup: 'points-badge',
		default: { token: 'text-primary' },
	},
	'points-badge-surface': {
		type: 'color',
		label: 'Point badge background',
		settingsGroup: 'points-badge',
		default: { token: 'accent' },
	},
	'meta-pill-text': {
		type: 'color',
		label: 'Deck meta pill text',
		settingsGroup: 'deck-details',
		default: { token: 'text-inverse' },
	},
	'meta-pill-surface': {
		type: 'color',
		label: 'Deck meta pill background',
		settingsGroup: 'deck-details',
		default: { token: 'text-primary' },
	},
	'meta-pill-accent': {
		type: 'color',
		label: 'Deck meta pill values',
		settingsGroup: 'deck-details',
		default: { token: 'accent' },
	},
	'meta-pill-border': {
		type: 'color',
		label: 'Deck meta pill border',
		settingsGroup: 'deck-details',
		default: { token: 'text-primary' },
	},
	'pointed-card-text': {
		type: 'color',
		label: 'Pointed card text',
		settingsGroup: 'pointed-cards',
		default: { token: 'text-inverse' },
	},
	'pointed-card-surface': {
		type: 'color',
		label: 'Pointed card background',
		settingsGroup: 'pointed-cards',
		default: { token: 'text-primary' },
	},
	'pointed-card-accent': {
		type: 'color',
		label: 'Pointed card value',
		settingsGroup: 'pointed-cards',
		default: { token: 'accent' },
	},
	'pointed-card-border': {
		type: 'color',
		label: 'Pointed card border',
		settingsGroup: 'pointed-cards',
		default: { token: 'text-primary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<DeckSettingsGroup>>>;

/**
 * The Mode Tokens Deck List once declared: its type, shared chrome, placeholder
 * surface and badge shadow, which only repeated the Foundation Tokens its display now
 * reads directly.
 */
export const deckFormerModeTokens = [
	'title-typography',
	'body-typography',
	'primary-text',
	'secondary-text',
	'card-placeholder',
	'badge-shadow',
] as const;
