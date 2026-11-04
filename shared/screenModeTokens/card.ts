import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Card Spotlight settings groups its Mode Tokens may name (ADR-0072). */
export type CardSettingsGroup = 'card';

/** How the Card Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const cardModeTokens = {
	// How the card enters and, reversed, leaves: the zoom and fade it shipped with.
	// A recipe with no channel cuts. A Theme may point it at a motion Foundation Token.
	motion: {
		type: 'animation-recipe',
		label: 'Card enter and exit',
		settingsGroup: 'card',
		default: {
			duration: 200,
			easing: 'ease-in-out',
			delay: 0,
			fade: { opacity: 0 },
			scale: { factor: 0.7, origin: 'center' },
		},
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<CardSettingsGroup>>>;
