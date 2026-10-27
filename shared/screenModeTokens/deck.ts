import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/**
 * How the Deck List Screen Mode looks: its Mode Tokens, by name within the mode.
 * The Mainboard and Sideboard share one card width, gap and stack reveal.
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
	'card-width': {
		type: 'dimension',
		label: 'Card width',
		// The former medium card size.
		default: 144,
		bounds: { min: 48, max: 480 },
	},
	'card-gap': {
		type: 'dimension',
		label: 'Grid card gap',
		default: 8,
		bounds: { min: 0, max: 48 },
	},
	'stack-reveal': {
		type: 'dimension',
		label: 'Stacked card reveal',
		// About the former 15% of a medium card's height.
		default: 30,
		bounds: { min: 4, max: 240 },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
