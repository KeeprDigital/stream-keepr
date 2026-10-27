import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Card Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const cardModeTokens = {
	'card-width': {
		type: 'dimension',
		label: 'Card width',
		// The width the card fitted to a 1080-pixel-high Screen at the former scale of 1.
		default: 583,
		bounds: { min: 120, max: 1600 },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
