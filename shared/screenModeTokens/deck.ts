import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/**
 * How the Deck List Screen Mode looks: its Mode Tokens, by name within the mode.
 * The Mainboard and Sideboard each have their own card width and grid gap,
 * with the same defaults; only the sideboard stacks (ADR-0053), so only it has a
 * stack reveal, and a small sideboard stack can sit beside a medium grid.
 */
export const deckModeTokens = {
	'title-typography': {
		type: 'typography',
		label: 'Deck name and board label type',
		default: { token: 'heading' },
	},
	'body-typography': {
		type: 'typography',
		label: 'Body type',
		default: { token: 'body' },
	},
	'primary-text': {
		type: 'color',
		label: 'Deck name, board label and card name text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Player name, quantity and card type text',
		default: { token: 'text-secondary' },
	},
	'card-placeholder': {
		type: 'color',
		label: 'Card without an image',
		default: { token: 'surface-raised' },
	},
	'quantity-badge-text': {
		type: 'color',
		label: 'Quantity badge text',
		default: { token: 'text-primary' },
	},
	'quantity-badge-surface': {
		type: 'color',
		label: 'Quantity badge background',
		default: { token: 'accent' },
	},
	'points-badge-text': {
		type: 'color',
		label: 'Point badge text',
		default: { token: 'text-primary' },
	},
	'points-badge-surface': {
		type: 'color',
		label: 'Point badge background',
		default: { token: 'accent' },
	},
	'meta-pill-text': {
		type: 'color',
		label: 'Deck meta pill text',
		default: { token: 'text-inverse' },
	},
	'meta-pill-surface': {
		type: 'color',
		label: 'Deck meta pill background',
		default: { token: 'text-primary' },
	},
	'meta-pill-accent': {
		type: 'color',
		label: 'Deck meta pill values',
		default: { token: 'accent' },
	},
	'meta-pill-border': {
		type: 'color',
		label: 'Deck meta pill border',
		default: { token: 'text-primary' },
	},
	'pointed-card-text': {
		type: 'color',
		label: 'Pointed card text',
		default: { token: 'text-inverse' },
	},
	'pointed-card-surface': {
		type: 'color',
		label: 'Pointed card background',
		default: { token: 'text-primary' },
	},
	'pointed-card-accent': {
		type: 'color',
		label: 'Pointed card value',
		default: { token: 'accent' },
	},
	'pointed-card-border': {
		type: 'color',
		label: 'Pointed card border',
		default: { token: 'text-primary' },
	},
	'quantity-badge-size': {
		type: 'dimension',
		label: 'Quantity badge text size',
		// Each size token is the former medium size's text; its badge sizes itself around it.
		default: 16,
		bounds: { min: 8, max: 48 },
	},
	'points-badge-size': {
		type: 'dimension',
		label: 'Point badge text size',
		default: 14,
		bounds: { min: 8, max: 48 },
	},
	'meta-pill-size': {
		type: 'dimension',
		label: 'Deck meta pill text size',
		default: 16,
		bounds: { min: 8, max: 48 },
	},
	'pointed-card-size': {
		type: 'dimension',
		label: 'Pointed card text size',
		default: 14,
		bounds: { min: 8, max: 48 },
	},
	'badge-shadow': {
		type: 'color',
		label: 'Point badge shadow',
		default: { token: 'shadow' },
	},
	'mainboard-card-width': {
		type: 'dimension',
		label: 'Mainboard card width',
		// The former medium card size.
		default: 144,
		bounds: { min: 48, max: 480 },
	},
	'mainboard-card-gap': {
		type: 'dimension',
		label: 'Mainboard grid card gap',
		default: 8,
		bounds: { min: 0, max: 48 },
	},
	'sideboard-card-width': {
		type: 'dimension',
		label: 'Sideboard card width',
		// The former medium card size.
		default: 144,
		bounds: { min: 48, max: 480 },
	},
	'sideboard-card-gap': {
		type: 'dimension',
		label: 'Sideboard grid card gap',
		default: 8,
		bounds: { min: 0, max: 48 },
	},
	'sideboard-stack-reveal': {
		type: 'dimension',
		label: 'Sideboard stacked card reveal',
		// About the former 15% of a medium card's height.
		default: 30,
		bounds: { min: 4, max: 240 },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
